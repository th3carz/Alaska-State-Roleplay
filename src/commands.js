import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';

const textOption = (builder, name, description, required = false, max = 1500) =>
  builder.addStringOption(o => o.setName(name).setDescription(description).setRequired(required).setMaxLength(max));
const channelOption = (builder, name, description, types, required = true) =>
  builder.addChannelOption(o => o.setName(name).setDescription(description).addChannelTypes(...types).setRequired(required));

const configure = new SlashCommandBuilder().setName('configure').setDescription('Configure the three bot systems')
  .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(s => {
    s.setName('welcome').setDescription('Set welcome channel, message, and banner');
    channelOption(s, 'channel', 'Welcome channel', [ChannelType.GuildText]);
    textOption(s, 'message', 'Variables: {user}, {username}, {server}, {memberCount}');
    textOption(s, 'banner', 'HTTPS image URL, or none to remove', false, 500);
    return s.addBooleanOption(o => o.setName('enabled').setDescription('Send welcome messages when members join'));
  })
  .addSubcommand(s => {
    s.setName('sessions').setDescription('Set ER:LC session channel, code, and staff');
    channelOption(s, 'channel', 'Session announcements channel', [ChannelType.GuildText]);
    textOption(s, 'code', 'ER:LC private server join code', true, 64);
    s.addRoleOption(o => o.setName('staff-role').setDescription('Role allowed to manage sessions'));
    s.addRoleOption(o => o.setName('ping-role').setDescription('Optional role pinged on session announcements'));
    textOption(s, 'banner', 'HTTPS image URL, or none to remove', false, 500);
    return s.addBooleanOption(o => o.setName('clear-ping').setDescription('Remove the configured ping role'));
  })
  .addSubcommand(s => {
    s.setName('tickets').setDescription('Set private ticket category, support role, and transcript channel');
    channelOption(s, 'category', 'Category for private tickets', [ChannelType.GuildCategory]);
    s.addRoleOption(o => o.setName('support-role').setDescription('Support staff with ticket access').setRequired(true));
    channelOption(s, 'logs', 'Private staff channel for transcripts', [ChannelType.GuildText]);
    return textOption(s, 'banner', 'HTTPS image URL, or none to remove', false, 500);
  })
  .addSubcommand(s => {
    s.setName('panels').setDescription('Configure automatic home, session, and support panels');
    channelOption(s, 'home', 'Home panel channel', [ChannelType.GuildText], false);
    channelOption(s, 'support', 'Support panel channel', [ChannelType.GuildText], false);
    return s.addBooleanOption(o => o.setName('enabled').setDescription('Automatically post and maintain the three panels'));
  })
  .addSubcommand(s => s.setName('view').setDescription('Show saved settings'));

const session = new SlashCommandBuilder().setName('session').setDescription('Manage ER:LC session announcements').setDMPermission(false);
for (const [name, description] of Object.entries({
  start: 'Announce a session startup', boost: 'Announce a session boost',
  full: 'Announce that the session is full', end: 'Announce that the session has ended',
})) session.addSubcommand(s => textOption(s.setName(name).setDescription(description), 'message', 'Optional custom announcement message'));

const ticket = new SlashCommandBuilder().setName('ticket').setDescription('Private support ticket controls').setDMPermission(false)
  .addSubcommand(s => channelOption(s.setName('panel').setDescription('Post a ticket panel (Manage Server required)'),
    'channel', 'Where to post the panel', [ChannelType.GuildText], false))
  .addSubcommand(s => s.setName('claim').setDescription('Claim this ticket (support staff)'))
  .addSubcommand(s => s.setName('unclaim').setDescription('Release your claim on this ticket'))
  .addSubcommand(s => textOption(s.setName('close').setDescription('Close this ticket and save a transcript'),
    'reason', 'Reason for closing', true, 500));

export const commands = [configure, session, ticket,
  new SlashCommandBuilder().setName('welcome-test').setDescription('Preview the welcome message privately')
    .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('scan').setDescription('Export ordered channel/role IDs and all server emojis')
    .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map(c => c.toJSON());
