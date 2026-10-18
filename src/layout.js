import { fileURLToPath } from 'node:url';
import { AttachmentBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
  SeparatorBuilder, TextDisplayBuilder, MessageFlags, SectionBuilder, ButtonBuilder, ButtonStyle, FileBuilder } from 'discord.js';
import { BOT_NAME, SERVER_NAME } from './store.js';

export const bannerPath = name => fileURLToPath(new URL(`../assets/banners/${name}.png`, import.meta.url));
// Explicit null also clears an earlier colored accent when an existing card is edited.
export const plainContainer = () => new ContainerBuilder({ accent_color: null });
export function card(title, text, { banner = null, imageURL = null, rows = [], metrics = [], attachments = [], mentions = { parse: [] } } = {}) {
  const box = plainContainer();
  const files = [...attachments];
  if (imageURL || banner) {
    const url = imageURL || `attachment://${banner}.png`;
    if (!imageURL) files.push(new AttachmentBuilder(bannerPath(banner), { name: `${banner}.png` }));
    box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)));
    box.addSeparatorComponents(new SeparatorBuilder());
  }
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${text}`));
  for (const metric of metrics) box.addSeparatorComponents(new SeparatorBuilder()).addSectionComponents(
    new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${metric.name}**\n-# ${metric.description}`))
      .setButtonAccessory(new ButtonBuilder().setCustomId(`metric:${metric.name.toLowerCase()}`).setLabel(String(metric.value)).setStyle(ButtonStyle.Secondary).setDisabled(true)));
  for (const row of rows) box.addActionRowComponents(row);
  for (const file of attachments) box.addFileComponents(new FileBuilder().setURL(`attachment://${file.name}`));
  box.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${SERVER_NAME} | ${BOT_NAME}`));
  return { flags: MessageFlags.IsComponentsV2, components: [box], ...(files.length ? { files } : {}), allowedMentions: mentions };
}
export function editPayload(payload) {
  return payload.flags & MessageFlags.IsComponentsV2 ? { ...payload, content: null, embeds: [], attachments: [] } : payload;
}
export function componentText(components = []) {
  return components.flatMap(component => {
    const c = component.toJSON ? component.toJSON() : component;
    return [c.content, ...(c.components ? [componentText(c.components)] : [])].filter(Boolean);
  }).join('\n');
}
