import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { Bot } from '../src/bot.js';
import { Store, GUILD_ID, APPLICATION_ID } from '../src/store.js';
import { SERVER_SETTINGS, SERVER_SEED_KEY } from '../src/server-config.js';
import { isOurPanel } from '../src/panels.js';
import { homePanel, sessionStatusPanel, openPanel } from '../src/ui.js';
import { componentText } from '../src/layout.js';
const flatten = components => components.flatMap(c => { const x = c.toJSON ? c.toJSON() : c; return [x, ...flatten(x.components || [])]; });

function fixture(t) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.seedSettings(SERVER_SETTINGS, SERVER_SEED_KEY);
  const bot = new Bot({}, store);
  const messages = new Collection();
  let nextId = 1000;
  const stats = { sends: 0, edits: 0, fetches: 0 };
  const channel = { id: 'channel', name: 'support',
    permissionsFor: () => new PermissionsBitField([P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles]),
    messages: { fetch: async options => {
      stats.fetches++;
      if (options.message) {
        if (!messages.has(options.message)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
        return messages.get(options.message);
      }
      const eligible = [...messages.values()].filter(m => !options.before || BigInt(m.id) < BigInt(options.before))
        .sort((a, b) => Number(BigInt(b.id) - BigInt(a.id))).slice(0, options.limit);
      return new Collection(eligible.map(m => [m.id, m]));
    } }, send: async payload => {
      stats.sends++;
      const message = { id: String(nextId++), author: { id: APPLICATION_ID }, embeds: (payload.embeds || []).map(e => e.toJSON()),
        components: payload.components.map(c => c.toJSON()),
        edit: async newPayload => { stats.edits++; message.embeds = (newPayload.embeds || []).map(e => e.toJSON()); message.components = newPayload.components.map(c => c.toJSON()); return message; } };
      messages.set(message.id, message);
      return message;
    } };
  bot.channel = async () => channel;
  bot.botMember = async () => ({ id: APPLICATION_ID });
  const guild = { id: GUILD_ID };
  const definition = { kind: 'support', channelId: channel.id, payload: openPanel(store.settings().tickets) };
  return { store, bot, messages, stats, channel, guild, definition };
}

test('scan settings seed missing fields and preserve explicit configuration and later changes', t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.configure('welcome', { channelId: 'chosen-channel', enabled: false });
  store.configure('sessions', { code: 'ChosenCode' });
  store.seedSettings(SERVER_SETTINGS, SERVER_SEED_KEY);
  assert.equal(store.settings().welcome.channelId, 'chosen-channel');
  assert.equal(store.settings().welcome.enabled, false);
  assert.equal(store.settings().sessions.code, 'ChosenCode');
  assert.equal(store.settings().tickets.panelChannelId, '1560914284979167252');
  store.configure('sessions', { pingRoleId: null });
  store.seedSettings(SERVER_SETTINGS, SERVER_SEED_KEY);
  assert.equal(store.settings().sessions.pingRoleId, null);
});

test('repeated panel maintenance and lost message-ID records reuse the existing bot panel', async t => {
  const { store, bot, guild, definition, stats } = fixture(t);
  const first = await bot.panels.ensure(guild, definition);
  const second = await bot.panels.ensure(guild, definition);
  // Simulate an ephemeral host losing the local panel table on redeploy.
  store.db.exec('DELETE FROM panels');
  const third = await bot.panels.ensure(guild, definition);
  assert.equal(stats.sends, 1);
  assert.equal(stats.edits, 2);
  assert.equal(first.messageId, second.messageId);
  assert.equal(first.messageId, third.messageId);
});

test('a deleted tracked panel is recreated once and its new message ID is saved', async t => {
  const { store, bot, guild, definition, messages, stats } = fixture(t);
  const first = await bot.panels.ensure(guild, definition);
  messages.delete(first.messageId);
  const replacement = await bot.panels.ensure(guild, definition);
  await bot.panels.ensure(guild, definition);
  assert.equal(stats.sends, 2);
  assert.notEqual(first.messageId, replacement.messageId);
  assert.equal(store.panelForMessage(replacement.messageId).kind, 'support');
});

test('failed history access keeps the bot from posting a duplicate panel', async t => {
  const { bot, guild, definition, channel, stats } = fixture(t);
  channel.messages.fetch = async () => { throw new Error('History unavailable'); };
  await assert.rejects(bot.panels.ensure(guild, definition), /History unavailable/);
  assert.equal(stats.sends, 0);
});

test('the panel history search checks beyond the latest 100 messages', async t => {
  const { bot, guild, definition, messages, stats, store } = fixture(t);
  const original = await bot.panels.ensure(guild, definition);
  store.db.exec('DELETE FROM panels');
  for (let n = 1001; n <= 1101; n++) messages.set(String(n), {
    id: String(n), author: { id: APPLICATION_ID }, embeds: [{ title: 'A session announcement' }],
  });
  await bot.panels.ensure(guild, definition);
  assert.equal(stats.sends, 1);
  assert.equal(store.panel('support').message_id, original.messageId);
  assert.ok(stats.fetches >= 3);
});

test('similar panels from other bots are ignored and wrong-server writes are rejected', async t => {
  const { bot, guild, definition, messages, stats } = fixture(t);
  const foreign = { id: '999', author: { id: 'other-bot' }, embeds: [{ title: 'Support Tickets' }] };
  messages.set(foreign.id, foreign);
  assert.equal(isOurPanel(foreign, 'support', APPLICATION_ID), false);
  await bot.panels.ensure(guild, definition);
  assert.equal(stats.sends, 1);
  await assert.rejects(bot.panels.ensure({ id: 'other-server' }, definition), /outside Alaska/);
});

test('one failed panel does not block posting the remaining panels, and automatic posting can be disabled', async t => {
  const { bot, guild, store } = fixture(t);
  const calls = [];
  bot.panels.ensure = async (_, definition) => {
    calls.push(definition.kind);
    if (definition.kind === 'home') throw new Error('Permission missing');
    return { action: 'created', messageId: definition.kind };
  };
  const results = await bot.panels.sync(guild);
  assert.deepEqual(calls, ['home', 'sessions', 'support']);
  assert.equal(results.filter(r => r.error).length, 1);
  store.configure('panels', { enabled: false });
  assert.deepEqual(await bot.panels.sync(guild), []);
  assert.equal(calls.length, 3);
});

test('home links use scanned channels and an unconfigured session code produces no fake join link', t => {
  const { store } = fixture(t);
  const settings = store.settings();
  const home = homePanel(settings, GUILD_ID);
  const urls = flatten(home.components).map(b => b.url);
  assert.ok(urls.includes(`https://discord.com/channels/${GUILD_ID}/1560914284979167252`));
  const offline = sessionStatusPanel(settings.sessions, null);
  assert.ok(!flatten(offline.components).some(c => c.url?.startsWith('https://erlc.gg/')));
  assert.ok(flatten(offline.components).some(c => c.label === 'Offline'));
  const active = sessionStatusPanel({ ...settings.sessions, code: 'ASRP' }, { status: 'full', hostId: 'staff' });
  assert.ok(flatten(active.components).some(c => c.label === 'Full'));
  assert.ok(flatten(active.components).some(c => c.url === 'https://erlc.gg/join/ASRP'));
  assert.ok(componentText(active.components).includes('Session Status'));
});
