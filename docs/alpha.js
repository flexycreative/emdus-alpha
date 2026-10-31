// Binance Alpha token registry — sağlamlaştırılmış sürüm.
const ALPHA_HOST = 'https://www.binance.com';
const LIST_PATH  = '/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list';
const CACHE_MS   = 3600000;

const up = s => String(s || '').toLocaleUpperCase('en-US').replace(/İ/g, 'I');

export function normalizeToken(x) {
  if (!x) return null;
  const rawSym = up(x.symbol);
  // alphaId, tokenId veya id alanlarından hangisi doluysa onu kullan, içindeki "ALPHA_" önekini ve rakam dışı karakterleri temizle.
  const rawId  = x.alphaId ?? x.alpha_id ?? x.tokenId ?? x.id;
  const id     = String(rawId || '').replace(/^ALPHA_/i, '').replace(/[^0-9]/g, '');
  const quote  = up(x.quoteAsset || '').replace(/[^A-Z]/g, '');
  // baseAsset varsa onu kullan; yoksa sembolden türet.
  let base = up(x.baseAsset || '');

  // Eğer sembol zaten ALPHA_<id><quote> formatındaysa, doğrudan onu kullan.
  if (/^ALPHA_\d+(USDT|USDC)$/.test(rawSym)) {
    return {
      base: base || rawSym.replace(/^ALPHA_\d+/, '').replace(/(USDT|USDC)$/, ''),
      quote: rawSym.endsWith('USDC') ? 'USDC' : 'USDT',
      full: rawSym,
      id,
      name: x.name ? String(x.name) : '',
      chainId: x.chainId ? String(x.chainId) : null,
      contract: x.contractAddress ? String(x.contractAddress) : null,
      supply: +x.circulatingSupply > 0 ? +x.circulatingSupply : null,
    };
  }

  // Sembol base ise (ör. "PEPE"), id ve quote ile tam sembolü üret.
  if (id) {
    const q = (quote === 'USDC' || quote === 'USDT') ? quote : 'USDT';
    base = base || rawSym.replace(/(USDT|USDC)$/, '');
    return {
      base,
      quote: q,
      full: `ALPHA_${id}${q}`,
      id,
      name: x.name ? String(x.name) : '',
      chainId: x.chainId ? String(x.chainId) : null,
      contract: x.contractAddress ? String(x.contractAddress) : null,
      supply: +x.circulatingSupply > 0 ? +x.circulatingSupply : null,
    };
  }

  return null; // Ne id ne de geçerli bir sembol varsa, bu tokeni atla.
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
