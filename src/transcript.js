import { AttachmentBuilder } from 'discord.js';
import { SERVER_NAME } from './store.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderTranscript(ticket, messages, closer, reason) {
  const rows = messages.map(m => {
    const files = [...m.attachments.values()].map(a => `<p>Attachment: ${escapeHtml(a.name)} — ${escapeHtml(a.url)}</p>`).join('');
    const embeds = m.embeds.map(e => `<pre>${escapeHtml([e.title, e.description,
      ...(e.fields ?? []).map(f => `${f.name}: ${f.value}`)].filter(Boolean).join('\n'))}</pre>`).join('');
    return `<article><header>${escapeHtml(m.author?.tag ?? 'Unknown user')} (${escapeHtml(m.author?.id ?? 'unknown')}) · ${escapeHtml(new Date(m.createdTimestamp).toISOString())}</header><pre>${escapeHtml(m.content)}</pre>${files}${embeds}</article>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Ticket ${ticket.id} transcript</title><style>body{font:15px system-ui;background:#eef3f6;color:#172b3a;max-width:960px;margin:32px auto;padding:0 20px}article{background:white;border:1px solid #d6e1e7;border-radius:8px;padding:16px;margin:12px 0}header{font-weight:600;color:#34637a}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}p{overflow-wrap:anywhere}</style><h1>${SERVER_NAME} — Ticket #${ticket.id}</h1><p>Opened by: ${escapeHtml(ticket.owner_id)} · Claimed by: ${escapeHtml(ticket.claimed_by ?? 'Unclaimed')}</p><p>Closed by: ${escapeHtml(closer)} · Reason: ${escapeHtml(reason)}</p><p>Request: ${escapeHtml(ticket.subject)}</p><p>Attachments are recorded as names and URLs; Discord attachment links may expire. Deleted messages, thread replies, reactions, and edit history are not included.</p>${rows}</html>`;
}

// Fetch all pages. Never delete a ticket after a partial export or failed log upload.
export async function collectTranscript(channel, ticket, closer, reason) {
  const messages = [];
  let before;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
    if (!page.size) break;
    messages.push(...page.values());
    const last = page.last().id;
    if (last === before) throw new Error('Could not finish the transcript; the ticket has been kept open.');
    before = last;
    if (page.size < 100) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const buffer = Buffer.from(renderTranscript(ticket, messages, closer, reason), 'utf8');
  const limit = Math.min(channel.guild.maximumFileSize ?? 8_000_000, 8_000_000);
  if (buffer.length > limit) throw new Error('Transcript exceeds the upload limit. The ticket has been kept open for a manual export.');
  return new AttachmentBuilder(buffer, { name: `AlaskaStateRoleplay-Ticket-${ticket.id}.html` });
}
