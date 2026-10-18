import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { GUILD_ID, SERVER_NAME } from './store.js';
import { homePanel, sessionStatusPanel, openPanel } from './ui.js';

const titles = { home: SERVER_NAME, sessions: 'Session Status', support: 'Support Tickets' };
export function isOurPanel(message, kind, botId) {
  return message.author?.id === botId && message.embeds?.some(e => e.title === titles[kind]);
}

export class Panels {
  constructor(bot) { this.bot = bot; }
  definitions() {
    const settings = this.bot.store.settings();
    return [
      { kind: 'home', channelId: settings.panels.homeChannelId, payload: homePanel(settings, GUILD_ID) },
      { kind: 'sessions', channelId: settings.sessions.channelId,
        payload: sessionStatusPanel(settings.sessions, this.bot.store.session()) },
      { kind: 'support', channelId: settings.tickets.panelChannelId, payload: openPanel(settings.tickets) },
    ];
  }
  async sync(guild) {
    if (guild.id !== GUILD_ID || !this.bot.store.settings().panels.enabled) return [];
    const results = [];
    for (const panel of this.definitions()) {
      if (!panel.channelId) continue;
      try { results.push({ kind: panel.kind, ...await this.ensure(guild, panel) }); }
      catch (error) {
        console.error(`Auto panel ${panel.kind} failed in ${panel.channelId}:`, error.code ?? error.message);
        results.push({ kind: panel.kind, error: error.code ?? error.message });
      }
    }
    return results;
  }
  async ensure(guild, definition) {
    if (guild.id !== GUILD_ID) throw new Error('Panel destination is outside Alaska State Roleplay.');
    const { kind, channelId, payload } = definition;
    return this.bot.locks.run(`panel:${kind}`, async () => {
      const channel = await this.bot.channel(guild, channelId, ChannelType.GuildText);
      const me = await this.bot.botMember(guild);
      const permissions = channel.permissionsFor(me);
      const required = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks];
      if (!permissions?.has(required)) {
        const missing = permissions?.missing(required) ?? ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks'];
        throw new Error(`Missing channel permissions: ${missing.join(', ')}`);
      }
      const saved = this.bot.store.panel(kind);
      let message;
      if (saved?.channel_id === channelId) {
        try {
          const found = await channel.messages.fetch({ message: saved.message_id, cache: false });
          if (isOurPanel(found, kind, me.id)) message = found;
        } catch (error) { if (error.code !== 10008) throw error; }
      }
      if (!message) {
        // Search all channel history before sending. This also recovers panel IDs
        // if the host replaced the local database during a redeploy.
        let before;
        while (true) {
          const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
          message = page.find(candidate => isOurPanel(candidate, kind, me.id));
          if (message || page.size < 100) break;
          const next = page.last()?.id;
          if (!next || next === before) throw new Error('Could not finish checking existing panels.');
          before = next;
        }
      }
      const action = message ? 'updated' : 'created';
      const result = message ? await message.edit(payload) : await channel.send(payload);
      this.bot.store.savePanel(kind, channelId, result.id);
      console.log(`Auto panel ${kind} ${action}: channel=${channelId} message=${result.id}`);
      return { action, channelId, messageId: result.id };
    });
  }
}
