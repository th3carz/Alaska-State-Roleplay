import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, Events, GatewayIntentBits, ActivityType } from 'discord.js';
import { Store, GUILD_ID, SERVER_NAME, APPLICATION_ID, BOT_NAME } from './store.js';
import { commands } from './commands.js';
import { Bot } from './bot.js';
import { SERVER_SETTINGS, SERVER_SEED_KEY, REFERENCE_SETTINGS, REFERENCE_SEED_KEY } from './server-config.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.error('DISCORD_TOKEN is missing. Set it privately in the host environment or in a local .env file.');
  process.exit(1);
}

const databasePath = process.env.PERSISTENT_DATABASE_PATH ||
  (process.env.RAILWAY_VOLUME_MOUNT_PATH ? resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'alaska.sqlite') : process.env.DATABASE_PATH) || './data/alaska.sqlite';
const store = new Store(resolve(databasePath));
store.seedSettings(SERVER_SETTINGS, SERVER_SEED_KEY);
store.seedSettings(REFERENCE_SETTINGS, REFERENCE_SEED_KEY);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  allowedMentions: { parse: [], repliedUser: false },
  presence: { activities: [{ name: SERVER_NAME, type: ActivityType.Watching }] },
});
const bot = new Bot(client, store);
let initialized = false;
let stopping = false;
let panelTimer;

client.once(Events.ClientReady, async () => {
  try {
    if (client.user.id !== APPLICATION_ID) {
      console.error(`DISCORD_TOKEN belongs to a different application. Expected application ${APPLICATION_ID}; refusing to register commands or change its identity.`);
      await shutdown(1);
      return;
    }
    const guild = await client.guilds.fetch(GUILD_ID);
    // Apply the requested Discord profile name when this application first runs.
    if (client.user.username !== BOT_NAME) {
      try { await client.user.setUsername(BOT_NAME); }
      catch (error) { console.warn(`Could not set the bot username to ${BOT_NAME}; update it in the Discord Developer Portal:`, error.code ?? error.name); }
    }
    const me = await guild.members.fetchMe();
    if (me.nickname !== BOT_NAME) {
      try { await me.setNickname(BOT_NAME, 'Customer bot identity: Alaska Operations'); }
      catch (error) { console.warn('Could not set bot nickname; check Change Nickname permission:', error.code ?? error.name); }
    }
    await bot.recover(guild);
    await bot.sessions.recover(guild);
    // These commands belong exclusively to this customer's server.
    await guild.commands.set(commands);
    initialized = true;
    await bot.panels.sync(guild);
    panelTimer = setInterval(() => {
      if (!stopping) void (async () => {
        await bot.panels.sync(guild);
        await bot.sessions.recover(guild);
      })().catch(error => console.error('Automatic panel refresh failed:', error.code ?? error.name));
    }, 60 * 1000);
    panelTimer.unref();
    console.log(`Ready: ${BOT_NAME} for ${SERVER_NAME} (${GUILD_ID}). Welcome, sessions, and tickets enabled.`);
  } catch (error) {
    console.error('Startup failed. Check guild membership, intents, and bot permissions:', error.code ?? error.name);
    await shutdown(1);
  }
});
client.on(Events.InteractionCreate, i => {
  if (!initialized || stopping) return;
  void bot.handle(i);
});
client.on(Events.GuildMemberAdd, member => {
  if (initialized && !stopping) void bot.welcome(member).catch(error =>
    console.error('Welcome message failed:', error.code ?? error.name));
});
client.on(Events.MessageDelete, message => {
  if (!initialized || stopping || message.guildId !== GUILD_ID) return;
  if (store.panelForMessage(message.id)) void bot.panels.sync(message.guild).catch(error =>
    console.error('Deleted panel could not be restored:', error.code ?? error.name));
});
client.on(Events.ChannelDelete, channel => {
  if (channel.guild?.id !== GUILD_ID || stopping) return;
  const ticket = store.forChannel(channel.id);
  // The normal close flow records a saved transcript before deleting the channel.
  if (ticket?.state === 'open') store.updateTicket(ticket.id,
    { state: 'closed', closed_at: new Date().toISOString(), close_reason: 'Channel manually deleted outside the bot; no transcript was captured.' });
});
client.on(Events.Error, error => console.error('Discord client error:', error.code ?? error.name));
process.on('unhandledRejection', error => {
  console.error('Unexpected background failure:', error?.code ?? error?.name ?? 'UnknownError');
  void shutdown(1);
});
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  clearInterval(panelTimer);
  // Stop accepting interactions, then give in-flight ticket actions time to commit.
  const deadline = Date.now() + 20_000;
  while (bot.locks.keys.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
  await client.destroy();
  store.close();
  process.exit(code);
}
try { await client.login(token); }
catch (error) {
  console.error('Login failed. Check the bot token and privileged intents:', error.code ?? error.name);
  await shutdown(1);
}
