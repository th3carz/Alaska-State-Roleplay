import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits as P, LabelBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { TICKET_TYPES, ticketDetails, ticketRoles, ticketName } from './ticket-types.js';
import { ticketModal, closeModal, ticketNotice } from './ui.js';
import { editPayload } from './layout.js';
import { collectTranscript } from './transcript.js';

function reasonModal(id) {
  return new ModalBuilder().setCustomId(`ticket:request-form:${id}`).setTitle('Request Ticket Closure')
    .addLabelComponents(new LabelBuilder().setLabel('Why should this ticket be closed?').setTextInputComponent(
      new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(500).setRequired(true)));
}
function renameModal(id) {
  return new ModalBuilder().setCustomId(`ticket:rename-form:${id}`).setTitle('Rename Ticket')
    .addLabelComponents(new LabelBuilder().setLabel('New ticket name').setTextInputComponent(
      new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(60).setRequired(true)));
}

export class TicketExtras {
  constructor(bot) { this.bot = bot; }
  async access(i, ticket, staff = false) {
    const actor = await this.bot.member(i);
    const support = actor.permissions.has(P.ManageGuild) || ticketRoles(ticket).some(id => actor.roles.cache.has(id));
    if (!support && (staff || actor.id !== ticket.owner_id)) throw new Error(staff ? 'Only support staff can use this control.' : 'Only the ticket opener or support staff can use this control.');
    return actor;
  }
  async handle(i) {
    if (i.isStringSelectMenu?.() && i.customId === 'ticket:type') {
      this.bot.requireTicketConfig();
      const type = i.values[0];
      if (!TICKET_TYPES[type]) throw new Error('Choose a valid assistance type.');
      const current = this.bot.store.activeForOwner(i.user.id);
      if (current) throw new Error(current.channel_id ? `You already have a ticket: <#${current.channel_id}>.` : 'Your ticket is being created.');
      await i.showModal(ticketModal(type));
      return true;
    }
    if (i.isButton?.() && i.customId === 'ticket:faq') {
      const payload = ticketNotice('Ticket FAQ',
        '**Which type should I choose?**\n- **General Support:** questions and everyday assistance.\n- **Internal Affairs Support:** a private staff report reviewed by management.\n- **Management Support:** matters for senior leadership.\n\n' +
        '**What should I include?**\nExplain what happened and share relevant evidence in the ticket. Do not include passwords or private account credentials.\n\n' +
        '**How do tickets close?**\nThe opener or authorized staff can close with a reason. Closure requests let the opener/staff choose Close or Keep Open. A transcript is saved before deletion.');
      await i.reply({ ...payload, flags: payload.flags | 64 });
      return true;
    }
    if (i.isStringSelectMenu?.() && /^ticket:actions:\d+$/.test(i.customId)) {
      const ticket = this.bot.getTicket(i, Number(i.customId.split(':')[2]));
      const action = i.values[0];
      await this.access(i, ticket, action === 'rename');
      if (action === 'request') await i.showModal(reasonModal(ticket.id));
      else if (action === 'rename') await i.showModal(renameModal(ticket.id));
      else if (action === 'transcript') { await i.deferReply({ flags: 64 }); await this.export(i, ticket); }
      else throw new Error('Unknown ticket action.');
      return true;
    }
    const form = i.isModalSubmit?.() && /^ticket:(request-form|rename-form):(\d+)$/.exec(i.customId);
    if (form) {
      await i.deferReply({ flags: 64 });
      const ticket = this.bot.getTicket(i, Number(form[2]));
      if (form[1] === 'request-form') await this.request(i, ticket, i.fields.getTextInputValue('reason'));
      else await this.rename(i, ticket, i.fields.getTextInputValue('name'));
      return true;
    }
    const requestButton = i.isButton?.() && /^ticket:request-(accept|keep):(\d+):([a-f0-9]+)$/.exec(i.customId);
    if (requestButton) {
      const ticket = this.bot.getTicket(i, Number(requestButton[2]));
      await this.access(i, ticket);
      const pending = ticketDetails(ticket).closeRequest;
      if (!pending || pending.nonce !== requestButton[3] || pending.messageId !== i.message.id) throw new Error('This closure request has already been handled.');
      if (requestButton[1] === 'accept') await i.showModal(closeModal(ticket.id, `ticket:request-finish:${ticket.id}:${pending.nonce}`, pending.reason));
      else {
        await i.deferReply({ flags: 64 });
        await this.keepOpen(i, ticket, pending.nonce);
      }
      return true;
    }
    const finish = i.isModalSubmit?.() && /^ticket:request-finish:(\d+):([a-f0-9]+)$/.exec(i.customId);
    if (finish) {
      await i.deferReply({ flags: 64 });
      const ticket = this.bot.getTicket(i, Number(finish[1]));
      await this.access(i, ticket);
      if (ticketDetails(ticket).closeRequest?.nonce !== finish[2]) throw new Error('This closure request has already been handled.');
      await this.bot.closeTicket(i, i.fields.getTextInputValue('reason'), ticket.id, finish[2]);
      return true;
    }
    return false;
  }
  async command(i, action) {
    if (!['add','remove','rename','transcript','request-close'].includes(action)) return false;
    const ticket = this.bot.getTicket(i);
    if (action === 'transcript') await this.export(i, ticket);
    else if (action === 'rename') await this.rename(i, ticket, i.options.getString('name', true));
    else if (action === 'request-close') await this.request(i, ticket, i.options.getString('reason', true));
    else await this.changeAccess(i, ticket, action, i.options.getMentionable('target', true));
    return true;
  }
  async export(i, ticket) {
    await this.access(i, ticket);
    const file = await collectTranscript(i.channel, ticket, i.user.id, 'Manual export; ticket remains open');
    await i.editReply({ content: 'Transcript exported. This ticket remains open.', files: [file], allowedMentions: { parse: [] } });
  }
  async rename(i, original, rawName) {
    await this.bot.locks.run(`ticket:${i.channelId}`, async () => {
      const ticket = this.bot.getTicket(i, original.id);
      await this.access(i, ticket, true);
      const name = rawName.trim();
      if (!name || name.length > 60) throw new Error('Use a ticket name from 1 to 60 characters.');
      const details = { ...ticketDetails(ticket), customName: name };
      await i.channel.setName(ticketName({ ...ticket, details: JSON.stringify(details) }), `Ticket renamed by ${i.user.id}`);
      this.bot.store.updateTicket(ticket.id, { details: JSON.stringify(details) });
      await i.editReply('Ticket renamed. Its claimed/unclaimed status was preserved.');
    });
  }
  async changeAccess(i, original, action, target) {
    await this.bot.locks.run(`ticket:${i.channelId}`, async () => {
      const ticket = this.bot.getTicket(i, original.id);
      await this.access(i, ticket, true);
      const me = await this.bot.botMember(i.guild);
      if ([i.guild.id, ticket.owner_id, me.id, ...ticketRoles(ticket)].includes(target.id))
        throw new Error('The opener, bot, @everyone, and required support roles cannot be added or removed with this command.');
      if (action === 'add') await i.channel.permissionOverwrites.edit(target.id,
        { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true });
      else await i.channel.permissionOverwrites.delete(target.id);
      const details = ticketDetails(ticket);
      const participants = new Set(details.participantIds || []);
      if (action === 'add') participants.add(target.id); else participants.delete(target.id);
      this.bot.store.updateTicket(ticket.id, { details: JSON.stringify({ ...details, participantIds: [...participants] }) });
      const role = i.guild.roles.cache.has(target.id);
      await i.channel.send(ticketNotice(action === 'add' ? (role ? 'Role Added' : 'User Added') : (role ? 'Role Removed' : 'User Removed'),
        `${role ? `<@&${target.id}>` : `<@${target.id}>`} ${action === 'add' ? 'has been added to' : 'has been removed from'} this ticket by <@${i.user.id}>.`));
      await i.editReply(`Ticket access ${action === 'add' ? 'added' : 'removed'}.`);
    });
  }
  async request(i, original, rawReason) {
    await this.bot.locks.run(`ticket:${i.channelId}`, async () => {
      const ticket = this.bot.getTicket(i, original.id);
      await this.access(i, ticket);
      const reason = rawReason.trim();
      if (reason.length < 3 || reason.length > 500) throw new Error('Give a reason from 3 to 500 characters.');
      const details = ticketDetails(ticket);
      if (details.closeRequest) throw new Error('A closure request is already pending.');
      const nonce = randomUUID().replaceAll('-', '');
      const rows = [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket:request-accept:${ticket.id}:${nonce}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ticket:request-keep:${ticket.id}:${nonce}`).setLabel('Keep Open').setStyle(ButtonStyle.Secondary))];
      const payload = ticketNotice('Close Request', `<@${ticket.owner_id}>\n\n<@${i.user.id}> requested closure of this ticket.\n> ${reason}\n\nThe opener or authorized staff can close this ticket or keep it open.`, rows);
      payload.allowedMentions = { parse: [], users: [ticket.owner_id] };
      const message = await i.channel.send(payload);
      this.bot.store.updateTicket(ticket.id, { details: JSON.stringify({ ...details, closeRequest: { nonce, messageId: message.id, by: i.user.id, reason } }) });
      await i.editReply('Closure request sent.');
    });
  }
  async keepOpen(i, original, nonce) {
    await this.bot.locks.run(`ticket:${i.channelId}`, async () => {
      const ticket = this.bot.getTicket(i, original.id);
      await this.access(i, ticket);
      const details = ticketDetails(ticket);
      if (details.closeRequest?.nonce !== nonce) throw new Error('This closure request has already been handled.');
      await i.message.edit(editPayload(ticketNotice('Request Denied', `This ticket will remain open. Closure was declined by <@${i.user.id}>.`)));
      delete details.closeRequest;
      this.bot.store.updateTicket(ticket.id, { details: JSON.stringify(details) });
      await i.editReply('The ticket will remain open.');
    });
  }
}
