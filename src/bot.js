import { ChannelType, PermissionFlagsBits as P, MessageFlags } from 'discord.js';
import { GUILD_ID, Locks } from './store.js';
import { embed, validBanner, welcomePayload, sessionPayload, assertSessionTransition,
  openPanel, ticketPanel, ticketModal, closeModal } from './ui.js';
import { collectTranscript } from './transcript.js';
import { fetchServerScan, scanFiles } from './scan.js';
import { Panels } from './panels.js';

const TEXT_PERMS = [P.ViewChannel, P.SendMessages, P.EmbedLinks];
const TICKET_PERMS = [...TEXT_PERMS, P.ReadMessageHistory, P.AttachFiles, P.ManageChannels, P.ManageRoles];
const MEMBER_PERMS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

export function requireBotPermissions(channel, bot, permissions) {
  const actual = channel.permissionsFor(bot);
  if (!actual?.has(permissions)) throw new Error(`The bot is missing required permissions in #${channel.name}. Check channel and category permissions.`);
}
export function ticketOverwrites(guild, botId, ownerId, supportRoleId) {
  return [
    { id: guild.id, deny: [P.ViewChannel, P.CreatePublicThreads, P.CreatePrivateThreads] },
    { id: botId, allow: TICKET_PERMS },
    { id: ownerId, allow: MEMBER_PERMS },
    { id: supportRoleId, allow: MEMBER_PERMS },
  ];
}
export function isManager(member) { return member.permissions.has(P.ManageGuild); }
export function isSupport(member, ticket) {
  return isManager(member) || member.roles.cache.has(ticket.support_role_id);
}
export function requireTicketAccess(member, ticket) {
  if (member.id !== ticket.owner_id && !isSupport(member, ticket))
    throw new Error('Only the ticket opener or support staff can close this ticket.');
}
export function validatePrivateLogs(channel, guild, bot) {
  if (channel.type !== ChannelType.GuildText) throw new Error('The transcript channel must be a regular text channel.');
  requireBotPermissions(channel, bot, [...TEXT_PERMS, P.AttachFiles]);
  if (channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel))
    throw new Error('Choose a private staff transcript channel. @everyone must not be able to view it.');
}

export class Bot {
  locks = new Locks();
  constructor(client, store) { this.client = client; this.store = store; this.panels = new Panels(this); }
  async botMember(guild) { return guild.members.me ?? guild.members.fetchMe(); }
  async channel(guild, id, type = ChannelType.GuildText) {
    if (!id) throw new Error('This system is not configured yet. Ask a manager to use /configure.');
    const channel = await guild.channels.fetch(id);
    if (!channel || channel.type !== type) throw new Error('A configured channel is missing or has the wrong type. Update /configure.');
    return channel;
  }
  async member(i) { return i.guild.members.fetch({ user: i.user.id, force: true }); }
  async manager(i) {
    const member = await this.member(i);
    if (!isManager(member)) throw new Error('You need the Manage Server permission for this action.');
    return member;
  }
  async error(i, error) {
    // Never echo API request bodies, environment variables, or the bot token.
    console.error('Interaction failed:', error.code ?? error.name ?? 'UnknownError');
    const message = error.code ? 'Discord could not complete that action. Check the bot permissions and try again.' : error.message;
    const payload = { content: message || 'Could not complete that action.', allowedMentions: { parse: [] } };
    try {
      if (i.deferred) await i.editReply(payload);
      else if (i.replied) await i.followUp({ ...payload, flags: MessageFlags.Ephemeral });
      else await i.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } catch (replyError) { console.error('Could not send error response:', replyError.code ?? replyError.name); }
  }
  async handle(i) {
    if (!i.isChatInputCommand() && !i.isButton() && !i.isModalSubmit()) return;
    try {
      if (!i.inGuild() || i.guildId !== GUILD_ID) {
        await i.reply({ content: 'This bot is reserved for Alaska State Roleplay.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (i.isChatInputCommand()) {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        if (i.commandName === 'configure') await this.configure(i);
        else if (i.commandName === 'scan') await this.scan(i);
        else if (i.commandName === 'welcome-test') {
          await this.manager(i);
          const payload = welcomePayload(await this.member(i), this.store.settings().welcome);
          await i.editReply(payload);
        } else if (i.commandName === 'session') await this.session(i);
        else if (i.commandName === 'ticket') await this.ticketCommand(i);
        else await i.editReply('This command is not part of this bot.');
      } else if (i.isButton()) {
        if (i.customId === 'ticket:open') {
          this.requireTicketConfig();
          const active = this.store.activeForOwner(i.user.id);
          if (active) throw new Error(active.channel_id ? `You already have a ticket: <#${active.channel_id}>.` : 'Your ticket is being created. Please wait.');
          await i.showModal(ticketModal());
        } else if (/^ticket:claim:\d+$/.test(i.customId)) {
          await i.deferReply({ flags: MessageFlags.Ephemeral });
          await this.claim(i, 'toggle', Number(i.customId.split(':')[2]));
        } else if (/^ticket:close:\d+$/.test(i.customId)) {
          // Opening a modal must be the initial response. Authorization is checked again on submission.
          const ticket = this.getTicket(i, Number(i.customId.split(':')[2]));
          requireTicketAccess(await this.member(i), ticket);
          await i.showModal(closeModal(ticket.id));
        } else throw new Error('This button is no longer supported.');
      } else {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        if (i.customId === 'ticket:create') await this.createTicket(i);
        else if (/^ticket:finish:\d+$/.test(i.customId))
          await this.closeTicket(i, i.fields.getTextInputValue('reason'), Number(i.customId.split(':')[2]));
        else throw new Error('This form is no longer supported.');
      }
    } catch (error) { await this.error(i, error); }
  }
  async scan(i) {
    await this.manager(i);
    await this.locks.run('scan', async () => {
      const scan = await fetchServerScan(i.guild);
      await i.editReply({ content: `Server scan complete: ${scan.counts.channels} channels, ${scan.counts.roles} roles, and ${scan.counts.emojis} emojis (${scan.counts.animatedEmojis} animated). Download the JSON file and attach it in your ChatGPT conversation for configuration.`,
        files: scanFiles(scan), allowedMentions: { parse: [] } });
    });
  }
  async configure(i) {
    await this.manager(i);
    const section = i.options.getSubcommand();
    if (section === 'view') {
      const settings = this.store.settings();
      const show = id => id ?? 'Not configured';
      await i.editReply({ embeds: [embed('Bot Configuration',
        `**Welcome**\nChannel: ${show(settings.welcome.channelId)}\nEnabled: ${settings.welcome.enabled}\n\n` +
        `**Sessions**\nChannel: ${show(settings.sessions.channelId)}\nER:LC code: ${show(settings.sessions.code)}\nStaff role: ${show(settings.sessions.staffRoleId)}\nPing role: ${show(settings.sessions.pingRoleId)}\n\n` +
        `**Tickets**\nCategory: ${show(settings.tickets.categoryId)}\nSupport role: ${show(settings.tickets.supportRoleId)}\nTranscript channel: ${show(settings.tickets.logChannelId)}\n\n` +
        `**Automatic Panels**\nEnabled: ${settings.panels.enabled}\nHome channel: ${show(settings.panels.homeChannelId)}\nSupport panel channel: ${show(settings.tickets.panelChannelId)}`)], allowedMentions: { parse: [] } });
      return;
    }
    const bot = await this.botMember(i.guild);
    const banner = validBanner(i.options.getString('banner'));
    const patch = banner === undefined ? {} : { banner };
    if (section === 'welcome') {
      const channel = i.options.getChannel('channel', true);
      requireBotPermissions(channel, bot, TEXT_PERMS);
      patch.channelId = channel.id;
      const message = i.options.getString('message');
      const enabled = i.options.getBoolean('enabled');
      if (message !== null) {
        if (!message.trim()) throw new Error('Welcome message cannot be blank.');
        patch.message = message;
      }
      if (enabled !== null) patch.enabled = enabled;
    } else if (section === 'sessions') {
      const channel = i.options.getChannel('channel', true);
      requireBotPermissions(channel, bot, [...TEXT_PERMS, P.ReadMessageHistory]);
      const code = i.options.getString('code', true).trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) throw new Error('Enter the private server code using letters, numbers, underscores, or hyphens.');
      Object.assign(patch, { channelId: channel.id, code });
      const staff = i.options.getRole('staff-role');
      const ping = i.options.getRole('ping-role');
      if (staff) { this.validStaffRole(staff, i.guild); patch.staffRoleId = staff.id; }
      if (ping) {
        if (ping.id === i.guild.id) throw new Error('Choose a dedicated session ping role instead of @everyone.');
        if (!ping.mentionable && !channel.permissionsFor(bot)?.has(P.MentionEveryone))
          throw new Error('Make the session ping role mentionable, or grant the bot Mention Everyone in the sessions channel.');
        patch.pingRoleId = ping.id;
      }
      if (i.options.getBoolean('clear-ping')) patch.pingRoleId = null;
    } else if (section === 'tickets') {
      const category = i.options.getChannel('category', true);
      const logs = i.options.getChannel('logs', true);
      const support = i.options.getRole('support-role', true);
      this.validStaffRole(support, i.guild);
      requireBotPermissions(category, bot, TICKET_PERMS);
      validatePrivateLogs(logs, i.guild, bot);
      Object.assign(patch, { categoryId: category.id, logChannelId: logs.id, supportRoleId: support.id });
    } else if (section === 'panels') {
      const home = i.options.getChannel('home');
      const support = i.options.getChannel('support');
      const enabled = i.options.getBoolean('enabled');
      if (home) { requireBotPermissions(home, bot, [...TEXT_PERMS, P.ReadMessageHistory]); patch.homeChannelId = home.id; }
      if (support) {
        requireBotPermissions(support, bot, [...TEXT_PERMS, P.ReadMessageHistory]);
        this.store.configure('tickets', { panelChannelId: support.id });
      }
      if (enabled !== null) patch.enabled = enabled;
    } else throw new Error('Unknown configuration section.');
    this.store.configure(section, patch);
    const panels = await this.panels.sync(i.guild);
    const warning = panels.some(p => p.error) ? ' Some panels could not be refreshed; check the bot channel permissions.' : '';
    await i.editReply(`${section[0].toUpperCase() + section.slice(1)} settings saved.${warning}`);
  }
  validStaffRole(role, guild) {
    if (role.id === guild.id || role.managed) throw new Error('Choose a dedicated staff role that can be assigned to members.');
  }
  async welcome(member) {
    if (member.guild.id !== GUILD_ID || member.user.bot) return;
    const settings = this.store.settings().welcome;
    if (!settings.enabled || !settings.channelId) return;
    const channel = await this.channel(member.guild, settings.channelId);
    requireBotPermissions(channel, await this.botMember(member.guild), TEXT_PERMS);
    await channel.send(welcomePayload(member, settings));
  }
  async session(i) {
    await this.locks.run('session', async () => {
      const config = this.store.settings().sessions;
      const actor = await this.member(i);
      if (!isManager(actor) && !(config.staffRoleId && actor.roles.cache.has(config.staffRoleId)))
        throw new Error('Only the session staff role or a server manager can manage sessions.');
      if (!config.code) throw new Error('Configure the ER:LC code with /configure sessions first.');
      const action = i.options.getSubcommand();
      const previous = this.store.session();
      assertSessionTransition(previous, action);
      const channel = await this.channel(i.guild, config.channelId);
      requireBotPermissions(channel, await this.botMember(i.guild), [...TEXT_PERMS, P.ReadMessageHistory]);
      const payload = sessionPayload(action, config, action === 'start' ? i.user.id : previous.hostId,
        i.options.getString('message'));
      const announcement = await channel.send(payload);
      this.store.saveSession({ status: action, hostId: action === 'start' ? i.user.id : previous.hostId,
        messageId: announcement.id, channelId: channel.id,
        startedAt: action === 'start' ? new Date().toISOString() : previous.startedAt,
        updatedAt: new Date().toISOString() });
      // Retire outdated join buttons so old announcements cannot imply an earlier session is still active.
      if (previous?.messageId && previous.status !== 'end') {
        try {
          const oldChannel = await this.channel(i.guild, previous.channelId);
          await oldChannel.messages.edit(previous.messageId, { components: [], allowedMentions: { parse: [] } });
        } catch (error) { console.warn('Could not retire old session buttons:', error.code ?? error.name); }
      }
      await this.panels.sync(i.guild);
      await i.editReply(`Session ${action === 'start' ? 'startup' : action} announced in <#${channel.id}>.`);
    });
  }
  requireTicketConfig() {
    const config = this.store.settings().tickets;
    if (!config.categoryId || !config.supportRoleId || !config.logChannelId)
      throw new Error('Tickets are not configured yet. Ask a manager to use /configure tickets.');
    return config;
  }
  getTicket(i, expectedId) {
    const ticket = this.store.forChannel(i.channelId);
    if (!ticket || ticket.state !== 'open' || (expectedId && expectedId !== ticket.id))
      throw new Error('This is not an open support ticket, or another action is already closing it.');
    return ticket;
  }
  async ticketCommand(i) {
    const action = i.options.getSubcommand();
    if (action === 'panel') {
      await this.manager(i);
      const config = this.requireTicketConfig();
      const channel = await this.channel(i.guild, i.options.getChannel('channel')?.id ?? i.channelId);
      requireBotPermissions(channel, await this.botMember(i.guild), [...TEXT_PERMS, P.ReadMessageHistory]);
      await this.panels.ensure(i.guild, { kind: 'support', channelId: channel.id, payload: openPanel(config) });
      this.store.configure('tickets', { panelChannelId: channel.id });
      await this.panels.sync(i.guild);
      await i.editReply(`Ticket panel ready in <#${channel.id}>.`);
    } else if (action === 'claim' || action === 'unclaim') await this.claim(i, action);
    else if (action === 'close') await this.closeTicket(i, i.options.getString('reason', true));
  }
  async createTicket(i) {
    await this.locks.run(`owner:${i.user.id}`, async () => {
      const config = this.requireTicketConfig();
      const existing = this.store.activeForOwner(i.user.id);
      if (existing) throw new Error(existing.channel_id ? `You already have a ticket: <#${existing.channel_id}>.` : 'Your ticket is already being created.');
      const subject = i.fields.getTextInputValue('subject').trim();
      if (subject.length < 5 || subject.length > 1000) throw new Error('Explain your request in 5–1,000 characters.');
      const bot = await this.botMember(i.guild);
      const category = await this.channel(i.guild, config.categoryId, ChannelType.GuildCategory);
      requireBotPermissions(category, bot, TICKET_PERMS);
      const role = await i.guild.roles.fetch(config.supportRoleId);
      if (!role) throw new Error('The support role was deleted. Ask a manager to update /configure tickets.');
      this.validStaffRole(role, i.guild);
      validatePrivateLogs(await this.channel(i.guild, config.logChannelId), i.guild, bot);
      const ticket = this.store.reserveTicket(i.user.id, subject, config);
      let channel;
      try {
        const username = i.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'member';
        channel = await i.guild.channels.create({ name: `support-${username}-${ticket.id}`,
          type: ChannelType.GuildText, parent: category.id,
          topic: `asrp-ticket:${ticket.id}:owner:${i.user.id}`,
          permissionOverwrites: ticketOverwrites(i.guild, bot.id, i.user.id, config.supportRoleId),
          reason: `Support ticket #${ticket.id} opened by ${i.user.id}` });
      } catch (error) {
        // A network timeout can hide a successful channel creation. Keep the reservation
        // and reconcile against its unique channel topic before allowing another ticket.
        const channels = await i.guild.channels.fetch().catch(() => null);
        if (channels) channel = channels.find(c => c?.topic === `asrp-ticket:${ticket.id}:owner:${i.user.id}`);
        if (!channel) {
          if (channels) this.store.updateTicket(ticket.id, { state: 'failed' });
          throw error;
        }
      }
      const opened = this.store.updateTicket(ticket.id, { state: 'open', channel_id: channel.id });
      try {
        const panel = await channel.send({ ...ticketPanel(opened, config.banner),
          content: `<@${i.user.id}> <@&${config.supportRoleId}>`,
          allowedMentions: { parse: [], users: [i.user.id], roles: [config.supportRoleId] } });
        this.store.updateTicket(ticket.id, { panel_id: panel.id });
      } catch (error) {
        console.error('Ticket opened without control panel:', error.code ?? error.name);
        await i.editReply(`Your ticket is <#${channel.id}>. The control panel could not be posted; staff can use /ticket commands after checking bot permissions.`);
        return;
      }
      await i.editReply(`Your private support ticket is ready: <#${channel.id}>.`);
    });
  }
  async updatePanel(channel, ticket) {
    const payload = ticketPanel(ticket, this.store.settings().tickets.banner);
    if (ticket.panel_id) {
      try { await channel.messages.edit(ticket.panel_id, payload); return; }
      catch (error) { if (error.code !== 10008) throw error; }
    }
    const panel = await channel.send(payload);
    this.store.updateTicket(ticket.id, { panel_id: panel.id });
  }
  async claim(i, action, expectedId) {
    await this.locks.run(`ticket:${i.channelId}`, async () => {
      const ticket = this.getTicket(i, expectedId);
      const actor = await this.member(i);
      if (!isSupport(actor, ticket)) throw new Error('Only support staff can claim or unclaim tickets.');
      if (actor.id === ticket.owner_id) throw new Error('You cannot claim your own support ticket.');
      const shouldUnclaim = action === 'unclaim' || (action === 'toggle' && !!ticket.claimed_by);
      if (shouldUnclaim) {
        if (!ticket.claimed_by) throw new Error('This ticket is already unclaimed.');
        if (ticket.claimed_by !== actor.id && !isManager(actor)) throw new Error('Only the assigned staff member or a server manager can unclaim this ticket.');
      } else if (ticket.claimed_by) throw new Error(`This ticket is already claimed by <@${ticket.claimed_by}>.`);
      const updated = this.store.updateTicket(ticket.id, { claimed_by: shouldUnclaim ? null : actor.id });
      try { await this.updatePanel(i.channel, updated); }
      catch (error) {
        this.store.updateTicket(ticket.id, { claimed_by: ticket.claimed_by });
        throw error;
      }
      await i.editReply(shouldUnclaim ? 'Ticket unclaimed.' : 'You claimed this ticket.');
    });
  }
  async setSending(channel, ticket, allowed) {
    await channel.permissionOverwrites.edit(ticket.owner_id, { SendMessages: allowed });
    await channel.permissionOverwrites.edit(ticket.support_role_id, { SendMessages: allowed });
  }
  async restoreSending(channel, ticket) {
    // Attempt both restores even if one role or member was removed during closure.
    const results = await Promise.allSettled([
      channel.permissionOverwrites.edit(ticket.owner_id, { SendMessages: true }),
      channel.permissionOverwrites.edit(ticket.support_role_id, { SendMessages: true }),
    ]);
    if (results.some(r => r.status === 'rejected' && ![10007, 10011].includes(r.reason?.code)))
      throw new Error('Sending permissions need a manager to restore them manually.');
  }
  async closeTicket(i, rawReason, expectedId) {
    await this.locks.run(`ticket:${i.channelId}`, async () => {
      const ticket = this.getTicket(i, expectedId);
      requireTicketAccess(await this.member(i), ticket);
      const reason = rawReason.trim();
      if (reason.length < 3 || reason.length > 500) throw new Error('Give a closing reason between 3 and 500 characters.');
      const bot = await this.botMember(i.guild);
      requireBotPermissions(i.channel, bot, TICKET_PERMS);
      const logs = await this.channel(i.guild, ticket.log_channel_id);
      validatePrivateLogs(logs, i.guild, bot);
      this.store.updateTicket(ticket.id, { state: 'closing', close_reason: reason, closed_by: i.user.id });
      let archived = false;
      try {
        await this.setSending(i.channel, ticket, false);
        await i.channel.send({ content: `Closing ticket #${ticket.id}. Reason: ${reason}`, allowedMentions: { parse: [] } });
        const transcript = await collectTranscript(i.channel, ticket, i.user.id, reason);
        const archive = await logs.send({ embeds: [embed(`Ticket #${ticket.id} Closed`,
          `**Opened by:** <@${ticket.owner_id}>\n**Closed by:** <@${i.user.id}>\n**Reason:** ${reason}`)],
          files: [transcript], allowedMentions: { parse: [] } });
        this.store.updateTicket(ticket.id, { transcript_id: archive.id });
        archived = true;
        // Send the result while the interaction's channel still exists.
        await i.editReply('Transcript saved. Closing the ticket now.');
        await i.channel.delete(`Support ticket #${ticket.id}: ${reason.slice(0, 400)}`);
        this.store.updateTicket(ticket.id, { state: 'closed', closed_at: new Date().toISOString() });
      } catch (error) {
        if (archived && error.code === 10003) {
          this.store.updateTicket(ticket.id, { state: 'closed', closed_at: new Date().toISOString() });
          return;
        }
        this.store.updateTicket(ticket.id, { state: 'open', transcript_id: null, close_reason: null, closed_by: null });
        try { await this.restoreSending(i.channel, ticket); }
        catch (restoreError) { throw new Error(`The ticket could not be closed. ${restoreError.message}`); }
        console.error('Ticket close failed; kept open:', error.code ?? error.name);
        throw new Error(archived ? 'The transcript was saved, but the ticket could not be deleted. It has been reopened; check channel permissions and try again.'
          : 'The transcript could not be saved, so the ticket has been kept open. Check the transcript channel and bot permissions, then try again.');
      }
    });
  }
  async recover(guild) {
    const channels = await guild.channels.fetch();
    for (const ticket of this.store.activeTickets()) {
      let channel = ticket.channel_id ? channels.get(ticket.channel_id) : null;
      if (!channel && ticket.state === 'creating')
        channel = channels.find(c => c?.topic === `asrp-ticket:${ticket.id}:owner:${ticket.owner_id}`);
      if (!channel) {
        this.store.updateTicket(ticket.id, { state: ticket.state === 'creating' ? 'failed' : 'closed', closed_at: new Date().toISOString() });
      } else {
        if (ticket.state === 'closing') await this.restoreSending(channel, ticket);
        this.store.updateTicket(ticket.id, { state: 'open', channel_id: channel.id, transcript_id: null, closed_by: null, close_reason: null });
      }
    }
  }
}
