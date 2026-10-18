import { AttachmentBuilder, ChannelType } from 'discord.js';
import { APPLICATION_ID, BOT_NAME } from './store.js';

const snowflakeOrder = (a, b) => a === b ? 0 : BigInt(a) < BigInt(b) ? -1 : 1;
const channelOrder = (a, b) => a.rawPosition - b.rawPosition || snowflakeOrder(a.id, b.id);
const bucket = channel => [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type) ? 1 : 0;
const childOrder = (a, b) => bucket(a) - bucket(b) || channelOrder(a, b);
const typeName = type => ChannelType[type] ?? `Unknown(${type})`;

export function buildScan(guild, channels, roles, emojis, exportedAt = new Date().toISOString()) {
  const all = [...channels.values()].filter(Boolean);
  const byId = new Map(all.map(channel => [channel.id, channel]));
  const categories = all.filter(c => c.type === ChannelType.GuildCategory).sort(channelOrder);
  const orderedChannels = [];
  const added = new Set();
  function add(channel, depth, siblingOrder) {
    if (added.has(channel.id)) return;
    added.add(channel.id);
    orderedChannels.push({ order: orderedChannels.length + 1, depth, siblingOrder,
      id: channel.id, name: channel.name, type: channel.type, typeName: typeName(channel.type),
      parentId: channel.parentId ?? null, parentName: byId.get(channel.parentId)?.name ?? null,
      rawPosition: channel.rawPosition, position: channel.position });
  }
  all.filter(c => c.type !== ChannelType.GuildCategory && !c.parentId).sort(childOrder)
    .forEach((c, index) => add(c, 0, index + 1));
  categories.forEach((category, index) => {
    add(category, 0, index + 1);
    all.filter(c => c.parentId === category.id && c.type !== ChannelType.GuildCategory).sort(childOrder)
      .forEach((c, childIndex) => add(c, 1, childIndex + 1));
  });
  // Preserve a channel even if Discord omitted its parent category from this snapshot.
  const unresolved = all.filter(c => !added.has(c.id)).sort((a, b) =>
    snowflakeOrder(a.parentId ?? a.id, b.parentId ?? b.id) || childOrder(a, b));
  unresolved.forEach((c, index) => add(c, c.parentId ? 1 : 0, index + 1));

  const orderedRoles = [...roles.values()].sort((a, b) => {
    if (a.id === b.id) return 0;
    if (a.id === guild.id) return 1;
    if (b.id === guild.id) return -1;
    return b.rawPosition - a.rawPosition || snowflakeOrder(a.id, b.id);
  }).map((role, index) => ({ order: index + 1, id: role.id, name: role.name,
    rawPosition: role.rawPosition, position: role.position, color: role.hexColor,
    managed: role.managed, hoist: role.hoist, mentionable: role.mentionable }));
  const orderedEmojis = [...emojis.values()].sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? '', 'en') || snowflakeOrder(a.id, b.id))
    .map((emoji, index) => ({ order: index + 1, id: emoji.id, name: emoji.name,
      animated: !!emoji.animated, available: emoji.available, managed: emoji.managed,
      mention: `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`,
      imageURL: emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png', size: 128 }),
      restrictedRoleIds: [...emoji.roles.cache.keys()].sort(snowflakeOrder) }));

  return { schemaVersion: 1, exportedAt, bot: { id: APPLICATION_ID, name: BOT_NAME },
    guild: { id: guild.id, name: guild.name },
    ordering: {
      channels: 'Server channel order: uncategorized channels first, then categories and their children. Text/forum/media channels precede voice/stage channels within each group; ties use snowflake ID. Raw positions and parent IDs are retained.',
      roles: 'Top to bottom role hierarchy; @everyone is last. Raw positions and snowflake tie order are retained.',
      emojis: 'Name then ID; emojis have no server hierarchy position.',
    },
    scope: 'Fresh Discord API snapshot of server channels, all roles (including managed roles and @everyone), and all server custom emojis. Threads/forum posts, member lists, message content, and personal client channel ordering are excluded. Only channel metadata Discord exposes to this bot can be exported.',
    counts: { channels: all.length, categories: categories.length, roles: orderedRoles.length,
      emojis: orderedEmojis.length, animatedEmojis: orderedEmojis.filter(e => e.animated).length },
    unresolvedParentChannelIds: unresolved.map(c => c.id),
    channels: orderedChannels, roles: orderedRoles, emojis: orderedEmojis };
}

export function scanText(scan) {
  const line = value => String(value ?? '').replace(/[\r\n\t]/g, ' ');
  const out = [BOT_NAME + ' — Server Scan', `Server: ${line(scan.guild.name)} | ID: ${scan.guild.id}`,
    `Exported: ${scan.exportedAt}`, '', 'CHANNELS — server order, top to bottom', scan.ordering.channels];
  for (const c of scan.channels) out.push(`${'  '.repeat(c.depth)}${c.order}. [${c.typeName}] ${line(c.name)} | ID: ${c.id} | parent: ${c.parentId ?? 'none'} | raw position: ${c.rawPosition} | position: ${c.position}`);
  out.push('', 'ROLES — highest to lowest');
  for (const r of scan.roles) out.push(`${r.order}. ${line(r.name)} | ID: ${r.id} | raw position: ${r.rawPosition} | position: ${r.position} | managed: ${r.managed}`);
  out.push('', 'EMOJIS — alphabetical', scan.ordering.emojis);
  for (const e of scan.emojis) out.push(`${e.order}. ${line(e.name)} | ID: ${e.id} | animated: ${e.animated} | available: ${e.available}\n   ${e.mention} | ${e.imageURL} | restricted roles: ${e.restrictedRoleIds.join(', ') || 'none'}`);
  out.push('', 'COUNTS', JSON.stringify(scan.counts), '', 'SCOPE', scan.scope);
  if (scan.unresolvedParentChannelIds.length) out.push('', 'Channels with a missing parent in this snapshot: ' + scan.unresolvedParentChannelIds.join(', '));
  return out.join('\n');
}

export async function fetchServerScan(guild) {
  // Fetch the complete inventories on each command; never export a potentially stale cache.
  const [channels, roles, emojis] = await Promise.all([
    guild.channels.fetch(), guild.roles.fetch(), guild.emojis.fetch(),
  ]);
  return buildScan(guild, channels, roles, emojis);
}

export function scanFiles(scan) {
  const filename = `AlaskaOperations-ServerScan-${scan.guild.id}-${scan.exportedAt.replace(/[:.]/g, '-')}`;
  return [new AttachmentBuilder(Buffer.from(JSON.stringify(scan, null, 2), 'utf8'), { name: `${filename}.json` }),
    new AttachmentBuilder(Buffer.from(scanText(scan), 'utf8'), { name: `${filename}.txt` })];
}
