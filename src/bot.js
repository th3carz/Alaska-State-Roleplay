import { ChannelType, PermissionFlagsBits as P, MessageFlags } from 'discord.js';
import { GUILD_ID, APPLICATION_ID, Locks } from './store.js';
import { validBanner, welcomePayload,
  openPanel, ticketPanel, ticketModal, closeModal } from './ui.js';
import { collectTranscript } from './transcript.js';
import { fetchServerScan, scanFiles } from './scan.js';
import { Panels } from './panels.js';
import { Sessions } from './sessions.js';
import { TicketExtras } from './ticket-extras.js';
import { ticketDetails, ticketRoles, ticketName, typeConfiguration } from './ticket-types.js';
import { card, editPayload, componentText } from './layout.js';
import { ticketNotice } from './ui.js';

const TEXT_PERMS = [P.ViewChannel, P.SendMessages, P.EmbedLinks];
const TICKET_PERMS = [...TEXT_PERMS, P.ReadMessageHistory, P.AttachFiles, P.ManageChannels, P.ManageRoles];
const MEMBER_PERMS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

export function requireBotPermissions(channel, bot, permissions) {
  const actual = channel.permissionsFor(bot);
  if (!actual?.has(permissions)) throw new Error(`The bot is missing required permissions in #${channel.name}. Check channel and category permissions.`);
}
export function ticketOverwrites(guild, botId, ownerId, supportRoleId, extraRoles = [], reportedUserId = null) {
  return [
    { id: guild.id, deny: [P.ViewChannel, P.CreatePublicThreads, P.CreatePrivateThreads] },
    { id: botId, allow: TICKET_PERMS },
    { id: ownerId, allow: MEMBER_PERMS },
    { id: supportRoleId, allow: MEMBER_PERMS },
    ...[...new Set(extraRoles)].filter(id => id !== supportRoleId && id !== guild.id).map(id => ({ id, allow: MEMBER_PERMS })),
    ...(reportedUserId && ![ownerId,botId].includes(reportedUserId) ? [{ id: reportedUserId, deny: [P.ViewChannel] }] : []),
  ];
}
export function isManager(member) { return member.permissions.has(P.ManageGuild); }
export function isSupport(member, ticket) {
  return isManager(member) || ticketRoles(ticket).some(id => member.roles.cache.has(id));
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
  constructor(client, store) {
    this.client = client; this.store = store;
    this.panels = new Panels(this); this.sessions = new Sessions(this); this.ticketExtras = new TicketExtras(this);
  }
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
    if (!i.isChatInputCommand() && !i.isButton() && !i.isModalSubmit() && !i.isStringSelectMenu?.()) return;
    try {
      if (!i.inGuild() || i.guildId !== GUILD_ID) {
        await i.reply({ content: 'This bot is reserved for Alaska State Roleplay.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (await this.sessions.handle(i) || await this.ticketExtras.handle(i)) return;
      if (i.isChatInputCommand()) {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        if (i.commandName === 'configure') await this.configure(i);
        else if (i.commandName === 'scan') await this.scan(i);
        else if (i.commandName === 'welcome-test') {
          await this.manager(i);
          const settings = this.store.settings();
          const payload = welcomePayload(await this.member(i), settings.welcome, settings.panels.homeChannelId);
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
        } else if (/^ticket:(claim|unclaim):\d+$/.test(i.customId)) {
          await i.deferReply({ flags: MessageFlags.Ephemeral });
          await this.claim(i, i.customId.split(':')[1], Number(i.customId.split(':')[2]));
        } else if (/^ticket:close:\d+$/.test(i.customId)) {
          // Opening a modal must be the initial response. Authorization is checked again on submission.
          const ticket = this.getTicket(i, Number(i.customId.split(':')[2]));
          requireTicketAccess(await this.member(i), ticket);
          await i.showModal(closeModal(ticket.id));
        } else throw new Error('This button is no longer supported.');
      } else {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        if (i.customId === 'ticket:create' || /^ticket:create:(general|internal|management)$/.test(i.customId))
          await this.createTicket(i, i.customId.split(':')[2] || 'general');
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
      await i.editReply(card('Bot Configuration',
        `**Welcome**\nChannel: ${show(settings.welcome.channelId)}\nEnabled: ${settings.welcome.enabled}\n\n` +
        `**Sessions**\nChannel: ${show(settings.sessions.channelId)}\nER:LC code: ${show(settings.sessions.code)}\nStaff role: ${show(settings.sessions.staffRoleId)}\nPing role: ${show(settings.sessions.pingRoleId)}\n\n` +
        `**Tickets**\nCategory: ${show(settings.tickets.categoryId)}\nSupport role: ${show(settings.tickets.supportRoleId)}\nTranscript channel: ${show(settings.tickets.logChannelId)}\n\n` +
        `**Automatic Panels**\nEnabled: ${settings.panels.enabled}\nHome channel: ${show(settings.panels.homeChannelId)}\nSupport panel channel: ${show(settings.tickets.panelChannelId)}`));
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
      const serverName = i.options.getString('server-name');
      const ownerName = i.options.getString('owner-name');
      if (serverName !== null) patch.serverLabel = serverName.trim() || 'Alaska State Roleplay';
      if (ownerName !== null) patch.ownerLabel = ownerName.trim() || null;
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
      for (const [option,key] of [['report-role','reportRoleId'],['management-role','managementRoleId']]) {
        const role = i.options.getRole(option);
        if (role) { this.validStaffRole(role, i.guild); patch[key] = role.id; }
      }
    } else if (section === 'panels') {
      const home = i.options.getChannel('home');
      const support = i.options.getChannel('support');
      const affiliations = i.options.getChannel('affiliations');
      const enabled = i.options.getBoolean('enabled');
      if (home) { requireBotPermissions(home, bot, [...TEXT_PERMS, P.ReadMessageHistory]); patch.homeChannelId = home.id; }
      if (affiliations) { requireBotPermissions(affiliations, bot, [...TEXT_PERMS, P.ReadMessageHistory]); patch.affiliationChannelId = affiliations.id; }
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
    await channel.send(welcomePayload(member, settings, this.store.settings().panels.homeChannelId));
  }
  async session(i) { return this.sessions.command(i); }
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
    if (await this.ticketExtras.command(i, action)) return;
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
  async createTicket(i, type = 'general') {
    await this.locks.run(`owner:${i.user.id}`, async () => {
      const config = typeConfiguration(this.requireTicketConfig(), type);
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
      let reportedUserId = null;
      if (type === 'internal') {
        reportedUserId = i.fields.getSelectedUsers('staff', true).first()?.id;
        if (!reportedUserId || reportedUserId === i.user.id) throw new Error('Choose the staff member you are reporting.');
        const reported = await i.guild.members.fetch({ user: reportedUserId, force: true });
        const staffIds = [this.store.settings().tickets.supportRoleId, config.supportRoleId, ...config.accessRoleIds];
        if (reported.user.bot || !staffIds.some(id => reported.roles.cache.has(id))) throw new Error('Choose a staff member of this server.');
      }
      validatePrivateLogs(await this.channel(i.guild, config.logChannelId), i.guild, bot);
      const ticket = this.store.reserveTicket(i.user.id, subject, config, {
        type, reportedUserId, username: i.user.username, joinedAt: i.member?.joinedTimestamp ?? null,
        accessRoleIds: config.accessRoleIds, participantIds: [],
      });
      let channel;
      try {
        channel = await i.guild.channels.create({ name: ticketName(ticket),
          type: ChannelType.GuildText, parent: category.id,
          topic: `asrp-ticket:${ticket.id}:owner:${i.user.id}`,
          permissionOverwrites: ticketOverwrites(i.guild, bot.id, i.user.id, config.supportRoleId, config.accessRoleIds, reportedUserId),
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
        const panel = await channel.send(ticketPanel(opened, config.banner, true));
        this.store.updateTicket(ticket.id, { panel_id: panel.id });
        if (panel.pin) await panel.pin('Support ticket information').catch(error => console.warn('Could not pin ticket information:', error.code ?? error.name));
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
      try { await channel.messages.edit(ticket.panel_id, editPayload(payload)); return; }
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
      if (i.channel.setName) await i.channel.setName(ticketName(updated), 'Ticket claim status changed')
        .catch(error => console.warn('Could not update ticket channel status:', error.code ?? error.name));
      if (i.channel.send) await i.channel.send(ticketNotice(shouldUnclaim ? 'Ticket Unclaimed' : 'Ticket Claimed',
        shouldUnclaim ? `The ticket was unclaimed by <@${actor.id}>. Please wait for another staff member.` : `This ticket has been claimed by <@${actor.id}>.`))
        .catch(error => console.warn('Ticket claim notice could not be sent:', error.code ?? error.name));
      await i.editReply(shouldUnclaim ? 'Ticket unclaimed.' : 'You claimed this ticket.');
    });
  }
  async setSending(channel, ticket, allowed) {
    const ids = [...new Set([ticket.owner_id, ...ticketRoles(ticket), ...(ticketDetails(ticket).participantIds || [])])];
    for (const id of ids) await channel.permissionOverwrites.edit(id, { SendMessages: allowed });
  }
  async restoreSending(channel, ticket) {
    // Attempt both restores even if one role or member was removed during closure.
    const ids = [...new Set([ticket.owner_id, ...ticketRoles(ticket), ...(ticketDetails(ticket).participantIds || [])])];
    const results = await Promise.allSettled(ids.map(id => channel.permissionOverwrites.edit(id, { SendMessages: true })));
    if (results.some(r => r.status === 'rejected' && ![10007, 10011].includes(r.reason?.code)))
      throw new Error('Sending permissions need a manager to restore them manually.');
  }
  async closeTicket(i, rawReason, expectedId, requestNonce = null) {
    await this.locks.run(`ticket:${i.channelId}`, async () => {
      const ticket = this.getTicket(i, expectedId);
      if (requestNonce && ticketDetails(ticket).closeRequest?.nonce !== requestNonce) throw new Error('This closure request has already been handled.');
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
        const archive = await logs.send(card(`Ticket #${ticket.id} Closed`,
          `**Opened by:** <@${ticket.owner_id}>\n**Closed by:** <@${i.user.id}>\n**Reason:** ${reason}`,
          { attachments: [transcript] }));
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
    // Recover authentic bot tickets if the previous host discarded its local database.
    // A topic alone is insufficient: the channel must contain this app's own ticket information message.
    for (const channel of channels.values()) {
      const match = channel?.type === ChannelType.GuildText && /^asrp-ticket:(\d+):owner:(\d+)$/.exec(channel.topic || '');
      if (!match || this.store.forChannel(channel.id)) continue;
      const id = Number(match[1]);
      if (!Number.isSafeInteger(id) || id < 1 || this.store.ticket(id)) continue;
      try {
        let panel, before;
        while (!panel) {
          const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
          panel = page.find(m => m.author?.id === APPLICATION_ID && (
            m.embeds?.some(e => e.title === `Support Ticket #${id}`) || componentText(m.components || []).includes(`## Support Ticket #${id}\n`)));
          if (panel || page.size < 100) break;
          const next = page.last()?.id;
          if (!next || next === before) break;
          before = next;
        }
        if (!panel) continue;
        const text = [...(panel.embeds || []).map(e => e.description || ''), componentText(panel.components || [])].join('\n');
        if (!text.includes(match[2])) continue;
        const type = text.includes('Internal Affairs Support') ? 'internal' : text.includes('Management Support') ? 'management' : 'general';
        const config = typeConfiguration(this.store.settings().tickets, type);
        const subject = (/\*\*Inquiry:\*\* ([\s\S]*?)(?:\n-# |$)/.exec(text)?.[1] || /\*\*Request\*\*\n([\s\S]*)/.exec(text)?.[1] || 'Recovered ticket; see the original request above.').trim().slice(0,1000);
        const claimedBy = /Claimed by <@!?(\d+)>/.exec(text)?.[1] || null;
        this.store.importTicket(id, match[2], channel.id, subject, config,
          { type, username: channel.name.replace(/^.*・(?:gen|ia|mgmt)-/u, '').replace(/^support-/, '').replace(new RegExp(`-${id}$`), ''),
            accessRoleIds: config.accessRoleIds, participantIds: [], reportedUserId: /\*\*Staff:\*\* <@!?(\d+)>/.exec(text)?.[1] || null },
          panel.id, claimedBy, new Date(channel.createdTimestamp || panel.createdTimestamp || Date.now()).toISOString());
        console.log(`Recovered active support ticket #${id} from its Discord channel.`);
      } catch (error) { console.warn(`Could not recover support ticket ${id}:`, error.code ?? error.name); }
    }
  }
}
