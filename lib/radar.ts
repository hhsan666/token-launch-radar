// The radar: sorts the snapshot into the ranked pre-token board, the protocols set aside as derivatives,
// and the trading peers, and writes the board rows the gate reads plus the page's data.

import { families, fitPeers, hasToken, median, MODEL, ruleExclusion, sectorOf, value, type Fit, type Snapshot, type SnapshotProtocol, type Valuation } from './model.ts';
import { farmPlan, stepText, type FarmStep } from './farm.ts';

/**
 * Where a ranked protocol comes from.
 *   watchlist      the house's own list (the floor every board covers)
 *   parent-listed  at or above the floor and passing the name and category rules, yet off the watchlist:
 *                  the only rule left is DefiLlama's parentProtocol, so the snapshot implies a parent
 *   early          below the floor, passing the same rules, with no sibling whose token trades
 */
export type Segment = 'watchlist' | 'parent-listed' | 'early';

export interface RankedRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  segment: Segment;
  sector: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  low_usd: number;
  high_usd: number;
  multiple: number;
  value: Valuation;
  plan: FarmStep[];
  flags: string[];
  siblings: string[];
}

export interface SetAside {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

export interface Radar {
  rows: RankedRow[];
  excluded: SetAside[];
  fit: Fit;
}

const usdShort = (n: number): string => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`);

function flagsFor(p: SnapshotProtocol, v: Valuation, fit: Fit, tokenSibling: string | null, segment: Segment): string[] {
  const f: string[] = [];
  if (tokenSibling !== null) f.push(`A protocol sharing its name, ${tokenSibling}, already trades: a token may already cover it.`);
  if (segment === 'parent-listed') f.push('DefiLlama files it under a parent protocol (the only watchlist rule it fails).');
  if (v.runway_days === null) f.push('No listing date in the snapshot: runway set to the midpoint.');
  else if (v.runway_days < 90) f.push(`Tracked for only ${v.runway_days} days: TVL may be points-driven.`);
  if (p.change_7d !== null && p.change_7d - fit.market_change_7d <= -10) f.push(`TVL fell ${(fit.market_change_7d - p.change_7d).toFixed(1)} points more than the market in the snapshot week.`);
  if (p.change_7d !== null && p.change_7d - fit.market_change_7d >= 15) f.push(`TVL grew ${(p.change_7d - fit.market_change_7d).toFixed(1)} points faster than the market in the snapshot week.`);
  if (p.chains.length === 1) f.push(`Single chain (${p.chains[0]}): its fate is tied to that chain.`);
  if (p.change_7d === null) f.push('No 7-day change reported: momentum left neutral.');
  return f;
}

export function buildRadar(snap: Snapshot): Radar {
  const fit = fitPeers(snap);
  const fam = families(snap.protocols);
  const watch = new Set(snap.watchlist);
  const candidates: { p: SnapshotProtocol; segment: Segment }[] = [];
  const excluded: SetAside[] = [];

  for (const p of snap.protocols) {
    if (hasToken(p)) continue;
    const f = fam.get(p.slug)!;
    if (watch.has(p.slug)) {
      candidates.push({ p, segment: 'watchlist' });
      continue;
    }
    const rule = ruleExclusion(p);
    if (rule !== null) {
      excluded.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: rule });
      continue;
    }
    if (f.token_sibling !== null) {
      excluded.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: `shares its name with ${f.token_sibling}, whose token trades: likely a product of it` });
      continue;
    }
    candidates.push({ p, segment: p.tvl_usd >= snap.floor_usd ? 'parent-listed' : 'early' });
  }

  const scored = candidates.map(({ p, segment }) => {
    const v = value(p, fit, snap.as_of);
    const sector = sectorOf(p.category);
    const plan = farmPlan(p, sector, v, fit.market_change_7d);
    const f = fam.get(p.slug)!;
    return { p, segment, v, sector, plan, flags: flagsFor(p, v, fit, f.token_sibling, segment), siblings: f.siblings };
  });
  // Rank by implied value, ties broken by slug so two runs write the same bytes.
  scored.sort((x, y) => y.v.implied_usd - x.v.implied_usd || (x.p.slug < y.p.slug ? -1 : 1));

  const rows: RankedRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.v.implied_usd,
    farm_steps: s.plan.map(stepText),
    segment: s.segment,
    sector: s.sector,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    low_usd: s.v.low_usd,
    high_usd: s.v.high_usd,
    multiple: s.v.multiple,
    value: s.v,
    plan: s.plan,
    flags: s.flags,
    siblings: s.siblings,
  }));
  excluded.sort((x, y) => y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : 1));
  return { rows, excluded, fit };
}

/** Why the gate would refuse this board, or null: the same checks the scorer states, run before writing. */
export function boardIssue(rows: RankedRow[], snap: Snapshot): string | null {
  const known = new Set(snap.protocols.map((p) => p.slug));
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows, not 100 to 4,000`;
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    if (!known.has(r.slug)) return `row ${i}: slug ${r.slug} is not in the snapshot`;
    if (seen.has(r.slug)) return `row ${i}: slug ${r.slug} twice`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `row ${i}: rank ${r.rank}, expected ${i + 1}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) return `row ${i}: implied value ${r.implied_value_usd}`;
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i}: value rises with rank`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${i}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `row ${i}: a farm step of ${s.trim().length} characters`;
  }
  for (const w of snap.watchlist) if (!seen.has(w)) return `watchlist slug ${w} missing`;
  if (new Set(rows.map((r) => r.implied_value_usd)).size < 2) return 'every implied value is the same';
  return null;
}

/** The board the gate reads: its five required keys first, then the model's own columns. */
export function boardJson(r: Radar, snap: Snapshot): string {
  const rows = r.rows.map((x) => ({
    rank: x.rank,
    slug: x.slug,
    name: x.name,
    implied_value_usd: x.implied_value_usd,
    farm_steps: x.farm_steps,
    segment: x.segment,
    sector: x.sector,
    category: x.category,
    tvl_usd: x.tvl_usd,
    change_7d: x.change_7d,
    implied_low_usd: x.low_usd,
    implied_high_usd: x.high_usd,
    value_per_tvl_dollar: Number(x.multiple.toFixed(4)),
  }));
  return `${JSON.stringify({ model: MODEL.version, as_of: snap.as_of, source: snap.source, rows }, null, 1)}\n`;
}

const round = (x: number, d: number): number => Number(x.toFixed(d));

/** The page's data, as one script that sets window.RADAR: compact keys, every number rounded. */
export function dataScript(r: Radar, snap: Snapshot): string {
  const f = r.fit;
  const tokens = snap.protocols.filter(hasToken);
  const data = {
    as_of: snap.as_of,
    source: snap.source,
    floor: snap.floor_usd,
    counts: { protocols: snap.protocols.length, with_token: tokens.length, pre_token: snap.protocols.length - tokens.length, watchlist: snap.watchlist.length, ranked: r.rows.length, set_aside: r.excluded.length, peers: f.n },
    model: {
      ...MODEL,
      a: round(f.a, 4),
      b: round(f.b, 4),
      r2: round(f.r2, 3),
      sigma: round(f.sigma, 3),
      market_change_7d: round(f.market_change_7d, 2),
      tested: { chains: round(f.tested.chains_slope, 3), age: round(f.tested.age_slope, 3), momentum: round(f.tested.momentum_slope, 4) },
      sectors: Object.fromEntries(Object.entries(f.sector).map(([k, s]) => [k, { n: s.n, x: round(10 ** s.effect, 3), sd: round(s.sigma, 3) }])),
      categories: Object.fromEntries(Object.entries(f.category).map(([k, c]) => [k, { n: c.n, x: round(10 ** c.effect, 3) }])),
    },
    rows: r.rows.map((x) => ({
      r: x.rank,
      s: x.slug,
      n: x.name,
      seg: x.segment,
      sec: x.sector,
      cat: x.category,
      ch: x.chains,
      tvl: x.tvl_usd,
      d7: x.change_7d,
      lis: x.listed_at,
      v: x.implied_value_usd,
      lo: x.low_usd,
      hi: x.high_usd,
      m: round(x.multiple, 4),
      base: x.value.base_usd,
      xs: round(x.value.sector_mult, 3),
      xc: round(x.value.category_mult, 3),
      ex: x.value.momentum_excess === null ? null : round(x.value.momentum_excess, 2),
      xm: round(x.value.momentum_mult, 3),
      days: x.value.runway_days,
      xr: round(x.value.runway_mult, 3),
      fl: x.flags,
      sib: x.siblings,
      plan: x.plan.map((s) => [s.do, s.cost, s.time]),
    })),
    peers: f.peers
      .slice()
      .sort((x, y) => y.mcap_usd - x.mcap_usd)
      .map((p) => ({ s: p.slug, n: p.name, sym: p.symbol, cat: p.category, sec: p.sector, tvl: p.tvl_usd, mc: p.mcap_usd, m: round(10 ** p.multiple, 3), res: round(p.residual, 3) })),
    excluded: r.excluded.map((e) => ({ s: e.slug, n: e.name, cat: e.category, tvl: e.tvl_usd, why: e.reason })),
  };
  return `// Launch Radar data, written by main.ts from the sealed snapshot (${snap.as_of}). ${usdShort(r.rows.reduce((t, x) => t + x.implied_value_usd, 0))} implied across ${r.rows.length} rows.\nwindow.RADAR = ${JSON.stringify(data)};\n`;
}

export { median };
