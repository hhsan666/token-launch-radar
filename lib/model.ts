// Launch Radar's value model: the sealed snapshot in, a ranked pre-token board out.
//
// Every number this file produces follows from the snapshot's own fields. No protocol name is ever
// special-cased: the same functions score every row, and the only inputs are tvl_usd, change_7d,
// listed_at, category, chains, mcap_usd and the token fields (gecko_id, symbol).
//
// The model, in four multiplicative parts (each one shown per protocol on the dashboard):
//
//   1. size curve     log10(mcap) = a + b * log10(tvl), fitted by least squares on every protocol whose
//                     token already trades with a positive market cap (the "peers"). b < 1 means big TVL
//                     earns a smaller multiple: the snapshot's peers say so, and the fit measures it.
//   2. sector effect  the peers' mean residual by sector, then by category inside the sector, each shrunk
//                     toward its parent by n / (n + SHRINK) so a category with one peer barely moves it.
//   3. momentum       the protocol's 7-day TVL change minus the snapshot's median 7-day change (the
//                     market's drift that week), capped at +/-MOMENTUM_CAP points, at elasticity
//                     MOMENTUM_ELASTICITY: implied *= (1 + excess / 100) ^ elasticity.
//   4. runway         days since DefiLlama began tracking it with no token recorded. TVL that stayed
//                     without a token is less likely to be points-only "mercenary" capital, so the multiple
//                     is discounted for a short record: factor = RUNWAY_FLOOR + (1 - RUNWAY_FLOOR) *
//                     min(1, ln(1 + d / 30) / ln(1 + RUNWAY_FULL_DAYS / 30)). Unknown age: the midpoint.
//
//   implied = 10 ^ (a + b * log10(tvl) + sector + category) * momentum * runway
//
// The band shown with each value is the peers' residual spread in its sector: +/- 0.674 sigma, the
// middle half of where a peer at that size sits.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Every tunable constant of the model in one place: the README and the dashboard quote them. */
export const MODEL = {
  version: 'peer-curve-1',
  shrink: 4,
  momentum_cap: 30,
  momentum_elasticity: 0.5,
  runway_floor: 0.7,
  runway_full_days: 730,
  band_z: 0.674,
} as const;

/** DefiLlama categories grouped into sectors whose peers price alike. */
const SECTORS: Record<string, string[]> = {
  'Vaults & curation': ['Risk Curators', 'Onchain Capital Allocator', 'Yield', 'Yield Aggregator', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Options Vault', 'Indexes'],
  'Yield dollars': ['Basis Trading', 'Stablecoin Wrapper', 'CDP', 'CDP Manager', 'Dual-Token Stablecoin', 'Algo-Stables', 'Stablecoin Issuer', 'Reserve Currency'],
  'Lending & credit': ['Lending', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management', 'Interest Rate Derivatives'],
  Trading: ['Dexs', 'Derivatives', 'Options', 'Synthetics', 'Prediction Market', 'OTC Marketplace', 'NFT Marketplace', 'Launchpad'],
  'Real-world assets': ['RWA'],
  'Staking & BTC': ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Restaked BTC', 'Staking Pool', 'Anchor BTC', 'Decentralized BTC'],
  'Chains & infra': ['Chain', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Payments', 'Privacy', 'Crypto Card Issuer', 'Token Locker', 'DOR', 'AI Agents', 'Decentralized AI', 'Governance Incentives', 'Insurance', 'CeDeFi', 'CEX'],
};
const SECTOR_OF = new Map<string, string>();
for (const [sector, cats] of Object.entries(SECTORS)) for (const c of cats) SECTOR_OF.set(c, sector);
export const SECTOR_NAMES = [...Object.keys(SECTORS), 'Other'];

export function sectorOf(category: string | null): string {
  return (category !== null && SECTOR_OF.get(category)) || 'Other';
}

// ---------------------------------------------------------------- the house's watchlist rule, restated

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const DERIVATIVE_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export const hasToken = (p: SnapshotProtocol): boolean => p.gecko_id !== null || p.symbol !== null;

/** Why the house rule (minus the parent check, which the snapshot does not carry) leaves a pre-token protocol out, or null. */
export function ruleExclusion(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}: a wrapped, staked or bridged product, or an exchange`;
  if (VERSIONED.test(p.name)) return 'name ends in a version marker: a later version of an existing protocol';
  if (DERIVATIVE_WORD.test(p.name)) return 'name says wrapped, staked or staking: a product of an underlying asset';
  if (EXCHANGE_PREFIX.test(p.name)) return "name begins with an exchange's name";
  return null;
}

// ---------------------------------------------------------------- families: the parent link, inferred

const GENERIC_KEYS = new Set(['the', 'defi', 'finance', 'protocol', 'capital', 'labs', 'network', 'money', 'stable', 'liquid', 'staked', 'wrapped', 'usd', 'bitcoin', 'btc', 'eth', 'sol', 'open', 'smart', 'super', 'meta', 'yield', 'earn', 'vault', 'vaults', 'swap', 'lend', 'bridge', 'base', 'core', 'prime', 'one', 'pro', 'x']);

/** A protocol's family keys: the first word of its name and the first segment of its slug, lowercased. */
function familyKeys(p: SnapshotProtocol): string[] {
  const keys = new Set<string>();
  const word = p.name.split(/\s+/)[0]!.toLowerCase().replace(/[^a-z0-9]/g, '');
  const seg = p.slug.split('-')[0]!.toLowerCase();
  for (const k of [word, seg]) if (k.length >= 3 && !GENERIC_KEYS.has(k)) keys.add(k);
  return [...keys];
}

export interface Family {
  /** Other snapshot protocols sharing a family key, by slug order. */
  siblings: string[];
  /** The first sibling whose token trades, as "Name (SYMBOL)", or null. */
  token_sibling: string | null;
}

export function families(protocols: SnapshotProtocol[]): Map<string, Family> {
  const byKey = new Map<string, SnapshotProtocol[]>();
  for (const p of protocols) for (const k of familyKeys(p)) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(p);
  const out = new Map<string, Family>();
  for (const p of protocols) {
    const sib = new Map<string, SnapshotProtocol>();
    for (const k of familyKeys(p)) for (const q of byKey.get(k)!) if (q.slug !== p.slug) sib.set(q.slug, q);
    const siblings = [...sib.values()].sort((x, y) => (x.slug < y.slug ? -1 : 1));
    const tok = siblings.find(hasToken);
    out.set(p.slug, { siblings: siblings.map((s) => s.slug), token_sibling: tok ? `${tok.name}${tok.symbol ? ` (${tok.symbol})` : ''}` : null });
  }
  return out;
}

// ---------------------------------------------------------------- the peer fit

const log10 = Math.log10;
const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
export function median(xs: number[]): number {
  const b = [...xs].sort((x, y) => x - y);
  const n = b.length;
  if (n === 0) return 0;
  return n % 2 ? b[(n - 1) / 2]! : (b[n / 2 - 1]! + b[n / 2]!) / 2;
}

export interface Peer {
  slug: string;
  name: string;
  category: string | null;
  sector: string;
  symbol: string | null;
  tvl_usd: number;
  mcap_usd: number;
  /** log10(mcap / tvl) */
  multiple: number;
  /** log10(mcap) minus the size curve's prediction */
  residual: number;
}

export interface Fit {
  n: number;
  a: number;
  b: number;
  r2: number;
  sigma: number;
  market_change_7d: number;
  sector: Record<string, { n: number; effect: number; sigma: number }>;
  category: Record<string, { n: number; effect: number }>;
  /** Slopes of the residual on factors the model tested and left out, so the page can say why. */
  tested: { chains_slope: number; age_slope: number; momentum_slope: number };
  peers: Peer[];
}

function ols(xs: number[], ys: number[]): { a: number; b: number; r2: number } {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b, r2: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy) };
}

const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function fitPeers(snap: Snapshot): Fit {
  const raw = snap.protocols.filter((p) => hasToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const xs = raw.map((p) => log10(p.tvl_usd));
  const ys = raw.map((p) => log10(p.mcap_usd!));
  const { a, b, r2 } = ols(xs, ys);
  const peers: Peer[] = raw.map((p, i) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    sector: sectorOf(p.category),
    symbol: p.symbol,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd!,
    multiple: ys[i]! - xs[i]!,
    residual: ys[i]! - (a + b * xs[i]!),
  }));
  const sigma = Math.sqrt(mean(peers.map((p) => p.residual ** 2)));

  // Sector effects shrunk toward 0, then category effects shrunk toward their sector.
  const sector: Fit['sector'] = {};
  for (const s of SECTOR_NAMES) {
    const rs = peers.filter((p) => p.sector === s).map((p) => p.residual);
    const effect = rs.reduce((t, r) => t + r, 0) / (rs.length + MODEL.shrink);
    const spread = rs.length >= 3 ? Math.sqrt(mean(rs.map((r) => (r - mean(rs)) ** 2))) : sigma;
    // A sector's band never claims more certainty than half the pooled spread.
    sector[s] = { n: rs.length, effect, sigma: Math.max(spread, sigma * 0.5) };
  }
  const category: Fit['category'] = {};
  const cats = [...new Set(peers.map((p) => p.category ?? '(none)'))].sort();
  for (const c of cats) {
    const ps = peers.filter((p) => (p.category ?? '(none)') === c);
    const dev = ps.map((p) => p.residual - sector[p.sector]!.effect);
    category[c] = { n: ps.length, effect: dev.reduce((t, r) => t + r, 0) / (ps.length + MODEL.shrink) };
  }

  const changes = snap.protocols.filter((p) => p.change_7d !== null).map((p) => p.change_7d!);
  const market = median(changes);

  // Factors tested on the peers' residuals: reported, and left out of the value where they explain nothing.
  const res = peers.map((p) => p.residual);
  const chains = raw.map((p) => log10(Math.max(1, p.chains.length)));
  const withAge = raw.map((p, i) => [p, res[i]!] as const).filter(([p]) => p.listed_at !== null);
  const withMom = raw.map((p, i) => [p, res[i]!] as const).filter(([p]) => p.change_7d !== null);
  const tested = {
    chains_slope: ols(chains, res).b,
    age_slope: ols(withAge.map(([p]) => log10(1 + daysBetween(p.listed_at!, snap.as_of))), withAge.map(([, r]) => r)).b,
    momentum_slope: ols(withMom.map(([p]) => p.change_7d! - market), withMom.map(([, r]) => r)).b,
  };
  return { n: peers.length, a, b, r2, sigma, market_change_7d: market, sector, category, tested, peers };
}

// ---------------------------------------------------------------- scoring one protocol

export interface Valuation {
  base_usd: number;
  sector_mult: number;
  category_mult: number;
  momentum_excess: number | null;
  momentum_mult: number;
  runway_days: number | null;
  runway_mult: number;
  implied_usd: number;
  low_usd: number;
  high_usd: number;
  /** implied / tvl: what the model says each dollar of TVL is worth as a token. */
  multiple: number;
}

export function runwayFactor(days: number | null): number {
  const span = 1 - MODEL.runway_floor;
  if (days === null) return MODEL.runway_floor + span / 2;
  const d = Math.max(0, days);
  return MODEL.runway_floor + span * Math.min(1, Math.log(1 + d / 30) / Math.log(1 + MODEL.runway_full_days / 30));
}

export function value(p: SnapshotProtocol, fit: Fit, asOf: string): Valuation {
  const sector = sectorOf(p.category);
  const se = fit.sector[sector]!;
  const ce = fit.category[p.category ?? '(none)']?.effect ?? 0;
  const base = 10 ** (fit.a + fit.b * log10(p.tvl_usd));
  const excess = p.change_7d === null ? null : Math.max(-MODEL.momentum_cap, Math.min(MODEL.momentum_cap, p.change_7d - fit.market_change_7d));
  const momentum = excess === null ? 1 : (1 + excess / 100) ** MODEL.momentum_elasticity;
  const days = p.listed_at === null ? null : daysBetween(p.listed_at, asOf);
  const runway = runwayFactor(days);
  const implied = base * 10 ** se.effect * 10 ** ce * momentum * runway;
  const band = 10 ** (MODEL.band_z * se.sigma);
  return {
    base_usd: Math.round(base),
    sector_mult: 10 ** se.effect,
    category_mult: 10 ** ce,
    momentum_excess: excess,
    momentum_mult: momentum,
    runway_days: days,
    runway_mult: runway,
    implied_usd: Math.max(1, Math.round(implied)),
    low_usd: Math.max(1, Math.round(implied / band)),
    high_usd: Math.max(1, Math.round(implied * band)),
    multiple: implied / p.tvl_usd,
  };
}
