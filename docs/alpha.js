// Binance Alpha token registry — tarayıcıda ve Node testlerinde çalışır.
const ALPHA_HOST = 'https://www.binance.com';
const LIST_PATH  = '/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list';
const CACHE_MS   = 3600000;

const up = s => String(s || '').toLocaleUpperCase('en-US').replace(/İ/g, 'I');

export function normalizeToken(x) {
  if (!x) return null;
  const rawSym = up(x.symbol);
  const id     = x.alphaId ?? x.alpha_id ?? x.tokenId ?? x.id;
  const quote  = up(x.quoteAsset || '').replace(/[^A-Z]/g, '');
  const baseA  = up(x.baseAsset || '');

  let full, base, q;
  if (/^ALPHA_\d+(USDT|USDC)$/.test(rawSym)) {
    full = rawSym;
    q    = rawSym.endsWith('USDC') ? 'USDC' : 'USDT';
    base = baseA || rawSym.replace(/^ALPHA_\d+/, '').replace(/(USDT|USDC)$/, '');
  } else if (id) {
    q    = (quote === 'USDC' || quote === 'USDT') ? quote : 'USDT';
    full = `ALPHA_${id}${q}`;
    base = baseA || rawSym.replace(/(USDT|USDC)$/, '');
  } else {
    return null;
  }
  if (!base) return null;

  return {
    base, quote: q, full,
    id: String(id ?? ''),
    name: x.name ? String(x.name) : '',
    chainId: x.chainId ? String(x.chainId) : null,
    contract: x.contractAddress ? String(x.contractAddress) : null,
    supply: +x.circulatingSupply > 0 ? +x.circulatingSupply : null,
  };
}

export async function fetchAlphaTokens({ fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${ALPHA_HOST}${LIST_PATH}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Alpha listesi: HTTP ' + r.status);
  const j = await r.json();
  if (!j || j.success === false) throw new Error('Alpha listesi: ' + (j?.message || 'yanıt geçersiz'));
  const arr = Array.isArray(j.data) ? j.data : [];
  return arr.map(normalizeToken).filter(Boolean);
}

export class AlphaRegistry {
  constructor({ storage = null, fetchImpl = fetch } = {}) {
    this.storage = storage;
    this.fetchImpl = fetchImpl;
    this.byBase = new Map();
    this.byFull = new Map();
    this.loading = null;
    this.loadedAt = 0;
  }
  _hydrate(cache) {
    if (!cache?.list?.length) return;
    for (const t of cache.list) {
      const tok = normalizeToken(t);
      if (tok) { this.byBase.set(tok.base, tok); this.byFull.set(tok.full, tok); }
    }
    this.loadedAt = cache.t || 0;
  }
  _persist() {
    if (!this.storage) return;
    try { this.storage.set('alpha_reg_v1', JSON.stringify({ t: Date.now(), list: [...this.byBase.values()] })); } catch {}
  }
  async load({ force = false } = {}) {
    if (!force && this.byBase.size && Date.now() - this.loadedAt < CACHE_MS) return this;
    if (this.loading) return this.loading;
    if (!force && this.storage) {
      try { const c = JSON.parse(this.storage.get('alpha_reg_v1') || 'null'); this._hydrate(c); } catch {}
      if (this.byBase.size && Date.now() - this.loadedAt < CACHE_MS) return this;
    }
    this.loading = (async () => {
      const list = await fetchAlphaTokens({ fetchImpl: this.fetchImpl });
      this.byBase.clear(); this.byFull.clear();
      for (const t of list) { this.byBase.set(t.base, t); this.byFull.set(t.full, t); }
      this.loadedAt = Date.now();
      this._persist();
      return this;
    })();
    try { return await this.loading; } finally { this.loading = null; }
  }
  resolve(input) {
    const s = up(input).replace(/\s+/g, '');
    if (!s) return null;
    if (this.byFull.has(s)) return this.byFull.get(s);
    const noQuote = s.replace(/(USDT|USDC)$/, '');
    if (this.byBase.has(noQuote)) return this.byBase.get(noQuote);
    if (/^\d+$/.test(noQuote)) { const t = [...this.byBase.values()].find(x => x.id === noQuote); if (t) return t; }
    return [...this.byBase.values()].find(x => up(x.name).replace(/\s+/g, '') === noQuote) || null;
  }
  symbols() { return [...this.byBase.values()].sort((a, b) => a.base.localeCompare(b.base)); }
}
