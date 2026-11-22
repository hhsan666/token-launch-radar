// Launch Radar: a token-radar-01 entry (Node 22, standard library only, no network).
//
// The model lives in dashboard/engine.js, one plain-JavaScript file that this program and the page both
// run: main.ts imports it to write the ranked board, and the page runs it on the same snapshot, so what
// the screenshots show is what the board says. It writes to /output:
//   board.json    the ranked board the gate reads (every watchlist slug, ranks 1..N by implied value)
//   data.js       the sealed snapshot as a script beside the page (dashboard/index.html loads ../data.js)
//   dashboard/    this repository's static page, copied as is
//   screenshots/  the three captures of that page
//   dossier.json  what the judge reads, written last by vendor/makefun-board.ts
//
// Outside the grader: MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import engine from './dashboard/engine.js';
import { buildDossier } from './vendor/makefun-board.ts';

interface Protocol {
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
interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}
interface Row {
  rank: number;
  slug: string;
  name: string;
  segment: string;
  sector: string;
  category: string | null;
  tvl: number;
  change7d: number | null;
  implied: number;
  low: number;
  high: number;
  perTvl: number;
  plan: { do: string; cost: string; time: string; min: number; tx: number; weekly: number }[];
}

const here = fileURLToPath(new URL('.', import.meta.url));
const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
function fail(msg: string): never {
  process.stderr.write(`launch radar: ${msg}\n`);
  process.exit(1);
}

const inputArg = arg('input') ?? process.env.MAKEFUN_INPUT_DIR ?? '/input';
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}`);
const out = arg('output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const snapText = readFileSync(inputFile, 'utf8');
const snap = JSON.parse(snapText) as Snapshot;
if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) fail('snapshot has no protocols or watchlist array');

const radar = engine.build(snap) as { rows: Row[]; excluded: unknown[]; fit: { n: number; b: number } };
const board = radar.rows.map((r) => ({
  rank: r.rank,
  slug: r.slug,
  name: r.name,
  implied_value_usd: r.implied,
  farm_steps: r.plan.map(engine.stepText) as string[],
  segment: r.segment,
  sector: r.sector,
  category: r.category,
  tvl_usd: r.tvl,
  change_7d: r.change7d,
  implied_low_usd: r.low,
  implied_high_usd: r.high,
  value_per_tvl_dollar: Number(r.perTvl.toFixed(4)),
  farm_setup_minutes: engine.planTotals(r.plan).min as number,
  farm_setup_transactions: engine.planTotals(r.plan).tx as number,
  farm_weekly_minutes: engine.planTotals(r.plan).weekly as number,
}));

/** The gate's board checks, run before anything is written: a refused board never leaves this program. */
function boardIssue(): string | null {
  const known = new Set(snap.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  if (board.length < 100 || board.length > 4000) return `${board.length} rows, not 100 to 4,000`;
  for (const [i, r] of board.entries()) {
    if (!known.has(r.slug) || seen.has(r.slug)) return `row ${i}: slug ${r.slug} unknown or repeated`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `row ${i}: rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) return `row ${i}: value ${r.implied_value_usd}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i}: value rises with rank`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${i}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `row ${i}: a ${s.trim().length}-character step`;
  }
  for (const w of snap.watchlist) if (!seen.has(w)) return `watchlist slug ${w} missing`;
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2) return 'every implied value is the same';
  return null;
}
const issue = boardIssue();
if (issue !== null) fail(`board refused before writing: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: engine.MODEL.version, as_of: snap.as_of, source: snap.source, rows: board }, null, 1)}\n`);
writeFileSync(join(out, 'data.js'), `// The sealed snapshot the page runs engine.js on (${snap.as_of}), unchanged.\nwindow.SNAPSHOT = ${snapText.trim()};\n`);

/** Copy a directory's regular files (dot-names skipped), recursively, in name order. */
function copyTree(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let n = 0;
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const st = statSync(src);
    if (st.isDirectory()) n += copyTree(src, join(to, name));
    else if (st.isFile()) {
      copyFileSync(src, join(to, name));
      n++;
    }
  }
  return n;
}
if (copyTree(join(here, 'dashboard'), join(out, 'dashboard')) === 0) fail('dashboard/ is empty');
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots < 3) fail(`screenshots/ holds ${shots} images: the board, a detail view and a filtered view are needed`);

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const counts: Record<string, number> = {};
for (const r of radar.rows) counts[r.segment] = (counts[r.segment] ?? 0) + 1;
process.stdout.write(
  `launch radar: ${snap.protocols.length} protocols, ${radar.fit.n} trading peers (size slope ${radar.fit.b.toFixed(3)}), ${radar.rows.length} ranked (` +
    `${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}), ${radar.excluded.length} set aside\n`,
);
