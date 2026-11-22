// Launch Radar: a token-radar-01 entry (Node 22, standard library only, no network).
//
// Reads the sealed snapshot (/input/snapshot.json), values every protocol whose DefiLlama record carries
// no token with the peer-curve model in lib/model.ts, and writes to /output:
//   board.json    the ranked board the gate reads (watchlist covered, ranks 1..N by implied value)
//   data.js       the dashboard's data, beside the page (dashboard/index.html loads ../data.js)
//   dashboard/    this repository's static page, copied as is
//   screenshots/  the three captures of that page
//   dossier.json  what the judge reads, written last by vendor/makefun-board.ts
//
// Outside the grader: MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Snapshot } from './lib/model.ts';
import { boardIssue, boardJson, buildRadar, dataScript } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function fail(msg: string): never {
  process.stderr.write(`launch radar: ${msg}\n`);
  process.exit(1);
}

const inputArg = arg('input') ?? process.env.MAKEFUN_INPUT_DIR ?? '/input';
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}`);
const out = arg('output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snap = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) fail('snapshot has no protocols or watchlist array');

const radar = buildRadar(snap);
const issue = boardIssue(radar.rows, snap);
if (issue !== null) fail(`board refused before writing: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), boardJson(radar, snap));
writeFileSync(join(out, 'data.js'), dataScript(radar, snap));

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

const pageFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
if (pageFiles === 0) fail('dashboard/ is empty');
if (shots < 3) fail(`screenshots/ holds ${shots} images: the board, a detail view and a filtered view are needed`);

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const counts = radar.rows.reduce((c, r) => ({ ...c, [r.segment]: (c[r.segment] ?? 0) + 1 }), {} as Record<string, number>);
process.stdout.write(
  `launch radar: ${snap.protocols.length} protocols, ${radar.fit.n} trading peers (size slope ${radar.fit.b.toFixed(3)}), ` +
    `${radar.rows.length} ranked (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}), ${radar.excluded.length} set aside\n`,
);
