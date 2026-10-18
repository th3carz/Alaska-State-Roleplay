import { MessageFlags, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, FileBuilder } from 'discord.js';
import { APPLICATION_ID, GUILD_ID } from './store.js';
import { plainContainer } from './layout.js';

const MIGRATION = 'alaska-plain-components-no-custom-emojis-2026-10-18-v1';
const withoutCustomEmojis = value => value.replace(/<a?:[A-Za-z0-9_]+:\d+>/g, '');

// Keep URLs, IDs, disabled states, and every other control property intact.
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return value;
  const output = Object.fromEntries(Object.entries(value)
    .filter(([key,v]) => !(key === 'emoji' && v?.id))
    .map(([key,v]) => [key,typeof v === 'string' && ['content','label','description','placeholder'].includes(key)
      ? withoutCustomEmojis(v) : clean(v)]));
  if (output.type === 17) output.accent_color = null;
  return output;
}

export function plainMessageEdit(message) {
  if (message.author?.id !== APPLICATION_ID) return null;
  const components = (message.components || []).map(c => c.toJSON ? c.toJSON() : c);
  const v2 = message.flags?.has?.(MessageFlags.IsComponentsV2) || (Number(message.flags?.bitfield ?? message.flags ?? 0) & MessageFlags.IsComponentsV2);
  if (v2) {
    const cleaned = clean(components);
    if (JSON.stringify(cleaned) === JSON.stringify(components)) return null;
    return { flags: MessageFlags.IsComponentsV2, components: cleaned, allowedMentions: { parse: [] } };
  }
  if (!message.embeds?.length) return null;
  const box = plainContainer();
  const addText = text => {
    if (!text) return;
    // Text Displays have a 4,000-character limit. Keep long historic fields intact.
    let remaining = withoutCustomEmojis(text);
    while (remaining.length) {
      box.addTextDisplayComponents(new TextDisplayBuilder().setContent(remaining.slice(0,4000)));
      remaining = remaining.slice(4000);
    }
  };
  addText(message.content);
  for (const embed of message.embeds) {
    const data = embed.toJSON ? embed.toJSON() : embed;
    addText([data.title ? `## ${data.title}` : '',data.description,
      ...(data.fields || []).map(f => `**${f.name}**\n${f.value}`),data.footer?.text ? `-# ${data.footer.text}` : ''].filter(Boolean).join('\n'));
    if (data.image?.url) box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(data.image.url)));
  }
  for (const file of message.attachments?.values?.() || [])
    box.addFileComponents(new FileBuilder().setURL(`attachment://${file.name}`));
  const json = clean([box.toJSON(),...components]);
  return { flags: MessageFlags.IsComponentsV2, content: null, embeds: [], components: json, allowedMentions: { parse: [] } };
}

// Only this application's own rich messages are edited. Attachments remain on the
// message: do not use editPayload(), which clears attachments for banner replacement.
export async function migrateMessageStyles(bot, guild) {
  if (guild.id !== GUILD_ID || bot.store.hasMigration(MIGRATION)) return;
  const settings = bot.store.settings();
  const ids = new Set([settings.welcome.channelId,settings.panels.homeChannelId,settings.sessions.channelId,
    settings.tickets.panelChannelId,settings.panels.affiliationChannelId,settings.tickets.logChannelId,
    '1560911382294302750',...bot.store.activeTickets().map(t=>t.channel_id)].filter(Boolean));
  let failed = false, changed = 0;
  for (const id of ids) {
    try {
      const channel = await bot.channel(guild,id);
      let before;
      while (true) {
        const page = await channel.messages.fetch({limit:100,...(before ? {before} : {}),cache:false});
        for (const message of page.values()) {
          const payload = plainMessageEdit(message);
          if (payload) { await message.edit(payload); changed++; }
        }
        if (page.size < 100) break;
        const next = page.last()?.id;
        if (!next || next === before) throw new Error('Message history could not be completed.');
        before = next;
      }
    } catch (error) {
      if (error.code === 10003) continue; // A removed former welcome/ticket channel needs no update.
      failed = true;
      console.warn(`Message style update incomplete in ${id}:`,error.code ?? error.name);
    }
  }
  if (!failed) bot.store.completeMigration(MIGRATION);
  console.log(`Components V2 style update: ${changed} existing bot messages updated${failed ? '; remaining channels will retry on restart' : ''}.`);
}
