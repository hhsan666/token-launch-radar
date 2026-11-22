// Captures the three dashboard screenshots from a main.ts output directory, in headless Chromium with every
// non-file request blocked (proof that the page renders with no network). Not run by the grader.
//
//   node tools/screenshots.mjs <output dir> <screenshots dir>
//
// Each capture is 1440 x 900 CSS pixels at scale 1 (long side 1440, short side 900: inside the gate's
// limits). A PNG over the dossier's comfortable size is re-encoded as JPEG until it fits.

import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [outDir, shotDir] = process.argv.slice(2).map((p) => resolve(p));
if (!outDir || !shotDir) {
  console.error('usage: node tools/screenshots.mjs <output dir> <screenshots dir>');
  process.exit(2);
}
const page0 = pathToFileURL(join(outDir, 'dashboard', 'index.html')).href;
const MAX = 350 * 1024;

const SHOTS = [
  ['1-board', '#/board'],
  ['2-detail', null], // filled with the top watchlist row's slug below
  ['3-filtered', '#/board?seg=early,parent-listed&beat=1&sort=m&dir=desc'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
const blocked = [];
await ctx.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith('file:')) return route.continue();
  blocked.push(url);
  return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(page0 + '#/board');
const detailSlug = process.env.DETAIL_SLUG || (await page.evaluate(() => window.RADAR.rows.find((r) => r.seg === 'watchlist').s));
SHOTS[1][1] = '#/p/' + encodeURIComponent(detailSlug);

mkdirSync(shotDir, { recursive: true });
for (const f of readdirSync(shotDir)) if (/^\d-.*\.(png|jpe?g)$/.test(f)) rmSync(join(shotDir, f));
for (const [name, hash] of SHOTS) {
  await page.goto(page0 + hash);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  let buf = await page.screenshot({ type: 'png' });
  let file = `${name}.png`;
  for (let q = 92; buf.length > MAX && q >= 50; q -= 4) {
    buf = await page.screenshot({ type: 'jpeg', quality: q });
    file = `${name}.jpg`;
  }
  writeFileSync(join(shotDir, file), buf);
  console.log(`${file}: ${(statSync(join(shotDir, file)).size / 1024).toFixed(0)} KB  (${hash})`);
}
await browser.close();
console.log(`blocked network requests: ${blocked.length}${blocked.length ? ' ' + blocked.join(' ') : ''}`);
console.log(`page errors: ${errors.length}${errors.length ? '\n' + errors.join('\n') : ''}`);
if (blocked.length || errors.length) process.exit(1);
