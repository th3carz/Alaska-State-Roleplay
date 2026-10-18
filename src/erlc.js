// Official ER:LC v2 API: https://apidocs.erlc.gg/api-reference/fetch-server-information
export class Erlc {
  constructor({ key = process.env.ERLC_API_KEY || process.env.ERLC_SERVER_KEY, fetcher = fetch, now = Date.now } = {}) {
    this.key = key?.trim(); this.fetcher = fetcher; this.now = now;
    this.cache = { connected: false, reason: this.key ? 'Waiting for server data' : 'Live data is not connected' };
    this.nextAt = 0; this.inflight = null; this.disabled = false;
  }
  async snapshot() {
    if (!this.key || this.disabled || this.now() < this.nextAt) return this.cache;
    if (this.inflight) return this.inflight;
    this.inflight = this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }
  async refresh() {
    this.nextAt = this.now() + 60_000;
    try {
      const response = await this.fetcher('https://api.erlc.gg/v2/server?Players=true&Queue=true', {
        headers: { 'server-key': this.key }, signal: AbortSignal.timeout(8000), redirect: 'error',
      });
      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const retry = Math.max(Number(response.headers.get('retry-after')) || 0, Number(data.retry_after) || 0, 60);
        this.nextAt = this.now() + retry * 1000;
        this.cache = { ...this.cache, connected: false, reason: 'Live data is temporarily unavailable', stale: true };
        return this.cache;
      }
      if ([400, 401, 403, 404].includes(response.status)) {
        this.disabled = true;
        console.warn('ER:LC API access rejected; polling stopped. Check ERLC_API_KEY, then restart. Status:', response.status);
        return this.cache = { connected: false, reason: 'Live data is not connected' };
      }
      if (!response.ok) throw new Error('ERLC_UNAVAILABLE');
      const data = await response.json();
      if (!Number.isInteger(data.CurrentPlayers) || data.CurrentPlayers < 0 || !Number.isInteger(data.MaxPlayers) || data.MaxPlayers <= 0 || !Array.isArray(data.Players) || !Array.isArray(data.Queue))
        throw new Error('ERLC_INVALID_DATA');
      this.cache = { connected: true, players: data.CurrentPlayers, maxPlayers: data.MaxPlayers,
        queue: data.Queue.length, staff: data.Players.filter(p => ['Server Owner','Server Administrator','Server Moderator'].includes(p.Permission)).length,
        name: typeof data.Name === 'string' ? data.Name : null,
        code: typeof data.JoinKey === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(data.JoinKey) ? data.JoinKey : null,
        updatedAt: new Date(this.now()).toISOString() };
    } catch { this.cache = { ...this.cache, connected: false, stale: true, reason: 'Live data is temporarily unavailable' }; }
    return this.cache;
  }
}
