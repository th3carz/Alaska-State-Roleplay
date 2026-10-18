import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { SERVER_NAME, BOT_NAME } from './store.js';
import { SERVER_EMOJIS } from './server-config.js';

export const COLORS = { blue: 0x337ca0, green: 0x45a179, orange: 0xd89b45, red: 0xbc525a };
export function embed(title, text, color = COLORS.blue, banner = null) {
  const e = new EmbedBuilder().setColor(color).setTitle(title).setDescription(text)
    .setFooter({ text: `${BOT_NAME} | ${SERVER_NAME}` }).setTimestamp();
  if (banner) e.setImage(banner);
  return e;
}
export function validBanner(value) {
  if (value === null) return undefined;
  if (value.toLowerCase() === 'none') return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('Banner must be an HTTPS image URL, or none.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS image URL without credentials.');
  return url.href;
}
export function welcomePayload(member, config) {
  const vars = { user: `<@${member.id}>`, username: member.user.username,
    server: SERVER_NAME, memberCount: String(member.guild.memberCount) };
  const text = config.message.replace(/\{(user|username|server|memberCount)\}/g, (_, key) => vars[key]);
  return { content: `<@${member.id}>`, embeds: [embed(`Welcome to ${SERVER_NAME}`, text, COLORS.blue, config.banner)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))],
    allowedMentions: { parse: [], users: [member.id], roles: [] } };
}
export const sessionDetails = {
  start: { title: 'Session Startup', text: 'Our ER:LC session is now open. Join Alaska State Roleplay using the button below.', color: COLORS.green },
  boost: { title: 'Session Boost', text: 'We are looking for more players. Join the active session and help bring Alaska to life.', color: COLORS.orange },
  full: { title: 'Session Full', text: 'Our ER:LC server is currently full. Thank you for joining us; please wait for a space to open.', color: COLORS.orange },
  end: { title: 'Session Ended', text: 'Our ER:LC session has ended. Thank you for joining Alaska State Roleplay.', color: COLORS.red },
};
export function assertSessionTransition(current, action) {
  if (!sessionDetails[action]) throw new Error('Unknown session action.');
  const active = current && current.status !== 'end';
  if (action === 'start' && active) throw new Error('A session is already active. End it before starting another.');
  if (action !== 'start' && !active) throw new Error('Start a session first with /session start.');
}
export function sessionPayload(action, config, hostId, message) {
  const detail = sessionDetails[action];
  const body = embed(detail.title, message || detail.text, detail.color, config.banner)
    .addFields({ name: 'Server Code', value: config.code, inline: true },
      { name: 'Session Host', value: `<@${hostId}>`, inline: true });
  return { content: config.pingRoleId ? `<@&${config.pingRoleId}>` : undefined,
    embeds: [body], components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setLabel('Quick Join').setStyle(ButtonStyle.Link).setURL(`https://erlc.gg/join/${encodeURIComponent(config.code)}`))],
    allowedMentions: { parse: [], users: [], roles: config.pingRoleId ? [config.pingRoleId] : [] } };
}
export function openPanel(config) {
  return { embeds: [embed('Support Tickets', 'Need help? Open a private ticket and explain what you need.\n\nPlease keep one ticket open at a time.', COLORS.blue, config.banner)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId('ticket:open').setLabel('Open Ticket').setEmoji(SERVER_EMOJIS.ticket).setStyle(ButtonStyle.Primary))],
    allowedMentions: { parse: [] } };
}
export function homePanel(settings, guildId) {
  const buttons = [];
  if (settings.sessions.channelId) buttons.push(new ButtonBuilder().setLabel('Sessions').setEmoji(SERVER_EMOJIS.link)
    .setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guildId}/${settings.sessions.channelId}`));
  if (settings.tickets.panelChannelId) buttons.push(new ButtonBuilder().setLabel('Support').setEmoji(SERVER_EMOJIS.support)
    .setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guildId}/${settings.tickets.panelChannelId}`));
  return { embeds: [embed(SERVER_NAME,
    'Welcome to **Alaska State Roleplay**. We hope you enjoy your time in our community.\n\n' +
    'Find our latest roleplay sessions in the sessions channel. If you need assistance, open a private ticket through Support.')],
    components: buttons.length ? [new ActionRowBuilder().addComponents(...buttons)] : [], allowedMentions: { parse: [] } };
}
export function sessionStatusPanel(config, current) {
  const active = current && current.status !== 'end';
  const status = active ? ({ start: 'Online', boost: 'Online — Session Boost', full: 'Full' }[current.status] ?? 'Online') : 'Offline';
  const body = embed('Session Status', active ? 'An Alaska State Roleplay session is active.' :
    'There is no active session. Session announcements will be posted in this channel.', active ? COLORS.green : COLORS.red, config.banner)
    .addFields({ name: 'Status', value: status, inline: true },
      { name: 'Server Code', value: config.code || 'Join details will be posted before the next session.', inline: true });
  if (active && current.hostId) body.addFields({ name: 'Session Host', value: `<@${current.hostId}>`, inline: true });
  const buttons = config.code ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Quick Join')
    .setEmoji(SERVER_EMOJIS.link).setStyle(ButtonStyle.Link).setURL(`https://erlc.gg/join/${encodeURIComponent(config.code)}`))] : [];
  return { embeds: [body], components: buttons, allowedMentions: { parse: [] } };
}
export function ticketPanel(ticket, banner = null) {
  return { embeds: [embed(`Support Ticket #${ticket.id}`,
    `**Opened by:** <@${ticket.owner_id}>\n**Status:** ${ticket.claimed_by ? `Claimed by <@${ticket.claimed_by}>` : 'Unclaimed'}\n\n**Request**\n${ticket.subject}`,
    COLORS.blue, banner)], components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel(ticket.claimed_by ? 'Unclaim' : 'Claim Ticket')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger))],
    allowedMentions: { parse: [] } };
}
export function ticketModal() {
  return new ModalBuilder().setCustomId('ticket:create').setTitle('Open a Support Ticket')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('subject').setLabel('How can we help?').setStyle(TextInputStyle.Paragraph)
      .setMinLength(5).setMaxLength(1000).setRequired(true)));
}
export function closeModal(id) {
  return new ModalBuilder().setCustomId(`ticket:finish:${id}`).setTitle('Close Ticket')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('reason').setLabel('Reason for closing').setStyle(TextInputStyle.Paragraph)
      .setMinLength(3).setMaxLength(500).setRequired(true)));
}
