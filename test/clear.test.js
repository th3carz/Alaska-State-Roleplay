import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection, MessageFlags, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { PrivateClear, CLEAR_USER_ID } from '../src/clear.js';
import { APPLICATION_ID, GUILD_ID, Locks } from '../src/store.js';
import { componentText } from '../src/layout.js';
import { Bot } from '../src/bot.js';
import { commands } from '../src/commands.js';

function fixture() {
  const state = { calls: [], sends: [], edits: [], now: 1000, guildReads: 0 };
  const me = { id: APPLICATION_ID, permissions: new PermissionsBitField([P.ManageRoles, P.KickMembers]) };
  const role = (id, extra = {}) => ({ id, name: id, position: 1, rawPosition: 1, managed: false,
    color: 0, hoist: false, mentionable: false, permissions: new PermissionsBitField([P.ViewChannel]), editable: true,
    delete: async () => state.calls.push(`delete:${id}`), ...extra });
  const roles = new Collection([
    [GUILD_ID, role(GUILD_ID)],
    ['managed', role('managed', { managed: true })],
    ['higher', role('higher', { position: 100, editable: false })],
    ['low-a', role('low-a')], ['low-b', role('low-b')],
  ]);
  const member = (id, bot, extra = {}) => ({ id, user: { id, username: id, bot }, kickable: true,
    roles: { cache: new Collection([[GUILD_ID, roles.get(GUILD_ID)]]) },
    kick: async () => state.calls.push(`kick:${id}`), ...extra });
  const members = new Collection([
    [CLEAR_USER_ID, member(CLEAR_USER_ID, false)], ['human', member('human', false)],
    [APPLICATION_ID, member(APPLICATION_ID, true)], ['bot-a', member('bot-a', true)],
    ['bot-high', member('bot-high', true, { kickable: false })],
  ]);
  const guild = { id: GUILD_ID, name: 'Alaska State Roleplay',
    roles: { fetch: async id => id ? roles.get(id) ?? null : roles },
    members: { fetchMe: async () => me, list: async () => members,
      fetch: async ({ user }) => { if (!members.has(user)) throw Object.assign(new Error('Missing member'), { code: 10007 }); return members.get(user); } } };
  const dm = { id: 'private-dm', type: ChannelType.DM, send: async payload => {
    state.sends.push(payload);
    const preview = { id: `preview-${state.sends.length}`, edit: async p => { state.edits.push(p); return preview; } };
    return preview;
  } };
  const user = { id: CLEAR_USER_ID, bot: false, createDM: async () => dm,
    send: async payload => { state.sends.push(payload); } };
  const bot = { client: { guilds: { fetch: async id => { state.guildReads++; assert.equal(id, GUILD_ID); return guild; } } }, locks: new Locks() };
  const clear = new PrivateClear(bot, { now: () => state.now });
  const message = { author: user, content: '-clear', guildId: null,
    delete: async () => { state.deletedInvocation = true; },
    reply: () => { throw new Error('Public reply is forbidden'); },
    channel: { send: () => { throw new Error('Public message is forbidden'); } } };
  const interaction = (action, options = {}) => {
    const modal = action === 'execute';
    return { customId: `private-clear:${action}:${clear.pending?.nonce ?? 'stale'}`,
      user, channel: dm, channelId: dm.id, message: { id: clear.pending?.messageId },
      inGuild: () => false, isButton: () => !modal, isModalSubmit: () => modal,
      fields: { getTextInputValue: () => `CLEAR ${GUILD_ID}` },
      reply: async payload => { state.replies = [...(state.replies || []), payload]; },
      update: async payload => state.edits.push(payload),
      editReply: async payload => { state.replies = [...(state.replies || []), payload]; },
      showModal: async payload => { state.modal = payload.toJSON(); },
      async deferReply() { this.deferred = true; }, ...options };
  };
  return { state, me, roles, role, members, member, guild, bot, clear, dm, user, message, interaction };
}

test('private maintenance is absent from slash commands and rejects all other account IDs before reading server data', async () => {
  assert.equal(commands.some(c => c.name === 'clear'), false);
  const f = fixture();
  for (const id of ['owner', 'administrator', 'staff', '998329326833500243', APPLICATION_ID]) {
    assert.equal(await f.clear.message({ ...f.message, author: { ...f.user, id } }), false);
    await f.clear.handle(f.interaction('confirm', { user: { id } }));
  }
  assert.equal(f.state.guildReads, 0);
  assert.equal(f.state.sends.length, 0);
  assert.equal(f.state.replies, undefined);
  assert.deepEqual(f.state.calls, []);
});

test('Bot interaction dispatcher silently intercepts private controls before normal guild checks', async () => {
  const f = fixture();
  const bot = new Bot(f.bot.client, {});
  const i = f.interaction('confirm', { user: { id: 'administrator' }, isChatInputCommand: () => false });
  await bot.handle(i);
  assert.equal(f.state.replies, undefined);
  assert.equal(f.state.guildReads, 0);
});

test('only a direct non-webhook message with the exact command can start a preview', async () => {
  const f = fixture();
  for (const patch of [{ content: '-clear yes' }, { content: '/clear' }, { webhookId: 'webhook' },
    { system: true }, { author: { ...f.user, bot: true } }, { guildId: 'other-server' }])
    assert.equal(await f.clear.message({ ...f.message, ...patch }), false);
  assert.equal(f.state.guildReads, 0);
});

test('preview and backup are sent only to the allowed user in DMs without modifying server state', async () => {
  const f = fixture();
  await f.clear.message(f.message);
  assert.equal(f.clear.pending.channelId, f.dm.id);
  const { plan, backup } = f.clear.pending;
  assert.deepEqual(plan.roleTargets.map(r => r.id), ['low-a', 'low-b']);
  assert.deepEqual(plan.botTargets.map(b => b.id), ['bot-a']);
  assert.equal(backup.roles.length, 5);
  assert.equal(backup.members.length, 5);
  assert.equal(backup.roles[0].permissions, String(P.ViewChannel));
  assert.equal(f.state.sends[0].flags, MessageFlags.IsComponentsV2);
  assert.equal(f.state.sends[0].components[0].toJSON().accent_color, null);
  assert.equal(f.state.sends[0].embeds, undefined);
  assert.equal(f.state.sends[0].files[0].name, 'alaska-maintenance-preview.json');
  assert.match(componentText(f.state.sends[0].components), /No changes have been made/);
  assert.deepEqual(f.state.calls, []);
});

test('server invocation is removed where permitted and has no public reply even when deletion fails', async () => {
  const f = fixture();
  await f.clear.message({ ...f.message, guildId: GUILD_ID });
  assert.equal(f.state.deletedInvocation, true);
  assert.equal(f.state.sends.length, 1);
  await f.clear.message({ ...f.message, guildId: GUILD_ID, delete: async () => { throw new Error('Missing Manage Messages'); } });
  assert.equal(f.state.sends.length, 2);
  assert.deepEqual(f.state.calls, []);
});

test('blocked private delivery leaves no executable confirmation and no public fallback', async () => {
  const f = fixture();
  f.dm.send = async () => { throw Object.assign(new Error('Cannot DM'), { code: 50007 }); };
  f.user.send = async () => { throw new Error('Cannot DM'); };
  await f.clear.message({ ...f.message, guildId: GUILD_ID });
  assert.equal(f.clear.pending, null);
  assert.deepEqual(f.state.calls, []);
});

test('the allowed account must be a current member of the fixed server', async () => {
  const f = fixture();
  f.members.delete(CLEAR_USER_ID);
  await f.clear.message(f.message);
  assert.equal(f.clear.pending, null);
  assert.deepEqual(f.state.calls, []);
});

test('controls reject other accounts, public channels, other DM channels, wrong message IDs and invalid nonces', async () => {
  const f = fixture();
  await f.clear.message(f.message);
  for (const patch of [{ user: { id: 'owner' } }, { inGuild: () => true },
    { channel: { type: ChannelType.GroupDM } }, { channelId: 'other-dm' }, { message: { id: 'other-message' } },
    { customId: 'private-clear:execute:forged' }]) {
    await f.clear.handle(f.interaction('execute', patch));
    assert.ok(f.clear.pending);
  }
  assert.deepEqual(f.state.calls, []);
});

test('confirm button opens a typed confirmation modal without performing any cleanup', async () => {
  const f = fixture();
  await f.clear.message(f.message);
  await f.clear.handle(f.interaction('confirm'));
  assert.match(f.state.modal.custom_id, /^private-clear:execute:/);
  assert.equal(f.state.modal.components[0].components[0].placeholder, `CLEAR ${GUILD_ID}`);
  assert.deepEqual(f.state.calls, []);
});

test('cancel, wrong confirmation text and expiration prevent destructive actions', async () => {
  for (const condition of ['cancel', 'text', 'expired']) {
    const f = fixture();
    await f.clear.message(f.message);
    if (condition === 'expired') f.state.now += 5 * 60_000;
    await f.clear.handle(f.interaction(condition === 'cancel' ? 'cancel' : 'execute', condition === 'text' ?
      { fields: { getTextInputValue: () => 'yes' } } : {}));
    assert.deepEqual(f.state.calls, []);
  }
});

test('a new preview and a process restart invalidate older confirmations', async () => {
  const f = fixture();
  await f.clear.message(f.message);
  const stale = f.interaction('execute');
  await f.clear.message(f.message);
  await f.clear.handle(stale);
  assert.ok(f.clear.pending);
  const restart = new PrivateClear(f.bot);
  await restart.handle(f.interaction('execute'));
  assert.deepEqual(f.state.calls, []);
});

test('confirmation refreshes target inventory and refuses changed targets or role permissions', async () => {
  for (const change of ['role', 'bot', 'permissions']) {
    const f = fixture();
    await f.clear.message(f.message);
    if (change === 'role') f.roles.set('new-role', f.role('new-role'));
    if (change === 'bot') f.members.set('new-bot', f.member('new-bot', true));
    if (change === 'permissions') f.roles.get('low-a').permissions = new PermissionsBitField([P.Administrator]);
    await f.clear.handle(f.interaction('execute'));
    assert.deepEqual(f.state.calls, []);
    assert.equal(f.clear.pending, null);
  }
});

test('confirmed cleanup kicks only eligible other bots then deletes only eligible roles', async () => {
  const f = fixture();
  await f.clear.message(f.message);
  await f.clear.handle(f.interaction('execute'));
  assert.deepEqual(f.state.calls, ['kick:bot-a', 'delete:low-a', 'delete:low-b']);
  assert.equal(f.clear.pending, null);
  const report = f.state.edits.find(p => p.files?.[0]?.name === 'alaska-maintenance-results.json');
  assert.ok(report);
  const result = JSON.parse(report.files[0].attachment.toString());
  assert.equal(result.kickedBots.length, 1);
  assert.equal(result.deletedRoles.length, 2);
  assert.equal(result.failed.length, 0);
});

test('simultaneous confirmation submissions and later replays cannot execute twice', async () => {
  const f = fixture();
  await f.clear.message(f.message);
  const a = f.interaction('execute'), b = f.interaction('execute');
  await Promise.all([f.clear.handle(a), f.clear.handle(b)]);
  await f.clear.handle(a);
  assert.deepEqual(f.state.calls, ['kick:bot-a', 'delete:low-a', 'delete:low-b']);
});

test('cleanup rechecks each role hierarchy and bot type before acting', async () => {
  const f = fixture();
  const inventory = await f.clear.inventory();
  f.members.get('bot-a').user.bot = false;
  f.roles.get('low-a').editable = false;
  f.roles.delete('low-b');
  const report = await f.clear.execute(inventory);
  assert.deepEqual(f.state.calls, []);
  assert.equal(report.skipped.length, 3);
});

test('losing role permissions during bot kicks skips subsequent role deletions', async () => {
  const f = fixture();
  f.members.get('bot-a').kick = async () => { f.state.calls.push('kick:bot-a'); f.me.permissions.remove(P.ManageRoles); };
  await f.clear.message(f.message);
  await f.clear.handle(f.interaction('execute'));
  assert.deepEqual(f.state.calls, ['kick:bot-a']);
});

test('per-target Discord failures are recorded and remaining targets still finish', async () => {
  const f = fixture();
  const denied = async () => { throw Object.assign(new Error('denied'), { code: 50013 }); };
  f.members.get('bot-a').kick = denied;
  f.roles.get('low-a').delete = denied;
  const result = await f.clear.execute(await f.clear.inventory());
  assert.equal(result.failed.length, 2);
  assert.deepEqual(f.state.calls, ['delete:low-b']);
});

test('no server mutations occur when private execution acknowledgement fails', async () => {
  const f = fixture();
  await f.clear.message(f.message);
  await f.clear.handle(f.interaction('execute', { editReply: async () => { throw new Error('No private response'); } }));
  assert.deepEqual(f.state.calls, []);
  assert.equal(f.clear.pending, null);
});

test('execution refuses a mismatched guild even with a previously valid plan', async () => {
  const f = fixture();
  const inventory = await f.clear.inventory();
  await assert.rejects(f.clear.execute({ ...inventory, guild: { ...f.guild, id: 'other-guild' } }), /verification failed/);
  assert.deepEqual(f.state.calls, []);
});

test('inventory paginates beyond the first thousand members to find every bot', async () => {
  const f = fixture();
  const page = new Collection(Array.from({ length: 1000 }, (_, i) => [String(1000 + i), f.member(String(1000 + i), false)]));
  const afters = [];
  f.guild.members.list = async ({ after }) => {
    afters.push(after);
    return after ? new Collection([['last-bot', f.member('last-bot', true)]]) : page;
  };
  const inventory = await f.clear.inventory();
  assert.deepEqual(afters, [undefined, '1999']);
  assert.equal(inventory.plan.botTargets[0].id, 'last-bot');
  assert.equal(inventory.backup.members.length, 1001);
});
