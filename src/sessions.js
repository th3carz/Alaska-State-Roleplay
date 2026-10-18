import { AttachmentBuilder, PermissionFlagsBits as P } from 'discord.js';
import { Erlc } from './erlc.js';
import { assertSessionTransition, sessionPayload, votePanel } from './ui.js';
import { editPayload } from './layout.js';

export class Sessions {
  constructor(bot, erlc = new Erlc()) { this.bot = bot; this.erlc = erlc; }
  async requireStaff(i) {
    const member = await this.bot.member(i);
    const config = this.bot.store.settings().sessions;
    if (!member.permissions.has(P.ManageGuild) && !(config.staffRoleId && member.roles.cache.has(config.staffRoleId)))
      throw new Error('Only the session staff role or a server manager can manage sessions.');
  }
  async command(i) {
    await this.requireStaff(i);
    await this.bot.locks.run('session', async () => {
      const config = this.bot.store.settings().sessions;
      let action = i.options.getSubcommand();
      action = { startup: 'start', shutdown: 'end' }[action] || action;
      if (action === 'panel') {
        const results = await this.bot.panels.sync(i.guild);
        if (results.find(p => p.kind === 'sessions')?.error) throw new Error('The session panel could not be posted. Check bot channel permissions.');
        await i.editReply(`Session panel ready in <#${config.channelId}>.`);
        return;
      }
      if (action === 'cancel-vote') {
        const vote = this.bot.store.openVote();
        if (!vote) throw new Error('There is no open session vote.');
        this.bot.store.updateVote(vote.id, 'closed');
        await this.updateVote(i.guild, this.bot.store.vote(vote.id));
        await i.editReply('Session vote cancelled.');
        return;
      }
      const channel = await this.bot.channel(i.guild, config.channelId);
      const me = await this.bot.botMember(i.guild);
      if (!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.AttachFiles,P.ReadMessageHistory]))
        throw new Error('The session channel requires View Channel, Send Messages, Attach Files, and Read Message History.');
      if (action === 'vote') {
        if (this.bot.store.session() && this.bot.store.session().status !== 'end') throw new Error('End the current session before opening a vote.');
        if (this.bot.store.openVote()) throw new Error('There is already an open session vote.');
        const goal = i.options.getInteger('votes', true);
        if (!Number.isInteger(goal) || goal < 1 || goal > 1000) throw new Error('Choose a vote goal from 1 to 1,000.');
        const vote = this.bot.store.newVote(goal, i.user.id, channel.id);
        try {
          const message = await channel.send(votePanel({ ...vote, state: 'open' }, [], config));
          this.bot.store.updateVote(vote.id, 'open', message.id);
        } catch (error) {
          // A timed-out send must not leave another vote permanently blocked.
          this.bot.store.updateVote(vote.id, 'closed');
          throw error;
        }
        await i.editReply(`Session vote posted. Target: ${goal} votes.`);
        return;
      }
      const live = await this.erlc.snapshot();
      const effective = { ...config, code: live.connected && live.code ? live.code : config.code };
      if (!effective.code) throw new Error('Configure the ER:LC code with /configure sessions first.');
      const previous = this.bot.store.session();
      assertSessionTransition(previous, action);
      const host = action === 'start' ? i.user.id : previous.hostId;
      const announcement = await channel.send(sessionPayload(action, effective, host, i.options.getString('message')));
      this.bot.store.saveSession({ status: action, hostId: host, messageId: announcement.id, channelId: channel.id,
        startedAt: action === 'start' ? new Date().toISOString() : previous.startedAt, updatedAt: new Date().toISOString() });
      if (action === 'start' && this.bot.store.openVote()) {
        const vote = this.bot.store.openVote();
        this.bot.store.updateVote(vote.id, 'closed');
        await this.updateVote(i.guild, this.bot.store.vote(vote.id));
      }
      await this.bot.panels.sync(i.guild);
      await i.editReply(`Session ${action === 'start' ? 'startup' : action === 'end' ? 'shutdown' : action} announced in <#${channel.id}>.`);
    });
  }
  async handle(i) {
    if (!i.isButton?.() || !i.customId.startsWith('session:')) return false;
    await i.deferReply({ flags: 64 });
    if (i.customId === 'session:notifications') {
      await this.bot.locks.run(`notification:${i.user.id}`, async () => {
        const config = this.bot.store.settings().sessions;
        if (!config.pingRoleId) throw new Error('The session notification role is not configured.');
        const role = await i.guild.roles.fetch(config.pingRoleId);
        const me = await this.bot.botMember(i.guild);
        if (!role || role.managed || role.id === i.guild.id || !me.permissions.has(P.ManageRoles) || me.roles.highest.comparePositionTo(role) <= 0)
          throw new Error('The bot needs Manage Roles and a role above the Sessions role to change notifications.');
        const member = await this.bot.member(i);
        const has = member.roles.cache.has(role.id);
        await member.roles[has ? 'remove' : 'add'](role, 'Member toggled session notifications');
        await i.editReply({ content: has ? 'Session notifications disabled.' : 'Session notifications enabled.', allowedMentions: { parse: [] } });
      });
      return true;
    }
    const match = /^session:(vote|voters):(\d+)$/.exec(i.customId);
    if (!match) throw new Error('This session control is unavailable.');
    const id = Number(match[2]);
    const vote = this.bot.store.vote(id);
    if (!vote || vote.channel_id !== i.channelId || vote.message_id !== i.message.id) throw new Error('This session vote could not be found.');
    if (match[1] === 'voters') {
      const voters = this.bot.store.voters(id);
      const content = voters.length ? `**Voters (${voters.length})**\n${voters.slice(0,50).map(user => `<@${user}>`).join('\n')}` : 'No votes have been cast yet.';
      await i.editReply({ content, ...(voters.length > 50 ? { files: [new AttachmentBuilder(Buffer.from(voters.join('\n')), { name: `SessionVote-${id}-Voters.txt` })] } : {}), allowedMentions: { parse: [] } });
      return true;
    }
    await this.bot.locks.run('session', async () => {
      const current = this.bot.store.vote(id);
      if (current.state !== 'open') throw new Error('This vote has ended.');
      await this.bot.member(i);
      if (i.user.bot) throw new Error('Bot accounts cannot vote.');
      const added = this.bot.store.addVoter(id, i.user.id);
      if (!added) { await i.editReply('Your vote has already been counted.'); return; }
      const users = this.bot.store.voters(id);
      const passed = users.length >= current.goal;
      if (passed) this.bot.store.updateVote(id, 'passed');
      let refreshed = true;
      try { await this.updateVote(i.guild, this.bot.store.vote(id)); } catch { refreshed = false; }
      await i.editReply(`Your vote has been counted.${passed ? ' The vote target has been reached; please wait for staff to start the session.' : ''}${!refreshed ? ' The displayed count will refresh shortly.' : ''}`);
    });
    return true;
  }
  async updateVote(guild, vote) {
    if (!vote.message_id) return;
    const channel = await this.bot.channel(guild, vote.channel_id);
    try {
      await channel.messages.edit(vote.message_id, { ...editPayload(votePanel(vote, this.bot.store.voters(vote.id), this.bot.store.settings().sessions)), allowedMentions: { parse: [] } });
      this.bot.store.voteRefreshed(vote.id);
    }
    catch (error) {
      if (error.code === 10008) { this.bot.store.updateVote(vote.id, 'closed'); this.bot.store.voteRefreshed(vote.id); return; }
      throw error;
    }
  }
  async recover(guild) {
    const vote = this.bot.store.openVote();
    if (vote?.state === 'creating') this.bot.store.updateVote(vote.id, 'closed');
    for (const pending of this.bot.store.pendingVoteMessages()) {
      try { await this.updateVote(guild, pending); }
      catch (error) { console.warn('Session vote display could not be refreshed:', error.code ?? error.name); }
    }
  }
}
