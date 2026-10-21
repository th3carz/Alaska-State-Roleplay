import { randomBytes, createHash } from 'node:crypto';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  ModalBuilder, PermissionFlagsBits as P, TextInputBuilder, TextInputStyle } from 'discord.js';
import { APPLICATION_ID, GUILD_ID } from './store.js';
import { card, editPayload } from './layout.js';

// Exact account allowlist. Server ownership, administrator and staff roles never bypass it.
export const CLEAR_USER_ID = '998329326833500242';
const PREFIX = 'private-clear:';
const CONFIRMATION = `CLEAR ${GUILD_ID}`;
const LIFETIME = 5 * 60_000;
const REASON = `Server maintenance authorized by ${CLEAR_USER_ID}`;
const controls = nonce => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`${PREFIX}confirm:${nonce}`).setLabel('Review and confirm').setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId(`${PREFIX}cancel:${nonce}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
const errorText = error => error.code ? `Discord error ${error.code}. Check bot permissions and try again.` : error.message;
const backupFile = (name, value) => new AttachmentBuilder(Buffer.from(JSON.stringify(value, null, 2)), { name });
const roleData = role => ({ id: role.id, name: role.name, position: role.rawPosition ?? role.position,
  color: role.color, colors: role.colors, permissions: role.permissions.bitfield.toString(),
  hoist: role.hoist, mentionable: role.mentionable, managed: role.managed });

function roleBlocked(role, me) {
  if (role.id === GUILD_ID) return '@everyone';
  if (role.managed) return 'Discord-managed role';
  if (!me.permissions.has(P.ManageRoles)) return 'Missing Manage Roles permission';
  if (!role.editable) return 'At or above Alaska Operations in the role hierarchy';
  return null;
}
function botBlocked(member, me) {
  if (member.id === APPLICATION_ID) return 'Alaska Operations is retained to finish and report';
  if (!me.permissions.has(P.KickMembers)) return 'Missing Kick Members permission';
  if (!member.kickable) return 'Discord role hierarchy prevents this kick';
  return null;
}

export class PrivateClear {
  pending = null;
  constructor(bot, { now = Date.now } = {}) { this.bot = bot; this.now = now; }

  async inventory() {
    const guild = await this.bot.client.guilds.fetch(GUILD_ID);
    if (guild.id !== GUILD_ID) throw new Error('The configured server could not be verified.');
    // The allowed account must still belong to the intended server.
    await guild.members.fetch({ user: CLEAR_USER_ID, force: true });
    const roles = await guild.roles.fetch();
    const me = await guild.members.fetchMe({ force: true });
    const members = [];
    let after;
    do {
      const page = await guild.members.list({ limit: 1000, ...(after ? { after } : {}) });
      members.push(...page.values());
      if (page.size < 1000) break;
      const next = [...page.keys()].reduce((a, b) => BigInt(a) > BigInt(b) ? a : b);
      if (next === after) throw new Error('Could not finish reading the member inventory.');
      after = next;
    } while (true);
    const roleTargets = [], botTargets = [], skippedRoles = [], skippedBots = [];
    for (const role of [...roles.values()].sort((a, b) => b.position - a.position)) {
      const reason = roleBlocked(role, me);
      if (reason) skippedRoles.push({ ...roleData(role), reason });
      else roleTargets.push(roleData(role));
    }
    for (const member of members.filter(m => m.user.bot)) {
      const reason = botBlocked(member, me);
      const data = { id: member.id, name: member.user.username };
      if (reason) skippedBots.push({ ...data, reason });
      else botTargets.push(data);
    }
    const plan = { guildId: GUILD_ID, guildName: guild.name, roleTargets, botTargets, skippedRoles, skippedBots };
    const fingerprint = createHash('sha256').update(JSON.stringify({
      roles: roleTargets.map(r => [r.id, r.name, r.position, r.permissions]).sort(),
      bots: botTargets.map(b => b.id).sort(),
    })).digest('hex');
    const backup = { ...plan, capturedAt: new Date(this.now()).toISOString(),
      roles: [...roles.values()].map(roleData),
      members: members.map(m => ({ id: m.id, bot: m.user.bot, roleIds: [...m.roles.cache.keys()] })),
      note: 'Reference backup only. Recreating roles gives them new IDs; deleted roles and bot integrations cannot be automatically restored.' };
    return { guild, plan, backup, fingerprint };
  }

  async message(message) {
    if (message.author?.bot || message.author?.id !== CLEAR_USER_ID || message.webhookId || message.system ||
      message.content?.trim() !== '-clear' || (message.guildId && message.guildId !== GUILD_ID)) return false;
    // Never post the command response or a failure in a server channel.
    if (message.guildId) await message.delete().catch(() => {});
    try {
      const dm = await message.author.createDM();
      if (dm.type !== ChannelType.DM) return true;
      await this.bot.locks.run('private-maintenance', async () => {
        const inventory = await this.inventory();
        const { plan } = inventory;
        const nonce = randomBytes(16).toString('hex');
        const payload = card('Private server maintenance',
          `Server: **${plan.guildName.replace(/[@*_~`|<>]/g, '')}** (${GUILD_ID})\n` +
          `Delete **${plan.roleTargets.length} roles** and kick **${plan.botTargets.length} other bots**.\n` +
          `Skip **${plan.skippedRoles.length} protected roles** and **${plan.skippedBots.length} bots**.\n\n` +
          'Deleting roles removes their member assignments and can disrupt ticket access and session notifications. ' +
          'The attached JSON contains the exact targets, skipped items, role definitions and member role assignments. It is a reference backup, not an automatic restore.\n\n' +
          'Discord audit logs and the resulting server changes remain visible to authorized server members.\n' +
          'No changes have been made. This preview expires in five minutes.',
          { rows: plan.roleTargets.length || plan.botTargets.length ? [controls(nonce)] : [],
            attachments: [backupFile('alaska-maintenance-preview.json', inventory.backup)] });
        const preview = await dm.send(payload); // No working confirmation exists until private delivery succeeds.
        const previous = this.pending;
        this.pending = { ...inventory, nonce, channelId: dm.id, messageId: preview.id, preview, expires: this.now() + LIFETIME };
        if (previous) await previous.preview.edit(editPayload(card('Preview replaced', 'Use your newest private preview.'))).catch(() => {});
      });
    } catch (error) {
      await message.author.send(card('Private maintenance unavailable', errorText(error))).catch(() => {});
    }
    return true;
  }

  async handle(i) {
    if (!i.customId?.startsWith(PREFIX)) return false;
    // Fail silently for every other account, including the server owner and administrators.
    if (i.user?.id !== CLEAR_USER_ID || i.inGuild() || i.channel?.type !== ChannelType.DM) return true;
    const [, action, nonce] = i.customId.split(':');
    const pending = this.pending;
    if (!pending || nonce !== pending.nonce || i.channelId !== pending.channelId || this.now() >= pending.expires ||
      (i.isButton() && i.message?.id !== pending.messageId) ||
      (i.isModalSubmit() && i.message?.id !== pending.messageId)) {
      await i.reply(card('Preview expired', 'Send -clear in this DM for a new preview.')).catch(() => {});
      return true;
    }
    try {
      if (action === 'cancel' && i.isButton()) {
        this.pending = null;
        await i.update(editPayload(card('Maintenance canceled', 'No roles were deleted and no bots were kicked.')));
      } else if (action === 'confirm' && i.isButton()) {
        const field = new TextInputBuilder().setCustomId('confirmation').setLabel('Type the exact text below')
          .setStyle(TextInputStyle.Short).setPlaceholder(CONFIRMATION).setRequired(true).setMaxLength(64);
        await i.showModal(new ModalBuilder().setCustomId(`${PREFIX}execute:${nonce}`).setTitle('Confirm irreversible server cleanup')
          .addComponents(new ActionRowBuilder().addComponents(field)));
      } else if (action === 'execute' && i.isModalSubmit()) {
        await i.deferReply();
        if (i.fields.getTextInputValue('confirmation') !== CONFIRMATION) {
          await i.editReply(card('Confirmation did not match', 'No changes were made. Use the preview button to try again.'));
          return true;
        }
        await this.bot.locks.run('private-maintenance', async () => {
          if (this.pending !== pending || this.now() >= pending.expires) throw new Error('This preview has expired or already been used.');
          this.pending = null; // Consume before the first network read; duplicate/replayed submissions cannot run.
          const fresh = await this.inventory();
          if (fresh.fingerprint !== pending.fingerprint) {
            await pending.preview.edit(editPayload(card('Preview changed', 'The current roles or bots changed. Send -clear again to review a fresh preview.')));
            await i.editReply(card('Nothing changed', 'The server inventory changed. Send -clear again to review it.'));
            return;
          }
          await pending.preview.edit(editPayload(card('Maintenance running', 'Confirmation accepted. A private result report will follow.')));
          // Stop if the private acknowledgement cannot be delivered before any deletion or kick.
          await i.editReply(card('Maintenance running', 'Processing the confirmed targets. This may take a few minutes.'));
          const result = await this.execute(fresh);
          const payload = card('Private maintenance complete',
            `Roles deleted: **${result.deletedRoles.length}**\nOther bots kicked: **${result.kickedBots.length}**\n` +
            `Skipped or failed during execution: **${result.skipped.length + result.failed.length}**\n\n` +
            'Alaska Operations and Discord-protected roles are retained. See the attached JSON for each outcome.',
            { attachments: [backupFile('alaska-maintenance-results.json', { ...fresh.plan, ...result })] });
          // Long operations may outlast the interaction token. The preview DM is durable.
          try { await pending.preview.edit(editPayload(payload)); }
          catch { await i.user.send(payload); }
          await i.editReply(card('Maintenance complete', 'The full result report is attached to your private preview above.')).catch(() => {});
        });
      }
    } catch (error) {
      const payload = card('Private maintenance stopped', `${errorText(error)} No automatic retry will run. Review the server before starting a new preview.`);
      if (i.deferred) await i.editReply(payload).catch(() => {});
      else await i.reply(payload).catch(() => {});
    }
    return true;
  }

  async execute({ guild, plan }) {
    if (guild.id !== GUILD_ID || plan.guildId !== GUILD_ID) throw new Error('Server verification failed.');
    const result = { deletedRoles: [], kickedBots: [], skipped: [], failed: [] };
    // Kick bots before deleting the roles that establish their current hierarchy.
    for (const target of plan.botTargets) {
      try {
        const member = await guild.members.fetch({ user: target.id, force: true });
        const me = await guild.members.fetchMe({ force: true });
        const reason = !member.user.bot ? 'Account is not a bot' : botBlocked(member, me);
        if (reason) { result.skipped.push({ ...target, reason }); continue; }
        await member.kick(REASON);
        result.kickedBots.push(target);
      } catch (error) { result.failed.push({ ...target, operation: 'kick', error: error.code ?? error.name }); }
    }
    for (const target of plan.roleTargets) {
      try {
        const role = await guild.roles.fetch(target.id, { force: true });
        if (!role) { result.skipped.push({ ...target, reason: 'Role already removed' }); continue; }
        const me = await guild.members.fetchMe({ force: true });
        const reason = roleBlocked(role, me);
        if (reason) { result.skipped.push({ ...target, reason }); continue; }
        await role.delete(REASON);
        result.deletedRoles.push(target);
      } catch (error) { result.failed.push({ ...target, operation: 'delete role', error: error.code ?? error.name }); }
    }
    return result;
  }
}
