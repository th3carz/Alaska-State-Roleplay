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
    textOption(s, 'server-name', 'ER:LC server display name', false, 100);
    textOption(s, 'owner-name', 'ER:LC server owner display name', false, 100);
    return s.addBooleanOption(o => o.setName('clear-ping').setDescription('Remove the configured ping role'));
  })
  .addSubcommand(s => {
    s.setName('tickets').setDescription('Set private ticket category, support role, and transcript channel');
    channelOption(s, 'category', 'Category for private tickets', [ChannelType.GuildCategory]);
    s.addRoleOption(o => o.setName('support-role').setDescription('Support staff with ticket access').setRequired(true));
    channelOption(s, 'logs', 'Private staff channel for transcripts', [ChannelType.GuildText]);
    textOption(s, 'banner', 'HTTPS image URL, or none to remove', false, 500);
    s.addRoleOption(o => o.setName('report-role').setDescription('Management role handling staff reports'));
    return s.addRoleOption(o => o.setName('management-role').setDescription('Senior role handling management support'));
  })
  .addSubcommand(s => {
    s.setName('panels').setDescription('Configure automatic information panels');
    channelOption(s, 'home', 'Home panel channel', [ChannelType.GuildText], false);
    channelOption(s, 'support', 'Support panel channel', [ChannelType.GuildText], false);
    channelOption(s, 'affiliations', 'Affiliations information panel channel', [ChannelType.GuildText], false);
    return s.addBooleanOption(o => o.setName('enabled').setDescription('Automatically post and maintain the information panels'));
  })
  .addSubcommand(s => s.setName('view').setDescription('Show saved settings'));

const session = new SlashCommandBuilder().setName('session').setDescription('Manage ER:LC session announcements').setDMPermission(false);
for (const [name, description] of Object.entries({
  start: 'Announce a session startup', boost: 'Announce a session boost',
  full: 'Announce that the session is full', end: 'Announce that the session has ended',
})) session.addSubcommand(s => textOption(s.setName(name).setDescription(description), 'message', 'Optional custom announcement message'));
for (const [name, description] of Object.entries({ startup: 'Announce a session startup', shutdown: 'Announce a session shutdown' }))
  session.addSubcommand(s => textOption(s.setName(name).setDescription(description), 'message', 'Optional custom announcement message'));
session.addSubcommand(s => s.setName('panel').setDescription('Post or refresh the permanent session panel'))
  .addSubcommand(s => s.setName('vote').setDescription('Open a session vote').addIntegerOption(o =>
    o.setName('votes').setDescription('Votes required before staff start the session').setMinValue(1).setMaxValue(1000).setRequired(true)))
  .addSubcommand(s => s.setName('cancel-vote').setDescription('Cancel the open session vote'));

const ticket = new SlashCommandBuilder().setName('ticket').setDescription('Private support ticket controls').setDMPermission(false)
  .addSubcommand(s => channelOption(s.setName('panel').setDescription('Post a ticket panel (Manage Server required)'),
    'channel', 'Where to post the panel', [ChannelType.GuildText], false))
  .addSubcommand(s => s.setName('claim').setDescription('Claim this ticket (support staff)'))
  .addSubcommand(s => s.setName('unclaim').setDescription('Release your claim on this ticket'))
  .addSubcommand(s => textOption(s.setName('close').setDescription('Close this ticket and save a transcript'),
    'reason', 'Reason for closing', true, 500))
  .addSubcommand(s => textOption(s.setName('request-close').setDescription('Ask whether the ticket can close'), 'reason', 'Reason to request closure', true, 500))
  .addSubcommand(s => textOption(s.setName('rename').setDescription('Rename the current ticket (support staff)'), 'name', 'New ticket name', true, 60))
  .addSubcommand(s => s.setName('transcript').setDescription('Export a transcript without closing the ticket'));
for (const action of ['add','remove']) ticket.addSubcommand(s => s.setName(action).setDescription(`${action === 'add' ? 'Add' : 'Remove'} a user or role in this ticket`)
  .addMentionableOption(o => o.setName('target').setDescription('User or role').setRequired(true)));

export const commands = [configure, session, ticket,
  new SlashCommandBuilder().setName('welcome-test').setDescription('Preview the welcome message privately')
    .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('scan').setDescription('Export ordered channel/role IDs and all server emojis')
    .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map(c => c.toJSON());
