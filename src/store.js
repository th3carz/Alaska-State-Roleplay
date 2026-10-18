import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const GUILD_ID = '1534042183559282819';
export const SERVER_NAME = 'Alaska State Roleplay';
export const APPLICATION_ID = '1561501281355300895';
export const BOT_NAME = 'Alaska Operations';
export const defaults = Object.freeze({
  welcome: { enabled: true, channelId: null, banner: null,
    message: 'Welcome to **Alaska State Roleplay**, {user}!\nWe hope you enjoy your time with us. You are member **#{memberCount}**.' },
  sessions: { channelId: null, code: null, staffRoleId: null, pingRoleId: null, banner: null },
  tickets: { categoryId: null, supportRoleId: null, logChannelId: null, banner: null },
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
    `);
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
  session() {
    const row = this.db.prepare('SELECT value FROM sessions WHERE id=1').get();
    return row ? JSON.parse(row.value) : null;
  }
  saveSession(value) {
    this.db.prepare('INSERT INTO sessions VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(JSON.stringify(value));
  }
  reserveTicket(owner, subject, config) {
    const result = this.db.prepare('INSERT INTO tickets(owner_id,subject,log_channel_id,support_role_id) VALUES (?,?,?,?)')
      .run(owner, subject, config.logChannelId, config.supportRoleId);
    return this.ticket(Number(result.lastInsertRowid));
  }
  ticket(id) { return this.db.prepare('SELECT * FROM tickets WHERE id=?').get(id); }
  forChannel(id) { return this.db.prepare('SELECT * FROM tickets WHERE channel_id=?').get(id); }
  activeForOwner(id) {
    return this.db.prepare("SELECT * FROM tickets WHERE owner_id=? AND state IN ('creating','open','closing')").get(id);
  }
  activeTickets() { return this.db.prepare("SELECT * FROM tickets WHERE state IN ('creating','open','closing')").all(); }
  updateTicket(id, patch) {
    const fields = new Set(['channel_id','panel_id','claimed_by','state','close_reason','closed_by','closed_at','transcript_id']);
    const keys = Object.keys(patch);
    if (!keys.length || keys.some(k => !fields.has(k))) throw new Error('Invalid ticket update');
    this.db.prepare(`UPDATE tickets SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`)
      .run(...keys.map(k => patch[k]), id);
    return this.ticket(id);
  }
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
