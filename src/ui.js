import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, TextDisplayBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, LabelBuilder, UserSelectMenuBuilder } from 'discord.js';
import { SERVER_NAME } from './store.js';
import { card, plainContainer } from './layout.js';
import { TICKET_TYPES, ticketDetails } from './ticket-types.js';

export function validBanner(value) {
  if (value === null) return undefined;
  if (value.toLowerCase() === 'none') return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('Banner must be an HTTPS image URL, or none.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS image URL without credentials.');
  return url.href;
}
export function welcomePayload(member, config, homeChannelId = null) {
  const vars = { user: `<@${member.id}>`, username: member.user.username,
    server: SERVER_NAME, memberCount: String(member.guild.memberCount) };
  const text = config.message.replace(/\{(user|username|server|memberCount)\}/g, (_, key) => vars[key]);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('welcome:member-count')
    .setLabel(String(member.guild.memberCount)).setStyle(ButtonStyle.Secondary).setDisabled(true));
  if (homeChannelId) row.addComponents(new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link)
    .setURL(`https://discord.com/channels/${member.guild.id}/${homeChannelId}`));
  const box = plainContainer().addTextDisplayComponents(new TextDisplayBuilder().setContent(`> ${text.replaceAll('\n','\n> ')}`))
    .addActionRowComponents(row);
  return { flags: MessageFlags.IsComponentsV2, components: [box],
    allowedMentions: { parse: [], users: [member.id], roles: [] } };
}
export const sessionDetails = {
  start: { title: 'Session Startup', text: 'Our ER:LC session is now open. Join Alaska State Roleplay using the button below.' },
  boost: { title: 'Session Boost', text: 'We are looking for more players. Join the active session and help bring Alaska to life.' },
  full: { title: 'Session Full', text: 'Our ER:LC server is currently full. Thank you for joining us; please wait for a space to open.' },
  end: { title: 'Session Ended', text: 'Our ER:LC session has ended. Thank you for joining Alaska State Roleplay.' },
};
export function assertSessionTransition(current, action) {
  if (!sessionDetails[action]) throw new Error('Unknown session action.');
  const active = current && current.status !== 'end';
  if (action === 'start' && active) throw new Error('A session is already active. End it before starting another.');
  if (action !== 'start' && !active) throw new Error('Start a session first with /session start.');
}
export function sessionPayload(action, config, hostId, message) {
  const detail = sessionDetails[action];
  const ping = config.pingRoleId ? `<@&${config.pingRoleId}>\n\n` : '';
  const info = `\n\n**Game Information**\n> **Server Name:** ${config.serverLabel || SERVER_NAME}\n` +
    (config.ownerLabel ? `> **Server Owner:** ${config.ownerLabel}\n` : '') +
    `> **Join Code:** ${config.code || 'Not configured'}\n> **Session Host:** <@${hostId}>`;
  return card(detail.title, ping + (message || detail.text) + info, { banner: 'sessions', imageURL: config.banner,
    rows: [new ActionRowBuilder().addComponents(...sessionButtons(config, action === 'end', false))],
    mentions: { parse: [], users: [], roles: config.pingRoleId ? [config.pingRoleId] : [] } });
}
function sessionButtons(config, notifications = true, statusButton = false, status = 'Offline') {
  const buttons = [];
  if (statusButton) buttons.push(new ButtonBuilder().setCustomId('session:status').setLabel(status).setDisabled(true)
    .setStyle(status === 'Offline' ? ButtonStyle.Danger : ButtonStyle.Success));
  if (config.code) buttons.push(new ButtonBuilder().setLabel('Quick Join').setStyle(ButtonStyle.Link)
    .setURL(`https://erlc.gg/join/${encodeURIComponent(config.code)}`));
  if (notifications && config.pingRoleId) buttons.push(new ButtonBuilder().setCustomId('session:notifications')
    .setLabel('Session Notification').setStyle(ButtonStyle.Secondary));
  return buttons;
}
export function openPanel(config) {
  return card('Support Tickets', 'Welcome to our **Support Channel**. Choose the assistance you need from the menu below.\n\n' +
    '> Please explain your request clearly and allow our team time to respond. You may have one support ticket open at a time.', {
    banner: 'support', imageURL: config.banner,
    rows: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket:type')
      .setPlaceholder('Choose assistance').addOptions(...Object.entries(TICKET_TYPES).map(([value, type]) =>
        ({ label: type.label, value, description: type.description })))),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:faq').setLabel('Ticket FAQ')
      .setStyle(ButtonStyle.Secondary))] });
}
export function homePanel(settings, guildId) {
  const buttons = [];
  if (settings.sessions.channelId) buttons.push(new ButtonBuilder().setLabel('Sessions')
    .setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guildId}/${settings.sessions.channelId}`));
  if (settings.tickets.panelChannelId) buttons.push(new ButtonBuilder().setLabel('Support')
    .setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guildId}/${settings.tickets.panelChannelId}`));
  return card(SERVER_NAME,
    'Welcome to **Alaska State Roleplay**. We hope you enjoy your time in our community.\n\n' +
    'Find our latest roleplay sessions in the sessions channel. If you need assistance, open a private ticket through Support.',
    { banner: 'dashboard', rows: buttons.length ? [new ActionRowBuilder().addComponents(...buttons)] : [] });
}
export function sessionStatusPanel(config, current, live = { connected: false }) {
  const active = current && current.status !== 'end';
  const status = active ? (current.status === 'full' ? 'Full' : 'Online') : 'Offline';
  const effective = { ...config, code: live.connected && live.code ? live.code : config.code };
  return card('Session Status', 'Welcome to **Alaska State Roleplay** sessions. Our staff team manages session announcements in this channel.\n\n' +
    (active ? `**Session host:** <@${current.hostId}>` : 'Watch this channel for the next session startup.') +
    (!live.connected ? '\n-# Live player statistics are currently unavailable.' : ''), {
    banner: 'sessions', imageURL: config.banner,
    metrics: [
      { name: 'Players', description: 'How many players are in-game', value: live.connected ? `${live.players}/${live.maxPlayers}` : 'Unavailable' },
      { name: 'Queue', description: 'How many players are waiting to join', value: live.connected ? live.queue : 'Unavailable' },
      { name: 'Staff', description: 'How many staff are in-game moderating', value: live.connected ? live.staff : 'Unavailable' }],
    rows: [new ActionRowBuilder().addComponents(...sessionButtons(effective, true, true, status))] });
}
export function affiliationsPanel(settings, guildId) {
  return card('Affiliations', 'Interested in affiliating with **Alaska State Roleplay**?\n\nOpen a support ticket and share your community information so our team can review your enquiry.', {
    banner: 'affiliations', rows: settings.tickets.panelChannelId ? [new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setLabel('Contact Support').setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}/${settings.tickets.panelChannelId}`))] : [] });
}
export function ticketPanel(ticket, banner = null, notify = false) {
  const details = ticketDetails(ticket);
  const joined = details.joinedAt ? `<t:${Math.floor(details.joinedAt / 1000)}:F>` : 'Unavailable';
  return card(`Support Ticket #${ticket.id}`, (notify ? `<@${ticket.owner_id}> <@&${ticket.support_role_id}>\n\n` : '') +
    `Thank you for contacting our team. Please be patient while we review your request.\n\n` +
    `**Information**\n- **User:** <@${ticket.owner_id}>\n- **ID:** ${ticket.owner_id}\n- **Joined:** ${joined}\n` +
    `- **Type:** ${TICKET_TYPES[details.type]?.label || 'General Support'}\n` +
    `- **Status:** ${ticket.claimed_by ? `Claimed by <@${ticket.claimed_by}>` : 'Unclaimed'}\n\n**Ticket Form**\n` +
    (details.reportedUserId ? `- **Staff:** <@${details.reportedUserId}>\n` : '') + `- **Inquiry:** ${ticket.subject}`, {
    banner: 'support', imageURL: banner, rows: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:${ticket.claimed_by ? 'unclaim' : 'claim'}:${ticket.id}`).setLabel(ticket.claimed_by ? 'Unclaim' : 'Claim Ticket')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger)),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`ticket:actions:${ticket.id}`).setPlaceholder('Ticket controls')
      .addOptions({ label: 'Export transcript', value: 'transcript' }, { label: 'Request closure', value: 'request' }, { label: 'Rename ticket', value: 'rename' }))],
    mentions: notify ? { parse: [], users: [ticket.owner_id], roles: [ticket.support_role_id] } : { parse: [] } });
}
export function ticketModal(type = 'general') {
  const modal = new ModalBuilder().setCustomId(`ticket:create:${type}`).setTitle('Ticket Form');
  if (type === 'internal') modal.addLabelComponents(new LabelBuilder().setLabel('Staff member')
    .setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId('staff').setMinValues(1).setMaxValues(1)));
  return modal.addLabelComponents(new LabelBuilder().setLabel(type === 'internal' ? 'Reason for the report' : 'How can we help?')
    .setTextInputComponent(new TextInputBuilder().setCustomId('subject').setStyle(TextInputStyle.Paragraph)
      .setMinLength(5).setMaxLength(1000).setRequired(true)));
}
export function closeModal(id, customId = `ticket:finish:${id}`, value = '') {
  const input = new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(500).setRequired(true);
  if (value) input.setValue(value.slice(0,500));
  return new ModalBuilder().setCustomId(customId).setTitle('Close Ticket').addLabelComponents(
    new LabelBuilder().setLabel('Reason for closing').setTextInputComponent(input));
}
export function votePanel(vote, voters, config) {
  return card('Session Vote', (config.pingRoleId ? `<@&${config.pingRoleId}>\n\n` : '') +
    `> Cast your vote for the next session. We require **${vote.goal} votes**. Please only vote if you intend to join.\n\n` +
    (vote.state === 'passed' ? '**The vote target has been reached. Please wait for a staff startup announcement.**' : vote.state === 'closed' ? 'This session vote has ended.' : 'Use the vote button below to participate.'), {
    banner: 'sessions', imageURL: config.banner, rows: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`session:vote:${vote.id}`).setLabel(`${voters.length}/${vote.goal}`).setStyle(ButtonStyle.Primary).setDisabled(vote.state !== 'open'),
      new ButtonBuilder().setCustomId(`session:voters:${vote.id}`).setLabel('View Voters').setStyle(ButtonStyle.Secondary))],
    mentions: { parse: [], users: [], roles: config.pingRoleId ? [config.pingRoleId] : [] } });
}
export function ticketNotice(title, text, rows = []) { return card(title, text, { rows }); }
