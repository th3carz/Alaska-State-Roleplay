import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, ChannelType as C, PermissionFlagsBits as P, PermissionsBitField, MessageFlags } from 'discord.js';
import { buildScan, fetchServerScan, scanFiles } from '../src/scan.js';
import { Bot } from '../src/bot.js';
import { GUILD_ID } from '../src/store.js';
import { commands } from '../src/commands.js';

const collection = rows => new Collection(rows.map(row => [row.id, row]));
const channel = (id, type, rawPosition, parentId = null) => ({ id, name: `channel-${id}`, type,
  rawPosition, position: rawPosition, parentId });
const role = (id, rawPosition) => ({ id, name: `role-${id}`, rawPosition, position: rawPosition,
  managed: false, hoist: false, mentionable: false, hexColor: '#000000' });
const emoji = (id, name, animated) => ({ id, name, animated, available: true, managed: false,
  roles: { cache: new Collection() }, imageURL: ({ extension }) => `https://cdn.discordapp.com/emojis/${id}.${extension}` });
const guild = { id: GUILD_ID, name: 'Alaska State Roleplay' };

test('scan preserves category hierarchy, type buckets, raw positions, and snowflake ties', () => {
  const channels = collection([
    channel('401', C.GuildVoice, 0, '100'), channel('300', C.GuildText, 9, '100'),
    channel('200', C.GuildCategory, 1), channel('101', C.GuildText, 0),
    channel('100', C.GuildCategory, 0), channel('301', C.GuildAnnouncement, 9, '100'),
    channel('102', C.GuildVoice, 0), channel('202', C.GuildForum, 2, '200'),
  ]);
  const scan = buildScan(guild, channels, collection([]), collection([]));
  assert.deepEqual(scan.channels.map(c => c.id), ['101', '102', '100', '300', '301', '401', '200', '202']);
  assert.deepEqual(scan.channels.map(c => c.order), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(scan.channels.find(c => c.id === '300').parentId, '100');
  assert.equal(scan.channels.find(c => c.id === '300').depth, 1);
  assert.equal(scan.channels.find(c => c.id === '300').rawPosition, 9);
  assert.equal(scan.counts.categories, 2);
});

test('role export is highest to lowest with deterministic ties and everyone last', () => {
  const scan = buildScan(guild, collection([]), collection([
    role('300', 5), role(GUILD_ID, 0), role('200', 5), role('400', 9), role('500', 0),
  ]), collection([]));
  assert.deepEqual(scan.roles.map(r => r.id), ['400', '200', '300', '500', GUILD_ID]);
});

test('JSON/TXT exports preserve large IDs and distinguish static and animated emoji codes/links', () => {
  const scan = buildScan(guild, collection([]), collection([]), collection([
    emoji('1561501281355300895', 'loading', true), emoji('1561501281355300896', 'check', false),
  ]), '2026-10-18T22:40:00.000Z');
  const files = scanFiles(scan);
  const data = JSON.parse(files[0].attachment.toString('utf8'));
  const txt = files[1].attachment.toString('utf8');
  assert.equal(data.guild.id, GUILD_ID);
  assert.equal(data.counts.animatedEmojis, 1);
  assert.equal(data.emojis[0].mention, '<:check:1561501281355300896>');
  assert.equal(data.emojis[1].mention, '<a:loading:1561501281355300895>');
  assert.match(data.emojis[1].imageURL, /\.gif$/);
  assert.match(txt, /<a:loading:1561501281355300895>/);
  assert.ok(files[0].name.endsWith('.json'));
  assert.ok(files[1].name.endsWith('.txt'));
});

test('a channel whose parent is unavailable remains in the export and is identified', () => {
  const scan = buildScan(guild, collection([channel('999', C.GuildText, 5, '888')]), collection([]), collection([]));
  assert.deepEqual(scan.unresolvedParentChannelIds, ['999']);
  assert.equal(scan.channels[0].parentId, '888');
});

test('scan refreshes all three inventories on every run and fails instead of sending partial data', async () => {
  const hits = [];
  const fresh = { ...guild, ...Object.fromEntries(['channels', 'roles', 'emojis'].map(key => [key,
    { fetch: async () => { hits.push(key); return collection([]); } }])) };
  await fetchServerScan(fresh);
  await fetchServerScan(fresh);
  assert.deepEqual(hits, ['channels', 'roles', 'emojis', 'channels', 'roles', 'emojis']);
  fresh.emojis.fetch = async () => { throw new Error('API unavailable'); };
  await assert.rejects(fetchServerScan(fresh), /API unavailable/);
});

test('scan is manager-only at command registration and runtime, and returns private attachments', async () => {
  const definition = commands.find(c => c.name === 'scan');
  assert.equal(definition.default_member_permissions, P.ManageGuild.toString());
  assert.equal(definition.dm_permission, false);
  const bot = new Bot({}, {});
  bot.member = async () => ({ permissions: new PermissionsBitField() });
  await assert.rejects(bot.scan({}), /Manage Server/);
  bot.member = async () => ({ permissions: new PermissionsBitField([P.ManageGuild]) });
  let deferred;
  let reply;
  const empty = () => Promise.resolve(collection([]));
  await bot.handle({ isChatInputCommand: () => true, isButton: () => false, isModalSubmit: () => false,
    inGuild: () => true, guildId: GUILD_ID, commandName: 'scan',
    guild: { ...guild, channels: { fetch: empty }, roles: { fetch: empty }, emojis: { fetch: empty } },
    deferReply: async payload => { deferred = payload; }, editReply: async payload => { reply = payload; } });
  assert.equal(deferred.flags, MessageFlags.Ephemeral);
  assert.equal(reply.files.length, 2);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});
