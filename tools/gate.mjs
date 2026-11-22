// Re-checks an output directory against the seven gate rows RULES.txt states (dashboard_files, board_file,
// sorted_by_value, coverage, farm_steps, screenshots, dossier_matches). Not run by the grader.
//
//   node tools/gate.mjs <output dir> <snapshot.json>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const [out, snapPath] = process.argv.slice(2);
const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
const results = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    results.push([name, detail === true ? 'ok' : detail]);
  } catch (e) {
    results.push([name, `FAIL ${e.message}`]);
  }
};
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

function walk(dir) {
  const files = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      must(!e.name.startsWith('.'), `dot-directory ${p}`);
      files.push(...walk(p));
    } else files.push(p);
  }
  return files;
}

check('dashboard_files', () => {
  const root = join(out, 'dashboard');
  const files = walk(root);
  const rel = files.map((f) => relative(root, f));
  must(rel.includes('index.html'), 'no index.html');
  must(rel.some((f) => f.endsWith('.css')) && rel.some((f) => f.endsWith('.js')), 'no .css or .js');
  must(files.length <= 400, `${files.length} files`);
  const bytes = files.reduce((t, f) => t + statSync(f).size, 0);
  must(bytes <= 4 * 1024 * 1024, `${bytes} bytes`);
  for (const f of files) {
    const name = f.split('/').pop();
    must(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(name), `bad name ${name}`);
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('.html')) {
      for (const m of text.matchAll(/\s[\w:-]+\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) must(!/https?:\/\//i.test(m[1]), `URL in an attribute of ${name}: ${m[1].slice(0, 60)}`);
      for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) must(!/https?:\/\//i.test(m[1]), `URL in a <style> of ${name}`);
      for (const m of text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) must(!/(import|from)\s*\(?\s*["']https?:/i.test(m[1]), `URL import in a <script> of ${name}`);
    }
    if (f.endsWith('.css')) must(!/https?:\/\//i.test(text), `URL in ${name}`);
    if (f.endsWith('.js') || f.endsWith('.mjs')) must(!/(import|from|require)\s*\(?\s*["'`]https?:/i.test(text), `URL import in ${name}`);
  }
  return `ok (${files.length} files, ${bytes} bytes)`;
});

const raw = readFileSync(join(out, 'board.json'));
const board = JSON.parse(raw.toString('utf8'));
const rows = Array.isArray(board) ? board : board.rows;
const known = new Set(snap.protocols.map((p) => p.slug));

check('board_file', () => {
  must(raw.length <= 8 * 1024 * 1024, `${raw.length} bytes`);
  must(Array.isArray(rows) && rows.length >= 100 && rows.length <= 4000, `${rows?.length} rows`);
  const seen = new Set();
  for (const r of rows) {
    must(typeof r.slug === 'string' && r.slug.length >= 1 && r.slug.length <= 128 && !/\s/.test(r.slug), `slug ${r.slug}`);
    must(known.has(r.slug), `invented slug ${r.slug}`);
    must(!seen.has(r.slug), `duplicate slug ${r.slug}`);
    seen.add(r.slug);
    must(typeof r.name === 'string' && r.name.length > 0, `name of ${r.slug}`);
    must(Number.isSafeInteger(r.rank) && r.rank > 0, `rank of ${r.slug}`);
    must(Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0 && r.implied_value_usd <= 1e14, `value of ${r.slug}`);
    must(Array.isArray(r.farm_steps), `farm_steps of ${r.slug}`);
  }
  must(new Set(rows.map((r) => r.implied_value_usd)).size > 1, 'all values equal');
  return `ok (${rows.length} rows, ${raw.length} bytes)`;
});

check('sorted_by_value', () => {
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  byRank.forEach((r, i) => must(r.rank === i + 1, `rank ${r.rank} at ${i + 1}`));
  for (let i = 1; i < byRank.length; i++) must(byRank[i].implied_value_usd <= byRank[i - 1].implied_value_usd, `value rises at rank ${i + 1}`);
  return true;
});

check('coverage', () => {
  const have = new Set(rows.map((r) => r.slug));
  const missing = snap.watchlist.filter((w) => !have.has(w));
  must(missing.length === 0, `missing ${missing.join(', ')}`);
  return `ok (${snap.watchlist.length}/${snap.watchlist.length})`;
});

check('farm_steps', () => {
  let min = 99, max = 0, shortest = 999, longest = 0;
  for (const r of rows) {
    must(r.farm_steps.length >= 3 && r.farm_steps.length <= 12, `${r.slug}: ${r.farm_steps.length} steps`);
    min = Math.min(min, r.farm_steps.length);
    max = Math.max(max, r.farm_steps.length);
    for (const s of r.farm_steps) {
      const n = String(s).trim().length;
      must(typeof s === 'string' && n >= 20 && n <= 600, `${r.slug}: a step of ${n} chars`);
      shortest = Math.min(shortest, n);
      longest = Math.max(longest, n);
    }
  }
  return `ok (${min}-${max} steps a row, ${shortest}-${longest} chars a step)`;
});

function dims(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  throw new Error('not a PNG or JPEG');
}

check('screenshots', () => {
  const dir = join(out, 'screenshots');
  const names = readdirSync(dir).filter((n) => !n.startsWith('.'));
  must(names.length >= 3 && names.length <= 4, `${names.length} images`);
  const info = names.map((n) => {
    const buf = readFileSync(join(dir, n));
    must(buf.length <= 512 * 1024, `${n} is ${buf.length} bytes`);
    const [w, h] = dims(buf);
    must(Math.max(w, h) <= 1440 && Math.min(w, h) >= 800, `${n} is ${w}x${h}`);
    return `${n} ${w}x${h} ${Math.round(buf.length / 1024)}KB`;
  });
  return `ok (${info.join('; ')})`;
});

check('dossier_matches', () => {
  const want = Buffer.from(buildDossier(out, { text_max_bytes: 65536 }));
  const have = readFileSync(join(out, 'dossier.json'));
  must(Buffer.compare(want, have) === 0, 'dossier.json differs from buildDossier');
  must(have.length <= 1.5 * 1024 * 1024, `${have.length} bytes`);
  const text = JSON.parse(have.toString('utf8')).text;
  return `ok (${have.length} bytes; text ${Buffer.byteLength(text)} bytes${/\[Cut at/.test(text) ? ', CUT' : ', whole'})`;
});

let bad = 0;
for (const [name, res] of results) {
  console.log(`${name.padEnd(16)} ${res}`);
  if (String(res).startsWith('FAIL')) bad++;
}
process.exit(bad ? 1 : 0);
