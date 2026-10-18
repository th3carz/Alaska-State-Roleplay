import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection, PermissionsBitField, PermissionFlagsBits as P, MessageFlags } from 'discord.js';
import { Store, GUILD_ID, APPLICATION_ID } from '../src/store.js';
import { Bot, ticketOverwrites, isSupport } from '../src/bot.js';
import { SERVER_SETTINGS, SERVER_SEED_KEY, REFERENCE_SETTINGS, REFERENCE_SEED_KEY,
  COMPACT_WELCOME_SETTINGS, COMPACT_WELCOME_SEED_KEY } from '../src/server-config.js';
import { Erlc } from '../src/erlc.js';
import { componentText, editPayload } from '../src/layout.js';
import { openPanel, ticketPanel, ticketModal, closeModal, votePanel, sessionStatusPanel, homePanel, affiliationsPanel,
  welcomePayload, sessionPayload, ticketNotice } from '../src/ui.js';
import { ticketDetails, ticketName, typeConfiguration } from '../src/ticket-types.js';
import { renderTranscript } from '../src/transcript.js';

const all = new PermissionsBitField(Object.values(P));
const actor = (id, roles = [], manager = false) => ({ id, user: { bot: false },
  permissions: new PermissionsBitField(manager ? [P.ManageGuild] : []), roles: { cache: new Collection(roles.map(id => [id, {}])) } });
const flat = components => components.flatMap(c => {
  const x = c.toJSON ? c.toJSON() : c;
  return [x, ...flat(x.components || []), ...(x.accessory ? [x.accessory] : [])];
});
function fixture(t) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.seedSettings(SERVER_SETTINGS, SERVER_SEED_KEY);
  store.seedSettings(REFERENCE_SETTINGS, REFERENCE_SEED_KEY);
  const bot = new Bot({}, store);
  bot.panels.sync = async () => [];
  bot.member = async i => actor(i.user.id, [], i.user.id === 'staff');
  bot.botMember = async () => ({ id: APPLICATION_ID, permissions: all, roles: { highest: { comparePositionTo: () => 1 } } });
  const edits = [], sent = [];
  const channel = { id: store.settings().sessions.channelId, name: 'sessions', permissionsFor: () => all,
    send: async data => { sent.push(data); return { id: String(9000 + sent.length) }; },
    messages: { edit: async (id, data) => { edits.push({ id, data }); return { id }; } } };
  bot.channel = async () => channel;
  return { store, bot, edits, sent, channel, guild: { id: GUILD_ID } };
}
function click(guild, vote, userId, kind = 'vote') {
  const i = { guild, user: { id: userId, bot: false }, channelId: vote.channel_id,
    message: { id: vote.message_id }, customId: `session:${kind}:${vote.id}`, isButton: () => true,
    deferReply: async () => {}, editReply: async data => { i.reply = data; } };
  return i;
}

test('reference cards serialize valid banner-first V2 layouts without legacy message fields', t => {
  const { store } = fixture(t), s = store.settings();
  const ticket = store.reserveTicket('123', 'Please help me with a role.', s.tickets, { type: 'general' });
  const vote = store.newVote(5, 'staff', s.sessions.channelId);
  const payloads = [homePanel(s,GUILD_ID), openPanel(s.tickets), ticketPanel(ticket),
    sessionStatusPanel(s.sessions,null), affiliationsPanel(s,GUILD_ID), votePanel({ ...vote, state: 'open' },[],s.sessions)];
  for (const payload of payloads) {
    assert.equal(payload.flags, MessageFlags.IsComponentsV2);
    assert.equal(payload.content, undefined);
    assert.equal(payload.embeds, undefined);
    const json = payload.components.map(c => c.toJSON());
    assert.equal(json[0].type, 17);
    assert.equal(json[0].components[0].type, 12);
    assert.ok(flat(json).length <= 40);
    const ids = flat(json).map(c => c.custom_id).filter(Boolean);
    assert.equal(ids.length, new Set(ids).size);
    assert.equal(payload.files.length, 1);
  }
  const edit = editPayload(payloads[0]);
  assert.deepEqual(edit.embeds, []);
  assert.equal(edit.content, null);
  assert.deepEqual(edit.attachments, []);
  assert.equal(ticketModal('internal').toJSON().components[0].component.type, 5);
  assert.equal(closeModal(1).toJSON().components[0].type, 18);
});

test('all rich message layouts use V2 with no custom emoji icons or colored accents', t => {
  const { store } = fixture(t), s = store.settings();
  const ticket = store.reserveTicket('123','Please help me.',s.tickets);
  const vote = store.newVote(2,'staff',s.sessions.channelId);
  const payloads = [homePanel(s,GUILD_ID),openPanel(s.tickets),ticketPanel(ticket),sessionStatusPanel(s.sessions,null),
    affiliationsPanel(s,GUILD_ID),votePanel({...vote,state:'open'},[],s.sessions),ticketNotice('Notice','Saved.'),
    ...['start','boost','full','end'].map(action=>sessionPayload(action,s.sessions,'staff')),
    welcomePayload({id:'123',user:{username:'Member'},guild:{id:GUILD_ID,memberCount:10}},s.welcome,s.panels.homeChannelId)];
  for (const payload of payloads) {
    assert.equal(payload.flags,MessageFlags.IsComponentsV2);
    assert.equal(payload.embeds,undefined);
    const json=payload.components.map(c=>c.toJSON());
    for (const c of flat(json)) {
      if(c.type===17) assert.equal(c.accent_color,null);
      assert.equal(c.emoji,undefined);
      for(const option of c.options||[]) assert.equal(option.emoji,undefined);
    }
    assert.doesNotMatch(JSON.stringify(json),/<a?:\w+:\d+>/);
  }
});

test('compact welcome has quoted text, member count and Dashboard without a header, avatar, banner or footer', t => {
  const { store } = fixture(t);
  const member={id:'123',user:{username:'Member'},guild:{id:GUILD_ID,memberCount:45}};
  const payload=welcomePayload(member,store.settings().welcome,store.settings().panels.homeChannelId);
  const box=payload.components[0].toJSON();
  assert.equal(box.components.length,2);
  assert.equal(box.components[0].type,10);
  assert.match(box.components[0].content,/^> Welcome to \*\*Alaska State Roleplay\*\*, <@123>/);
  const [count,dashboard]=box.components[1].components;
  assert.equal(count.label,'45'); assert.equal(count.disabled,true);
  assert.equal(dashboard.label,'Dashboard');
  assert.equal(dashboard.url,`https://discord.com/channels/${GUILD_ID}/1560914196898643969`);
  assert.deepEqual(payload.allowedMentions,{parse:[],users:['123'],roles:[]});
});

test('the welcome migration replaces the old destination once and preserves later configuration', t => {
  const { store } = fixture(t);
  store.configure('welcome',{channelId:'old',message:'Old message',banner:'https://example.com/banner.png',enabled:false});
  store.seedSettings(COMPACT_WELCOME_SETTINGS,COMPACT_WELCOME_SEED_KEY,{overwrite:true});
  assert.equal(store.settings().welcome.channelId,'1560914979354583191');
  assert.equal(store.settings().welcome.banner,null);
  assert.equal(store.settings().welcome.enabled,false);
  store.configure('welcome',{channelId:'new-choice',message:'New message'});
  store.seedSettings(COMPACT_WELCOME_SETTINGS,COMPACT_WELCOME_SEED_KEY,{overwrite:true});
  assert.equal(store.settings().welcome.channelId,'new-choice');
  assert.equal(store.settings().welcome.message,'New message');
});

test('member joins send the compact welcome to general and skip bots and other guilds', async t => {
  const { store,bot,sent }=fixture(t);
  store.seedSettings(COMPACT_WELCOME_SETTINGS,COMPACT_WELCOME_SEED_KEY,{overwrite:true});
  let destination;
  const originalChannel=bot.channel;
  bot.channel=async (guild,id)=>{destination=id;return originalChannel(guild,id);};
  const member={id:'123',user:{username:'Member',bot:false},guild:{id:GUILD_ID,memberCount:45}};
  await bot.welcome(member);
  assert.equal(destination,'1560914979354583191');
  assert.equal(sent.length,1);
  assert.equal(sent[0].flags,MessageFlags.IsComponentsV2);
  await bot.welcome({...member,user:{...member.user,bot:true}});
  await bot.welcome({...member,guild:{id:'another-guild'}});
  assert.equal(sent.length,1);
});

test('configuration view is a Components V2 card', async t => {
  const {bot,guild}=fixture(t);
  let reply;
  await bot.configure({guild,user:{id:'staff'},options:{getSubcommand:()=> 'view'},editReply:async payload=>{reply=payload;}});
  assert.equal(reply.flags,MessageFlags.IsComponentsV2);
  assert.equal(reply.embeds,undefined);
  assert.match(componentText(reply.components),/Bot Configuration/);
});

test('live counts use the official combined endpoint, count staff in-game, and cache requests', async () => {
  let calls = 0, now = 100_000;
  const api = new Erlc({ key: 'private-test-key', now: () => now, fetcher: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.erlc.gg/v2/server?Players=true&Queue=true');
    assert.equal(options.headers['server-key'], 'private-test-key');
    return { status: 200, ok: true, json: async () => ({ CurrentPlayers: 4, MaxPlayers: 40, Name: 'Alaska', JoinKey: 'ASRP',
      Queue: [1,2], Players: [{ Permission: 'Normal' },{ Permission: 'Server Moderator' },{ Permission: 'Server Owner' },{ Permission: 'Server Administrator' }] }) };
  } });
  const a = await api.snapshot();
  await api.snapshot();
  assert.deepEqual([a.players,a.maxPlayers,a.queue,a.staff], [4,40,2,3]);
  assert.equal(calls, 1);
  now += 60_001; await api.snapshot(); assert.equal(calls, 2);
});

test('ER:LC 429 responses honor Retry-After and rejected credentials stop further requests', async () => {
  let calls = 0, now = 0;
  const api = new Erlc({ key: 'key', now: () => now, fetcher: async () => {
    calls++; return { status: 429, headers: { get: () => '120' }, json: async () => ({ retry_after: 90 }) };
  } });
  await api.snapshot(); now = 119_999; await api.snapshot(); assert.equal(calls,1);
  now = 120_001; await api.snapshot(); assert.equal(calls,2);
  let invalidCalls = 0;
  const invalid = new Erlc({ key: 'key', now: () => now, fetcher: async () => { invalidCalls++; return { status: 401 }; } });
  await invalid.snapshot(); now += 1_000_000; await invalid.snapshot(); assert.equal(invalidCalls,1);
});

test('missing or malformed live data never becomes a fabricated zero-player result', async () => {
  let calls = 0;
  const absent = new Erlc({ key: '', fetcher: async () => { calls++; } });
  assert.equal((await absent.snapshot()).connected, false); assert.equal(calls,0);
  const malformed = new Erlc({ key: 'key', fetcher: async () => ({ ok: true, status: 200, json: async () => ({ CurrentPlayers: 0 }) }) });
  const data = await malformed.snapshot();
  assert.equal(data.connected, false); assert.equal(data.players, undefined);
});

test('vote uniqueness, target completion, and the voter list agree', async t => {
  const { store, bot, guild } = fixture(t);
  await bot.sessions.command({ guild, user: { id: 'staff' }, options: { getSubcommand: () => 'vote', getInteger: () => 2 }, editReply: async () => {} });
  const vote = store.openVote();
  await bot.sessions.handle(click(guild,vote,'alice'));
  await bot.sessions.handle(click(guild,vote,'alice'));
  assert.deepEqual(store.voters(vote.id), ['alice']);
  await bot.sessions.handle(click(guild,vote,'bob'));
  assert.equal(store.vote(vote.id).state, 'passed');
  assert.deepEqual(store.voters(vote.id), ['alice','bob']);
  const voters = click(guild,vote,'alice','voters');
  await bot.sessions.handle(voters);
  assert.match(voters.reply.content, /<@alice>/); assert.match(voters.reply.content, /<@bob>/);
  await assert.rejects(bot.sessions.handle(click(guild,vote,'charlie')), /vote has ended/);
});

test('failed vote display updates are retried after the target has been reached', async t => {
  const { store, bot, guild, channel } = fixture(t);
  const vote = store.newVote(1,'staff',channel.id); store.updateVote(vote.id,'open','123');
  channel.messages.edit = async () => { throw new Error('temporary failure'); };
  await bot.sessions.handle(click(guild,store.vote(vote.id),'alice'));
  assert.equal(store.vote(vote.id).state,'passed');
  assert.equal(store.pendingVoteMessages().length,1);
  channel.messages.edit = async () => {};
  await bot.sessions.recover(guild);
  assert.equal(store.pendingVoteMessages().length,0);
});

test('old vote controls cannot affect a different message or channel', async t => {
  const { store, bot, guild } = fixture(t);
  const vote = store.newVote(2,'staff','channel'); store.updateVote(vote.id,'open','123');
  const i = click(guild,store.vote(vote.id),'user'); i.message.id = 'forged';
  await assert.rejects(bot.sessions.handle(i), /could not be found/);
  assert.deepEqual(store.voters(vote.id),[]);
});

test('notification control changes only the caller and refuses a role above the bot', async t => {
  const { bot, store } = fixture(t);
  const role = { id: store.settings().sessions.pingRoleId, managed: false };
  const guild = { id: GUILD_ID, roles: { fetch: async () => role } };
  const calls = [];
  bot.member = async () => ({ id: 'caller', roles: { cache: new Collection(), add: async r => calls.push(r.id) } });
  const i = { guild, user: { id: 'caller' }, isButton: () => true, customId: 'session:notifications', deferReply: async () => {}, editReply: async () => {} };
  await bot.sessions.handle(i); assert.deepEqual(calls,[role.id]);
  bot.botMember = async () => ({ permissions: all, roles: { highest: { comparePositionTo: () => -1 } } });
  await assert.rejects(bot.sessions.handle(i), /above the Sessions role/);
  assert.equal(calls.length,1);
});

test('Internal Affairs tickets exclude the general support role and explicitly hide the report from its subject', t => {
  const { store } = fixture(t);
  const settings = typeConfiguration(store.settings().tickets,'internal');
  const ticket = store.reserveTicket('opener','A private report about staff',settings,{type:'internal',accessRoleIds:settings.accessRoleIds});
  const acl = ticketOverwrites({id:GUILD_ID},APPLICATION_ID,'opener',settings.supportRoleId,settings.accessRoleIds,'reported');
  assert.ok(!acl.some(o => o.id === store.settings().tickets.supportRoleId));
  assert.deepEqual(acl.find(o => o.id === 'reported').deny,[P.ViewChannel]);
  assert.equal(isSupport(actor('moderator',[store.settings().tickets.supportRoleId]),ticket),false);
  assert.equal(isSupport(actor('reviewer',[settings.supportRoleId]),ticket),true);
});

test('ticket renaming keeps its claimed state and saves the customer name', async t => {
  const { store, bot } = fixture(t);
  const ticket = store.reserveTicket('opener','Need help',store.settings().tickets,{username:'member',type:'general'});
  store.updateTicket(ticket.id,{state:'open',channel_id:'ticket',claimed_by:'staff'});
  let name;
  const i = { channelId:'ticket',user:{id:'staff'},channel:{setName:async value => { name=value; }},editReply:async()=>{} };
  await bot.ticketExtras.rename(i,store.ticket(ticket.id),'Custom issue');
  assert.ok(name.startsWith('🟢・gen-custom-issue-'));
  assert.equal(ticketDetails(store.ticket(ticket.id)).customName,'Custom issue');
});

test('access controls protect the opener, bot, everyone, and required staff roles', async t => {
  const { store, bot } = fixture(t);
  const ticket = store.reserveTicket('opener','Need help',store.settings().tickets);
  store.updateTicket(ticket.id,{state:'open',channel_id:'ticket'});
  const i = { guild:{id:GUILD_ID},channelId:'ticket',user:{id:'staff'},editReply:async()=>{} };
  for (const id of ['opener',APPLICATION_ID,GUILD_ID,ticket.support_role_id])
    await assert.rejects(bot.ticketExtras.changeAccess(i,store.ticket(ticket.id),'remove',{id}),/cannot be added or removed/);
});

test('declined or superseded closure requests cannot be accepted through a stale modal', async t => {
  const { store, bot } = fixture(t);
  const ticket = store.reserveTicket('opener','Need help',store.settings().tickets);
  store.updateTicket(ticket.id,{state:'open',channel_id:'ticket',details:JSON.stringify({closeRequest:{nonce:'current'}})});
  await assert.rejects(bot.closeTicket({channelId:'ticket'},'Resolved',ticket.id,'old'),/already been handled/);
  assert.equal(store.ticket(ticket.id).state,'open');
});

test('Keep Open clears the closure request and rejects a later acceptance', async t => {
  const { store, bot } = fixture(t);
  const ticket = store.reserveTicket('opener','Need help',store.settings().tickets);
  store.updateTicket(ticket.id,{state:'open',channel_id:'ticket',details:JSON.stringify({closeRequest:{nonce:'current'}})});
  let edited;
  const i = {channelId:'ticket',user:{id:'staff'},message:{edit:async payload=>{edited=payload;}},editReply:async()=>{}};
  await bot.ticketExtras.keepOpen(i,store.ticket(ticket.id),'current');
  assert.equal(store.ticket(ticket.id).state,'open');
  assert.equal(ticketDetails(store.ticket(ticket.id)).closeRequest,undefined);
  assert.match(componentText(edited.components),/Request Denied/);
  await assert.rejects(bot.closeTicket(i,'Resolved',ticket.id,'current'),/already been handled/);
});

test('a repeated Claim click cannot release an existing claim even if the notice failed', async t => {
  const { store, bot } = fixture(t);
  const ticket = store.reserveTicket('opener','Need help',store.settings().tickets);
  store.updateTicket(ticket.id,{state:'open',channel_id:'ticket',panel_id:'panel'});
  const i = {channelId:'ticket',user:{id:'staff'},channel:{messages:{edit:async()=>{}},
    setName:async()=>{},send:async()=>{throw new Error('notice unavailable');}},editReply:async()=>{}};
  await bot.claim(i,'claim',ticket.id);
  assert.equal(store.ticket(ticket.id).claimed_by,'staff');
  await assert.rejects(bot.claim(i,'claim',ticket.id),/already claimed/);
  assert.equal(store.ticket(ticket.id).claimed_by,'staff');
  await bot.claim(i,'unclaim',ticket.id);
  assert.equal(store.ticket(ticket.id).claimed_by,null);
});

test('votes, duplicate-voter protection, pending refreshes, and ticket details survive a database restart', t => {
  const dir = mkdtempSync(join(tmpdir(),'alaska-votes-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path = join(dir,'state.sqlite');
  let store = new Store(path);
  const vote = store.newVote(2,'staff','channel');
  store.updateVote(vote.id,'open','message');
  store.addVoter(vote.id,'alice');
  const ticket = store.reserveTicket('owner','Need help',{supportRoleId:'support',logChannelId:'logs'},
    {type:'management',participantIds:['guest'],closeRequest:{nonce:'pending'}});
  store.close();
  store = new Store(path);
  t.after(()=>store.close());
  assert.equal(store.openVote().message_id,'message');
  assert.deepEqual(store.voters(vote.id),['alice']);
  assert.equal(store.addVoter(vote.id,'alice'),false);
  assert.equal(store.pendingVoteMessages().length,1);
  assert.equal(ticketDetails(store.ticket(ticket.id)).closeRequest.nonce,'pending');
  assert.deepEqual(ticketDetails(store.ticket(ticket.id)).participantIds,['guest']);
});

test('closure permission freezes include extra participants and leadership roles', async t => {
  const { bot } = fixture(t);
  const calls = [];
  const ticket = {owner_id:'owner',support_role_id:'support',details:JSON.stringify({accessRoleIds:['leader'],participantIds:['extra-user','extra-role']})};
  await bot.setSending({permissionOverwrites:{edit:async (id,value)=>calls.push([id,value.SendMessages])}},ticket,false);
  assert.deepEqual(calls,[['owner',false],['support',false],['leader',false],['extra-user',false],['extra-role',false]]);
});

test('V2 information is preserved and escaped inside ticket transcripts', () => {
  const html = renderTranscript({id:1,owner_id:'owner',subject:'Help'},[{id:'1',createdTimestamp:1,
    author:{tag:'user',id:'123'},content:'',attachments:new Collection(),embeds:[],
    components:[{type:17,components:[{type:10,content:'Support information <script>bad()</script>'}]}]}],'staff','Resolved');
  assert.ok(html.includes('Support information &lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});

test('authentic active Discord tickets can be recovered after host database loss; foreign messages cannot', async t => {
  const { store, bot } = fixture(t);
  const make = (id,author) => ({id:String(id),type:0,topic:`asrp-ticket:${id}:owner:123`,name:`support-member-${id}`,
    messages:{fetch:async()=>new Collection([['p',{id:'p',author:{id:author},createdTimestamp:1,
      embeds:[{title:`Support Ticket #${id}`,description:'**Opened by:** <@123>\n**Status:** Claimed by <@456>\n\n**Request**\nPlease help me.'}],components:[]}]])}});
  const channels = new Collection([['1',make(1,APPLICATION_ID)],['2',make(2,'another-app')]]);
  await bot.recover({channels:{fetch:async()=>channels}});
  assert.equal(store.ticket(1).owner_id,'123'); assert.equal(store.ticket(1).claimed_by,'456');
  assert.equal(store.ticket(2),undefined);
});
