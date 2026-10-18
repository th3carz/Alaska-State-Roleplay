import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection, PermissionFlagsBits as P, PermissionsBitField, ChannelType } from 'discord.js';
import { Store, Locks, GUILD_ID } from '../src/store.js';
import { Bot, ticketOverwrites, requireTicketAccess, validatePrivateLogs } from '../src/bot.js';
import { assertSessionTransition, welcomePayload, sessionPayload } from '../src/ui.js';
import { commands } from '../src/commands.js';
import { collectTranscript, renderTranscript } from '../src/transcript.js';
const flatten = components => components.flatMap(c => { const x = c.toJSON ? c.toJSON() : c; return [x, ...flatten(x.components || [])]; });

function fixture(t) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.configure('tickets', { categoryId: 'category', supportRoleId: 'support', logChannelId: 'logs' });
  return { store, bot: new Bot({}, store) };
}
const member = (id, support = false, manager = false) => ({ id,
  permissions: new PermissionsBitField(manager ? [P.ManageGuild] : []),
  roles: { cache: new Collection(support ? [['support', {}]] : []) } });
const ticket = store => {
  const row = store.reserveTicket('owner', 'Please help with a server issue', store.settings().tickets);
  return store.updateTicket(row.id, { channel_id: 'ticket-channel', state: 'open', panel_id: 'panel' });
};
const allPermissions = new PermissionsBitField(Object.values(P));
const channel = id => ({ id, name: id, type: ChannelType.GuildText,
  permissionsFor: () => allPermissions });

test('guild is fixed and commands contain the three systems and their setup/export tools', () => {
  assert.equal(GUILD_ID, '1534042183559282819');
  assert.deepEqual(commands.map(c => c.name), ['configure', 'session', 'ticket', 'welcome-test', 'scan']);
  for (const command of commands) assert.equal(command.dm_permission, false);
  for (const cmd of commands) for (const sub of cmd.options ?? []) {
    let optional = false;
    for (const option of sub.options ?? []) {
      if (!option.required) optional = true;
      else assert.equal(optional, false, `${cmd.name}/${sub.name}: required option after optional`);
    }
  }
});

test('SQLite preserves settings, active sessions, and claimed tickets across restarts', t => {
  const dir = mkdtempSync(join(tmpdir(), 'alaska-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite');
  let store = new Store(path);
  store.configure('tickets', { supportRoleId: 'support', logChannelId: 'logs' });
  store.configure('welcome', { channelId: 'welcome', enabled: false });
  const row = ticket(store);
  store.updateTicket(row.id, { claimed_by: 'staff' });
  store.saveSession({ status: 'start', hostId: 'staff' });
  store.close();
  store = new Store(path);
  assert.equal(store.settings().welcome.enabled, false);
  assert.equal(store.settings().welcome.channelId, 'welcome');
  assert.equal(store.session().hostId, 'staff');
  assert.equal(store.activeForOwner('owner').claimed_by, 'staff');
  store.close();
});

test('one active ticket per user is enforced by SQLite; closed tickets allow a new ticket', t => {
  const { store } = fixture(t);
  const row = ticket(store);
  assert.throws(() => ticket(store), /UNIQUE/);
  store.updateTicket(row.id, { state: 'closed' });
  const next = store.reserveTicket('owner', 'A different issue needs help', store.settings().tickets);
  assert.ok(next.id > row.id);
});

test('rapid duplicate actions are rejected and locks release after a failure', async () => {
  const locks = new Locks();
  let release;
  const pending = locks.run('same', () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(locks.run('same', async () => {}), /already being processed/);
  release();
  await pending;
  await assert.rejects(locks.run('same', async () => { throw new Error('failure'); }), /failure/);
  assert.equal(await locks.run('same', async () => 42), 42);
});

test('ticket permissions explicitly deny public visibility and grant only opener, staff, and bot access', () => {
  const overwrites = ticketOverwrites({ id: GUILD_ID }, 'bot', 'owner', 'support');
  assert.deepEqual(overwrites.map(o => o.id), [GUILD_ID, 'bot', 'owner', 'support']);
  assert.ok(overwrites[0].deny.includes(P.ViewChannel));
  assert.ok(overwrites[0].deny.includes(P.CreatePrivateThreads));
  assert.ok(overwrites[2].allow.includes(P.ViewChannel));
  assert.ok(!overwrites[2].allow.includes(P.ManageChannels));
});

test('outsiders cannot close a ticket; opener, support, and managers can', () => {
  const row = { owner_id: 'owner', support_role_id: 'support' };
  assert.throws(() => requireTicketAccess(member('outsider'), row), /Only the ticket opener/);
  assert.doesNotThrow(() => requireTicketAccess(member('owner'), row));
  assert.doesNotThrow(() => requireTicketAccess(member('staff', true), row));
  assert.doesNotThrow(() => requireTicketAccess(member('manager', false, true), row));
});

test('transcripts cannot be configured for a publicly readable channel', () => {
  const logs = channel('logs');
  assert.throws(() => validatePrivateLogs(logs, { roles: { everyone: {} } }, {}), /private staff transcript channel/);
});

test('unauthorized setup and session changes cannot mutate state or announce', async t => {
  const { bot, store } = fixture(t);
  bot.member = async () => member('outsider');
  const i = { options: { getSubcommand: () => 'start' } };
  await assert.rejects(bot.configure(i), /Manage Server/);
  await assert.rejects(bot.session(i), /Only the session staff/);
  assert.equal(store.session(), null);
});

test('claim does not let another staff member take or unclaim an existing claim', async t => {
  const { store, bot } = fixture(t);
  const row = ticket(store);
  store.updateTicket(row.id, { claimed_by: 'staff-a' });
  bot.member = async () => member('staff-b', true);
  const i = { channelId: 'ticket-channel', channel: {}, editReply: async () => {} };
  await assert.rejects(bot.claim(i, 'claim'), /already claimed/);
  await assert.rejects(bot.claim(i, 'toggle'), /assigned staff member/);
  assert.equal(store.ticket(row.id).claimed_by, 'staff-a');
});

test('claim database change rolls back when the control panel cannot be updated', async t => {
  const { store, bot } = fixture(t);
  const row = ticket(store);
  bot.member = async () => member('staff', true);
  bot.updatePanel = async () => { throw new Error('No permissions'); };
  await assert.rejects(bot.claim({ channelId: 'ticket-channel', channel: {} }, 'claim'), /No permissions/);
  assert.equal(store.ticket(row.id).claimed_by, null);
});

test('opener cannot claim their own ticket even if they are staff', async t => {
  const { store, bot } = fixture(t);
  ticket(store);
  bot.member = async () => member('owner', true);
  await assert.rejects(bot.claim({ channelId: 'ticket-channel' }, 'claim'), /own support ticket/);
});

test('claim and unclaim persist correctly and update the visible panel', async t => {
  const { store, bot } = fixture(t);
  const row = ticket(store);
  bot.member = async () => member('staff', true);
  const panels = [];
  bot.updatePanel = async (_, data) => panels.push(data.claimed_by);
  const i = { channelId: 'ticket-channel', channel: {}, editReply: async () => {} };
  await bot.claim(i, 'claim');
  assert.equal(store.ticket(row.id).claimed_by, 'staff');
  await bot.claim(i, 'unclaim');
  assert.equal(store.ticket(row.id).claimed_by, null);
  assert.deepEqual(panels, ['staff', null]);
});

test('welcome variables render and only the joining member can be pinged', () => {
  const payload = welcomePayload({ id: '123', user: { username: 'User', displayAvatarURL: () => 'https://example.com/avatar.png' },
    guild: { memberCount: 45 } }, { message: '{user} | {username} | {server} | {memberCount} @everyone' });
  assert.match(payload.embeds[0].data.description, /<@123> \| User \| Alaska State Roleplay \| 45/);
  assert.deepEqual(payload.allowedMentions, { parse: [], users: ['123'], roles: [] });
});

test('session transitions prevent duplicate starts and boost/full/end before startup', () => {
  for (const action of ['boost', 'full', 'end']) assert.throws(() => assertSessionTransition(null, action), /Start a session first/);
  assert.doesNotThrow(() => assertSessionTransition(null, 'start'));
  assert.throws(() => assertSessionTransition({ status: 'start' }, 'start'), /already active/);
  for (const action of ['boost', 'full', 'end']) assert.doesNotThrow(() => assertSessionTransition({ status: 'start' }, action));
  assert.doesNotThrow(() => assertSessionTransition({ status: 'end' }, 'start'));
});

test('session announcements use the configured code and allow only the configured role ping', () => {
  const payload = sessionPayload('start', { code: 'AlaskaRP', pingRoleId: 'ping' }, 'host', '@everyone');
  assert.ok(flatten(payload.components).some(c => c.url === 'https://erlc.gg/join/AlaskaRP'));
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [], roles: ['ping'] });
});

test('successful session announcement preserves its host and keeps earlier announcement history', async t => {
  const { store, bot } = fixture(t);
  store.configure('sessions', { channelId: 'sessions', code: 'AlaskaRP' });
  store.saveSession({ status: 'start', hostId: 'original-host', startedAt: 'yesterday', messageId: 'old', channelId: 'sessions' });
  bot.member = async () => member('manager', false, true);
  bot.botMember = async () => ({});
  const edited = [];
  bot.channel = async () => ({ ...channel('sessions'), send: async () => ({ id: 'new' }), messages: { edit: async (...args) => edited.push(args) } });
  await bot.session({ guild: {}, user: { id: 'manager' }, options: { getSubcommand: () => 'boost', getString: () => null }, editReply: async () => {} });
  assert.equal(store.session().messageId, 'new');
  assert.equal(store.session().hostId, 'original-host');
  assert.deepEqual(edited, []);
});

test('HTML transcripts escape scripts, markup, and untrusted attachment filenames', () => {
  const html = renderTranscript({ id: 1, owner_id: 'owner', subject: '<script>bad()</script>' },
    [{ author: { tag: '<b>Name</b>', id: '123' }, content: '<script>alert(1)</script>', createdTimestamp: 1,
      attachments: new Collection([['a', { name: '<img onerror=bad>', url: 'https://example.com/file' }]]), embeds: [] }], 'staff', '<bad>');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img onerror'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes("default-src 'none'"));
});

test('transcript pagination exports every page in chronological order', async () => {
  const make = n => ({ id: String(n), author: { tag: `user-${n}`, id: 'user' }, content: `message-${n}`,
    createdTimestamp: n, attachments: new Collection(), embeds: [] });
  let calls = 0;
  const ch = { guild: {}, messages: { fetch: async options => {
    calls++;
    if (calls === 1) return new Collection(Array.from({ length: 100 }, (_, n) => { const m = make(101 - n); return [m.id, m]; }));
    assert.equal(options.before, '2');
    return new Collection([['1', make(1)]]);
  } } };
  const file = await collectTranscript(ch, { id: 1, owner_id: 'owner', subject: 'subject' }, 'staff', 'resolved');
  const html = file.attachment.toString();
  assert.equal(calls, 2);
  assert.ok(html.indexOf('message-1</pre>') < html.indexOf('message-101</pre>'));
  assert.equal((html.match(/<article>/g) || []).length, 101);
});

function closeFixture(t, failAt) {
  const { store, bot } = fixture(t);
  const row = ticket(store);
  const events = [];
  const guild = { maximumFileSize: 8_000_000, roles: { everyone: { id: 'everyone' } } };
  const logs = { ...channel('logs'), permissionsFor: who => who.id === 'everyone' ? new PermissionsBitField() : allPermissions,
    send: async () => { events.push('upload'); if (failAt === 'upload') throw new Error('upload failed'); return { id: 'archive' }; } };
  const ch = { ...channel('ticket-channel'), guild,
    permissionOverwrites: { edit: async (id, patch) => events.push(`${id}:${patch.SendMessages}`) },
    send: async () => {}, messages: { fetch: async () => { if (failAt === 'fetch') throw new Error('fetch failed'); return new Collection(); } },
    delete: async () => { events.push('delete'); if (failAt === 'delete') throw new Error('delete failed'); } };
  bot.botMember = async () => ({ id: 'bot' });
  bot.member = async () => member('owner');
  bot.channel = async () => logs;
  return { store, bot, row, events, i: { guild, channelId: ch.id, channel: ch, user: { id: 'owner' }, editReply: async () => {} } };
}

test('closing uploads the transcript before deleting the ticket and records durable closure', async t => {
  const { store, bot, row, events, i } = closeFixture(t);
  await bot.closeTicket(i, 'Issue resolved');
  assert.ok(events.indexOf('upload') < events.indexOf('delete'));
  assert.equal(store.ticket(row.id).state, 'closed');
  assert.equal(store.ticket(row.id).transcript_id, 'archive');
  assert.equal(store.activeForOwner('owner'), undefined);
});
for (const failure of ['fetch', 'upload']) test(`a ${failure} failure preserves the ticket and restores sending permissions`, async t => {
  const { store, bot, row, events, i } = closeFixture(t, failure);
  await assert.rejects(bot.closeTicket(i, 'Issue resolved'), /kept open/);
  assert.ok(!events.includes('delete'));
  assert.equal(store.ticket(row.id).state, 'open');
  assert.ok(events.includes('owner:true'));
  assert.ok(events.includes('support:true'));
});

test('failed channel deletion reopens the ticket rather than leaving it stuck as closing', async t => {
  const { store, bot, row, events, i } = closeFixture(t, 'delete');
  await assert.rejects(bot.closeTicket(i, 'Issue resolved'), /could not be deleted/);
  assert.equal(store.ticket(row.id).state, 'open');
  assert.ok(events.includes('owner:true'));
});

test('startup reconciles a channel created before a crash and unlocks interrupted closures', async t => {
  const { store, bot } = fixture(t);
  const pending = store.reserveTicket('pending-user', 'Please help me', store.settings().tickets);
  const closing = ticket(store);
  store.updateTicket(closing.id, { state: 'closing' });
  const channels = new Collection([
    ['orphan', { id: 'orphan', topic: `asrp-ticket:${pending.id}:owner:pending-user` }],
    ['ticket-channel', { id: 'ticket-channel' }],
  ]);
  const restored = [];
  bot.restoreSending = async (_, row) => restored.push(row.id);
  await bot.recover({ channels: { fetch: async () => channels } });
  assert.equal(store.ticket(pending.id).channel_id, 'orphan');
  assert.equal(store.ticket(pending.id).state, 'open');
  assert.equal(store.ticket(closing.id).state, 'open');
  assert.deepEqual(restored, [closing.id]);
});

test('restart releases the ticket slot for a channel that was manually deleted offline', async t => {
  const { store, bot } = fixture(t);
  const row = ticket(store);
  await bot.recover({ channels: { fetch: async () => new Collection() } });
  assert.equal(store.ticket(row.id).state, 'closed');
  assert.equal(store.activeForOwner('owner'), undefined);
});

test('server restriction rejects interactions before any configuration or ticket lookup', async t => {
  const { bot } = fixture(t);
  let reply;
  await bot.handle({ isChatInputCommand: () => true, inGuild: () => true, guildId: 'other-server',
    reply: async payload => { reply = payload; } });
  assert.match(reply.content, /reserved for Alaska/);
});

test('ticket creation uses private overwrites, persists its panel, and rejects duplicate opens', async t => {
  const { store, bot } = fixture(t);
  let created;
  let creations = 0;
  const guild = { id: GUILD_ID, roles: { everyone: { id: 'everyone' }, fetch: async () => ({ id: 'support', managed: false }) },
    channels: { create: async data => {
      creations++;
      created = data;
      return { id: 'created-ticket', send: async () => ({ id: 'created-panel' }) };
    } } };
  bot.botMember = async () => ({ id: 'bot' });
  bot.channel = async (_, id) => id === 'category' ? channel('category') : ({ ...channel('logs'),
    permissionsFor: who => who.id === 'everyone' ? new PermissionsBitField() : allPermissions });
  const i = { guild, user: { id: 'opener', username: 'Cool_User' },
    fields: { getTextInputValue: () => 'Help with my roleplay character' }, editReply: async () => {} };
  await bot.createTicket(i);
  assert.equal(creations, 1);
  assert.equal(created.parent, 'category');
  assert.ok(created.permissionOverwrites[0].deny.includes(P.ViewChannel));
  assert.equal(store.activeForOwner('opener').panel_id, 'created-panel');
  await assert.rejects(bot.createTicket(i), /already have a ticket/);
  assert.equal(creations, 1);
});

test('a timed-out create reconciles the server channel instead of creating a duplicate', async t => {
  const { store, bot } = fixture(t);
  const existing = { id: 'already-created', topic: 'asrp-ticket:1:owner:opener', send: async () => ({ id: 'panel' }) };
  const guild = { id: GUILD_ID, roles: { everyone: { id: 'everyone' }, fetch: async () => ({ id: 'support', managed: false }) },
    channels: { create: async () => { throw new Error('Timeout after creation'); },
      fetch: async () => new Collection([[existing.id, existing]]) } };
  bot.botMember = async () => ({ id: 'bot' });
  bot.channel = async (_, id) => id === 'category' ? channel('category') : ({ ...channel('logs'),
    permissionsFor: who => who.id === 'everyone' ? new PermissionsBitField() : allPermissions });
  await bot.createTicket({ guild, user: { id: 'opener', username: 'User' },
    fields: { getTextInputValue: () => 'A valid help request' }, editReply: async () => {} });
  assert.equal(store.activeForOwner('opener').channel_id, existing.id);
  assert.equal(store.activeForOwner('opener').state, 'open');
});

test('missing former members or roles do not block restoration for remaining ticket participants', async t => {
  const { bot } = fixture(t);
  const edits = [];
  await bot.restoreSending({ permissionOverwrites: { edit: async id => {
    edits.push(id);
    if (id === 'former-role') throw Object.assign(new Error('Unknown Role'), { code: 10011 });
  } } }, { owner_id: 'owner', support_role_id: 'former-role' });
  assert.deepEqual(edits, ['owner', 'former-role']);
});
