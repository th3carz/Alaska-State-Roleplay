import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const GUILD_ID = '1534042183559282819';
export const SERVER_NAME = 'Alaska State Roleplay';
export const APPLICATION_ID = '1561501281355300895';
export const BOT_NAME = 'Alaska Operations';
export const defaults = Object.freeze({
  welcome: { enabled: true, channelId: null, banner: null,
    message: 'Welcome to **Alaska State Roleplay**, {user}! Thank you for joining; we hope you enjoy your time here.' },
  sessions: { channelId: null, code: null, staffRoleId: null, pingRoleId: null, banner: null, serverLabel: 'Alaska State Roleplay | VC Only', ownerLabel: null },
  tickets: { categoryId: null, supportRoleId: null, logChannelId: null, banner: null, panelChannelId: null,
    reportRoleId: null, managementRoleId: null, leadershipRoleIds: [] },
  panels: { enabled: true, homeChannelId: null, affiliationChannelId: null },
});

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS panels (kind TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL,
        channel_id TEXT UNIQUE, panel_id TEXT, claimed_by TEXT,
        state TEXT NOT NULL DEFAULT 'creating', subject TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        close_reason TEXT, closed_by TEXT, closed_at TEXT,
        log_channel_id TEXT NOT NULL, support_role_id TEXT NOT NULL,
        transcript_id TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_ticket_per_owner
      ON tickets(owner_id) WHERE state IN ('creating','open','closing');
      CREATE TABLE IF NOT EXISTS session_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, goal INTEGER NOT NULL CHECK(goal>0),
        host_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT,
        state TEXT NOT NULL DEFAULT 'creating', needs_refresh INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_session_vote ON session_votes((1)) WHERE state IN ('creating','open');
      CREATE TABLE IF NOT EXISTS session_vote_users (
        vote_id INTEGER NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(vote_id,user_id)
      );
    `);
    if (!this.db.prepare('PRAGMA table_info(tickets)').all().some(c => c.name === 'details'))
      this.db.exec("ALTER TABLE tickets ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
    if (!this.db.prepare('PRAGMA table_info(session_votes)').all().some(c => c.name === 'needs_refresh'))
      this.db.exec('ALTER TABLE session_votes ADD COLUMN needs_refresh INTEGER NOT NULL DEFAULT 1');
  }
  settings() {
    const row = this.db.prepare('SELECT value FROM settings WHERE id=1').get();
    const saved = row ? JSON.parse(row.value) : {};
    return Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, { ...v, ...saved[k] }]));
  }
  configure(section, patch) {
    const settings = this.settings();
    if (!Object.hasOwn(defaults, section)) throw new Error('Unknown setting section');
    settings[section] = { ...settings[section], ...patch };
    this.db.prepare('INSERT INTO settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(JSON.stringify(settings));
    return settings;
  }
  hasMigration(id) { return !!this.db.prepare('SELECT id FROM migrations WHERE id=?').get(id); }
  completeMigration(id) { this.db.prepare('INSERT OR IGNORE INTO migrations(id) VALUES (?)').run(id); }
  seedSettings(seed, migrationId, { overwrite = false } = {}) {
    if (this.db.prepare('SELECT id FROM migrations WHERE id=?').get(migrationId)) return;
    this.db.exec('BEGIN');
    try {
      for (const [section, values] of Object.entries(seed)) {
        const current = this.settings()[section];
        if (!current) throw new Error('Invalid server seed section');
        const patch = Object.fromEntries(Object.entries(values).filter(([key]) => overwrite || current[key] == null || (Array.isArray(current[key]) && current[key].length === 0)));
        if (Object.keys(patch).length) this.configure(section, patch);
      }
      this.db.prepare('INSERT INTO migrations(id) VALUES (?)').run(migrationId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  panel(kind) { return this.db.prepare('SELECT * FROM panels WHERE kind=?').get(kind); }
  panelForMessage(id) { return this.db.prepare('SELECT * FROM panels WHERE message_id=?').get(id); }
  savePanel(kind, channelId, messageId) {
    this.db.prepare('INSERT INTO panels VALUES (?,?,?) ON CONFLICT(kind) DO UPDATE SET channel_id=excluded.channel_id,message_id=excluded.message_id')
      .run(kind, channelId, messageId);
  }
  session() {
    const row = this.db.prepare('SELECT value FROM sessions WHERE id=1').get();
    return row ? JSON.parse(row.value) : null;
  }
  saveSession(value) {
    this.db.prepare('INSERT INTO sessions VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(JSON.stringify(value));
  }
  reserveTicket(owner, subject, config, details = {}) {
    const result = this.db.prepare('INSERT INTO tickets(owner_id,subject,log_channel_id,support_role_id,details) VALUES (?,?,?,?,?)')
      .run(owner, subject, config.logChannelId, config.supportRoleId, JSON.stringify(details));
    return this.ticket(Number(result.lastInsertRowid));
  }
  ticket(id) { return this.db.prepare('SELECT * FROM tickets WHERE id=?').get(id); }
  importTicket(id, ownerId, channelId, subject, config, details, panelId, claimedBy, createdAt) {
    this.db.prepare(`INSERT INTO tickets(id,owner_id,channel_id,subject,log_channel_id,support_role_id,details,panel_id,claimed_by,state,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,'open',?)`).run(id,ownerId,channelId,subject,config.logChannelId,config.supportRoleId,
        JSON.stringify(details),panelId,claimedBy,createdAt);
    return this.ticket(id);
  }
  forChannel(id) { return this.db.prepare('SELECT * FROM tickets WHERE channel_id=?').get(id); }
  activeForOwner(id) {
    return this.db.prepare("SELECT * FROM tickets WHERE owner_id=? AND state IN ('creating','open','closing')").get(id);
  }
  activeTickets() { return this.db.prepare("SELECT * FROM tickets WHERE state IN ('creating','open','closing')").all(); }
  updateTicket(id, patch) {
    const fields = new Set(['channel_id','panel_id','claimed_by','state','close_reason','closed_by','closed_at','transcript_id','details']);
    const keys = Object.keys(patch);
    if (!keys.length || keys.some(k => !fields.has(k))) throw new Error('Invalid ticket update');
    this.db.prepare(`UPDATE tickets SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`)
      .run(...keys.map(k => patch[k]), id);
    return this.ticket(id);
  }
  vote(id) { return this.db.prepare('SELECT * FROM session_votes WHERE id=?').get(id); }
  openVote() { return this.db.prepare("SELECT * FROM session_votes WHERE state IN ('creating','open')").get(); }
  newVote(goal, hostId, channelId) {
    const result = this.db.prepare('INSERT INTO session_votes(goal,host_id,channel_id) VALUES (?,?,?)').run(goal, hostId, channelId);
    return this.vote(Number(result.lastInsertRowid));
  }
  updateVote(id, state, messageId = null) {
    this.db.prepare('UPDATE session_votes SET state=?,message_id=COALESCE(?,message_id),needs_refresh=1 WHERE id=?').run(state,messageId,id);
    return this.vote(id);
  }
  voters(id) { return this.db.prepare('SELECT user_id FROM session_vote_users WHERE vote_id=? ORDER BY rowid').all(id).map(r => r.user_id); }
  addVoter(id, userId) {
    const added = this.db.prepare('INSERT OR IGNORE INTO session_vote_users VALUES (?,?)').run(id,userId).changes > 0;
    if (added) this.db.prepare('UPDATE session_votes SET needs_refresh=1 WHERE id=?').run(id);
    return added;
  }
  pendingVoteMessages() { return this.db.prepare('SELECT * FROM session_votes WHERE needs_refresh=1 AND message_id IS NOT NULL').all(); }
  voteRefreshed(id) { this.db.prepare('UPDATE session_votes SET needs_refresh=0 WHERE id=?').run(id); }
  close() { this.db.close(); }
}

// Locks reject repeated clicks immediately instead of allowing a queue of duplicate actions.
export class Locks {
  keys = new Set();
  async run(key, fn) {
    if (this.keys.has(key)) throw new Error('This action is already being processed. Please wait a moment.');
    this.keys.add(key);
    try { return await fn(); } finally { this.keys.delete(key); }
  }
}
