// Launch Radar engine: the one model both main.ts (Node) and this page run. main.ts imports this file to
// write board.json; the page runs it on the same sealed snapshot (data.js), so every number on screen is
// computed here, from the snapshot's own fields. No protocol name is special-cased.
//
//   implied = 10^(a + b·log10 TVL) × sector × category × momentum × runway
//
//   size curve  least squares of log market cap on log TVL over the protocols whose token trades
//   sector      the peers' mean residual in the sector, shrunk by n/(n+shrink); category likewise inside it
//   momentum    (1 + excess/100)^elasticity, excess = 7d TVL change − the snapshot's median, capped
//   runway      days tracked with no token: floor → 1 on a log curve by full_days (unknown: midpoint)
//   band        ± band_z σ of the sector's residuals: where the middle half of same-size peers sit
(function (root) {
  'use strict';

  const MODEL = { version: 'peer-curve-2', shrink: 4, momentum_cap: 30, momentum_elasticity: 0.5, runway_floor: 0.7, runway_full_days: 730, band_z: 0.674 };

  // DefiLlama categories grouped into sectors whose peers price alike.
  const SECTORS = {
    'Vaults & curation': ['Risk Curators', 'Onchain Capital Allocator', 'Yield', 'Yield Aggregator', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Options Vault', 'Indexes'],
    'Yield dollars': ['Basis Trading', 'Stablecoin Wrapper', 'CDP', 'CDP Manager', 'Dual-Token Stablecoin', 'Algo-Stables', 'Stablecoin Issuer', 'Reserve Currency'],
    'Lending & credit': ['Lending', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management', 'Interest Rate Derivatives'],
    Trading: ['Dexs', 'Derivatives', 'Options', 'Synthetics', 'Prediction Market', 'OTC Marketplace', 'NFT Marketplace', 'Launchpad'],
    'Real-world assets': ['RWA'],
    'Staking & BTC': ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Restaked BTC', 'Staking Pool', 'Anchor BTC', 'Decentralized BTC'],
    'Chains & infra': ['Chain', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Payments', 'Privacy', 'Crypto Card Issuer', 'Token Locker', 'DOR', 'AI Agents', 'Decentralized AI', 'Governance Incentives', 'Insurance', 'CeDeFi', 'CEX'],
  };
  const SECTOR_OF = new Map();
  for (const s of Object.keys(SECTORS)) for (const c of SECTORS[s]) SECTOR_OF.set(c, s);
  const sectorOf = (cat) => (cat !== null && SECTOR_OF.get(cat)) || 'Other';
  const hasToken = (p) => p.gecko_id !== null || p.symbol !== null;

  // ---------------------------------------------------------------- what is not a launch of its own
  // The house watchlist rule restated (its parentProtocol test is the one the snapshot cannot show).
  const RULE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
  function ruleExclusion(p) {
    if (p.category !== null && RULE_CATEGORIES.has(p.category)) return `category ${p.category}: a wrapped, staked or bridged product, or an exchange`;
    if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return 'name ends in a version marker: a later version of an existing protocol';
    if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'name says wrapped, staked or staking: a product of an underlying asset';
    if (/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/.test(p.name)) return "name begins with an exchange's name";
    return null;
  }

  // Families: protocols sharing a first name word or first slug segment are one family. A pre-token
  // protocol whose family holds a trading token is treated as that token's product.
  const GENERIC = new Set('the defi finance protocol capital labs network money stable liquid staked wrapped usd bitcoin btc eth sol open smart super meta yield earn vault vaults swap lend bridge base core prime one pro'.split(' '));
  function familyKeys(p) {
    const word = p.name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const seg = p.slug.split('-')[0].toLowerCase();
    return [...new Set([word, seg])].filter((k) => k.length >= 3 && !GENERIC.has(k));
  }
  function families(protocols) {
    const byKey = new Map();
    for (const p of protocols) for (const k of familyKeys(p)) (byKey.get(k) || byKey.set(k, []).get(k)).push(p);
    const out = new Map();
    for (const p of protocols) {
      const sib = new Map();
      for (const k of familyKeys(p)) for (const q of byKey.get(k)) if (q.slug !== p.slug) sib.set(q.slug, q);
      const list = [...sib.values()].sort((x, y) => (x.slug < y.slug ? -1 : 1));
      const tok = list.find(hasToken);
      out.set(p.slug, { siblings: list.map((s) => s.slug), tokenSibling: tok ? tok.name + (tok.symbol ? ` (${tok.symbol})` : '') : null });
    }
    return out;
  }

  // ---------------------------------------------------------------- the peer fit
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
  function median(xs) {
    const b = [...xs].sort((x, y) => x - y);
    const n = b.length;
    return n === 0 ? 0 : n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
  }
  function ols(xs, ys) {
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    const b = sxx ? sxy / sxx : 0;
    return { a: my - b * mx, b, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
  }
  const days = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);

  function fitPeers(snap, M) {
    const raw = snap.protocols.filter((p) => hasToken(p) && p.mcap_usd > 0 && p.tvl_usd > 0);
    const xs = raw.map((p) => Math.log10(p.tvl_usd));
    const ys = raw.map((p) => Math.log10(p.mcap_usd));
    const { a, b, r2 } = ols(xs, ys);
    const peers = raw.map((p, i) => ({ slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, sector: sectorOf(p.category), tvl: p.tvl_usd, mcap: p.mcap_usd, multiple: p.mcap_usd / p.tvl_usd, residual: ys[i] - (a + b * xs[i]) }));
    const sigma = Math.sqrt(mean(peers.map((p) => p.residual ** 2)));
    const sector = {};
    for (const s of [...Object.keys(SECTORS), 'Other']) {
      const rs = peers.filter((p) => p.sector === s).map((p) => p.residual);
      const sd = rs.length >= 3 ? Math.sqrt(mean(rs.map((r) => (r - mean(rs)) ** 2))) : sigma;
      // A sector's band never claims more certainty than half the pooled spread.
      sector[s] = { n: rs.length, effect: rs.reduce((t, r) => t + r, 0) / (rs.length + M.shrink), sigma: Math.max(sd, sigma / 2) };
    }
    const category = {};
    for (const p of peers) {
      const c = (category[p.category || '(none)'] ||= { n: 0, sum: 0 });
      c.n++;
      c.sum += p.residual - sector[p.sector].effect;
    }
    for (const c of Object.values(category)) c.effect = c.sum / (c.n + M.shrink);
    const market = median(snap.protocols.filter((p) => p.change_7d !== null).map((p) => p.change_7d));
    // Factors tested on the residuals and reported; chain count is left out because it explains nothing.
    const res = peers.map((p) => p.residual);
    const aged = raw.map((p, i) => [p, res[i]]).filter(([p]) => p.listed_at !== null);
    const moved = raw.map((p, i) => [p, res[i]]).filter(([p]) => p.change_7d !== null);
    const tested = {
      chains: ols(raw.map((p) => Math.log10(Math.max(1, p.chains.length))), res).b,
      age: ols(aged.map(([p]) => Math.log10(1 + days(p.listed_at, snap.as_of))), aged.map((x) => x[1])).b,
      momentum: ols(moved.map(([p]) => p.change_7d - market), moved.map((x) => x[1])).b,
    };
    return { n: peers.length, a, b, r2, sigma, market, sector, category, tested, peers };
  }

  // ---------------------------------------------------------------- one protocol's value
  function runwayFactor(d, M) {
    const span = 1 - M.runway_floor;
    if (d === null) return M.runway_floor + span / 2;
    return M.runway_floor + span * Math.min(1, Math.log(1 + Math.max(0, d) / 30) / Math.log(1 + M.runway_full_days / 30));
  }
  function value(p, fit, asOf, M) {
    const se = fit.sector[sectorOf(p.category)];
    const ce = (fit.category[p.category || '(none)'] || { effect: 0 }).effect;
    const base = 10 ** (fit.a + fit.b * Math.log10(p.tvl_usd));
    const excess = p.change_7d === null ? null : Math.max(-M.momentum_cap, Math.min(M.momentum_cap, p.change_7d - fit.market));
    const momentumX = excess === null ? 1 : (1 + excess / 100) ** M.momentum_elasticity;
    const runwayDays = p.listed_at === null ? null : days(p.listed_at, asOf);
    const runwayX = runwayFactor(runwayDays, M);
    const implied = base * 10 ** se.effect * 10 ** ce * momentumX * runwayX;
    const band = 10 ** (M.band_z * se.sigma);
    return {
      base, sectorX: 10 ** se.effect, categoryX: 10 ** ce, excess, momentumX, runwayDays, runwayX,
      implied: Math.max(1, Math.round(implied)), low: Math.max(1, Math.round(implied / band)), high: Math.max(1, Math.round(implied * band)), perTvl: implied / p.tvl_usd,
    };
  }

  // ---------------------------------------------------------------- farm plans
  // Steps from the snapshot's facts (chains, TVL, 7d change, runway, sector) and general on-chain practice
  // only: no URL, date or figure the snapshot does not carry. Each step names its cost and its time.
  const usd = (n) => (n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(0) + 'K' : '$' + Math.round(n));
  const pct = (x) => x.toFixed(Math.max(2, 1 - Math.floor(Math.log10(x)))) + '%';
  const gas = (c) => (c === 'Ethereum' ? 'Ethereum mainnet gas (the costliest tier)' : c === 'Bitcoin' ? 'a Bitcoin on-chain fee (varies with mempool load)' : `${c} gas (a low-fee chain)`);
  // Each step also carries its numbers: minutes to do once, on-chain transactions, minutes a week after.
  const step = (d, cost, time, min = 0, tx = 0, weekly = 0) => ({ do: d, cost, time, min, tx, weekly });
  const planTotals = (plan) => plan.reduce((t, s) => ({ min: t.min + s.min, tx: t.tx + s.tx, weekly: t.weekly + s.weekly }), { min: 0, tx: 0, weekly: 0 });

  function coreSteps(p, sector, ch) {
    const g = gas(ch), n = p.name;
    switch (sector) {
      case 'Vaults & curation': return [
        step(`Pick one ${n} vault on ${ch} whose deposit asset you already hold (a stablecoin or ETH-type asset). Read its strategy page: which markets it allocates to, its fee, and whether withdrawals are instant or queued.`, 'free (reading)', '~15 min', 15, 0, 0),
        step('Deposit into that vault: approve the asset, then deposit. Start with a test amount, withdraw it once to confirm the exit path works, then deposit the size you chose.', `${g}: 2 transactions to enter, 1 to test the exit`, '~10 min', 10, 3, 0),
        step('Check the vault\'s allocation weekly: a curator moves deposits between markets, so the risk you hold changes without a transaction of yours.', 'free', '~5 min a week', 0, 0, 5)];
      case 'Yield dollars': return [
        step(`Get the stablecoin ${n} accepts for minting or depositing on ${ch} (its docs list them) and read how redemption works: instant, queued or with a cooldown.`, `a swap fee if you must convert, plus ${g}`, '~15 min', 15, 1, 0),
        step(`Mint or deposit into ${n}'s yield-bearing dollar with a test amount, redeem it back once, then deposit your chosen size and keep the receipt token in the same wallet.`, `${g}: about 4 transactions (approve, mint, redeem test, mint)`, '~20 min', 20, 4, 0),
        step('If the app lists integrations (lending markets or pools that accept its dollar), use at most one, and only after reading that integration\'s own risk notes.', `${g} per integration step`, '~15 min', 15, 1, 0)];
      case 'Lending & credit': return [
        step(`Supply a major asset (a stablecoin or ETH-type asset) to ${n} on ${ch}. Supplying alone carries no liquidation risk on your side; check the market's utilisation before you size it.`, `${g}: approve + supply`, '~10 min', 10, 2, 0),
        step('Optionally borrow a small amount against it and keep the loan-to-value far below the liquidation threshold the app shows (a quarter of it is a cautious level). Lending point schemes often count both sides, but a borrow can be liquidated.', `${g}: 1 borrow; interest on the loan`, '~5 min, then a daily glance', 5, 1, 0),
        step('Set a price alert on your collateral, or skip borrowing entirely if you cannot watch it.', 'free', '~5 min', 5, 0, 0)];
      case 'Trading': return [
        step(`Fund ${n} on ${ch} with a small trading balance. If it is an exchange of pools, add liquidity to its deepest major pair instead of trading: fees accrue to you while you hold the position.`, `${g}: deposit or add-liquidity transactions; impermanent loss on a pool`, '~15 min', 15, 2, 0),
        step('If you trade, keep leverage at 2x or less and trade only pairs you would trade anyway: volume-based points rarely pay for fees and slippage on forced trades.', 'trading fees and slippage on each trade', 'a few trades a week', 0, 0, 15),
        step('Keep a fee log (date, size, fee) so you can compare what farming costs with anything it later earns.', 'free', '~5 min a week', 0, 0, 5)];
      case 'Real-world assets': return [
        step(`Check eligibility first: real-world-asset products often require identity checks (KYC), a jurisdiction list and a minimum ticket. Read ${n}'s terms before moving funds.`, 'free; your identity documents if KYC applies', '~30 min, plus any review time', 30, 0, 0),
        step(`Subscribe with a test amount on ${ch}, note the redemption schedule (daily, weekly or monthly windows are common), then subscribe your chosen size.`, `${g}; any subscription fee the terms state`, '~20 min', 20, 2, 0),
        step('Diarise the next redemption window: capital in an RWA product can be slower to exit than a DeFi pool.', 'free', '~5 min', 5, 0, 0)];
      case 'Staking & BTC': return [
        step(`Stake or deposit the asset ${n} supports on ${ch}. Read the unbonding or withdrawal delay before you deposit: it is how long your capital is locked when you want out.`, `${g}: approve + stake`, '~10 min, plus the unbonding delay to exit', 10, 2, 0),
        step('Keep the receipt token in the same wallet; moving it elsewhere can drop you from any points tracking.', 'free', '~2 min', 2, 0, 0)];
      case 'Chains & infra': return [
        step(`Bridge a small balance to ${ch} through the official bridge its docs name, and keep enough of the native gas token for a few weeks of activity.`, `bridge fee plus ${g}`, '~20 min (bridges can take longer to settle)', 20, 1, 0),
        step(`Use ${n} for what it is built for (payments, transfers or the apps on it), spread over several weeks rather than one burst: networks tend to look at sustained use, not a single day.`, `${g} per transaction`, '~10 min a week', 0, 0, 10)];
      default: return [
        step(`Read ${n}'s documentation to find its core action (deposit, stake, trade or use), do it once with a test amount on ${ch}, and exit once to prove the way out.`, `${g}: about 3 transactions`, '~20 min', 20, 3, 0),
        step('Repeat the core action with your chosen size and keep the position in one wallet.', g, '~10 min', 10, 1, 0)];
    }
  }

  function farmPlan(p, sector, v, market) {
    const ch = p.chains.find((c) => c !== 'Ethereum' && c !== 'Bitcoin') || p.chains[0] || 'its home chain';
    const list = p.chains.length > 3 ? `${p.chains.slice(0, 3).join(', ')} and ${p.chains.length - 3} more` : p.chains.join(', ');
    const d7 = p.change_7d === null ? 'by an unreported amount' : (p.change_7d >= 0 ? '+' : '') + p.change_7d.toFixed(1) + '%';
    const plan = [
      step(`Find ${p.name}'s official app through its DefiLlama listing (slug ${p.slug}) and confirm the domain on the team's own announcement channel before connecting a wallet. Never follow links from replies or DMs.`, 'free', '~10 min', 10, 0, 0),
      step(`Use a dedicated wallet that holds only what you plan to deposit. ${p.name} is listed on ${list}; start on ${ch}${p.chains.length > 1 ? ' unless the product you want lives only elsewhere' : ''}.`, `${p.chains.length > 1 ? 'one transfer or bridge' : 'one transfer'} to ${ch} plus ${gas(ch)}`, '~10 min', 10, 1, 0),
      step(`Size the position from the snapshot: TVL is ${usd(p.tvl_usd)}, so $1,000 is ${pct((1e3 / p.tvl_usd) * 100)} of the pool and $10,000 is ${pct((1e4 / p.tvl_usd) * 100)}. Choose an amount you can afford to lose entirely.`, 'free (arithmetic)', '~5 min', 5, 0, 0),
      ...coreSteps(p, sector, ch),
      step(`Log every deposit (date, amount, transaction hash) and check the app for a points or rewards page. Hold for weeks, not days: programs that reward deposits usually weight time as well as size.`, `opportunity cost of the capital while it sits in ${p.name}`, '~5 min a week, for 4 weeks or more', 0, 0, 5),
      step(`Set an exit rule now: its TVL moved ${d7} in the snapshot week against a market median of ${market.toFixed(1)}%. Withdraw if TVL falls sharply in a week, the terms change, or an exploit is reported.`, `${gas(ch)} for the withdrawal`, '~5 min', 5, 0, 0),
      step('If a token is ever announced, claim only through the official app, read every signature request, and decide your sell-or-hold rule before claiming. Nothing here says a token will launch.', `${gas(ch)} for the claim`, '~10 min', 0, 0, 0),
    ];
    if (v.runwayDays !== null && v.runwayDays < 120)
      plan.splice(3, 0, step(`Its DefiLlama record is ${v.runwayDays} days old: young TVL can leave as fast as it came. Start smaller than on an older protocol and add only after a few weeks of stable TVL.`, 'free', 'decide now; revisit in 2 to 4 weeks', 0, 0, 0));
    return plan;
  }
  const stepText = (s) => `${s.do} Cost: ${s.cost}. Time: ${s.time}.`.slice(0, 600).trim();

  // ---------------------------------------------------------------- the board
  function flagsFor(p, v, fit, tokenSibling, segment) {
    const f = [];
    const ex = p.change_7d === null ? null : p.change_7d - fit.market;
    if (tokenSibling) f.push(`A protocol sharing its name, ${tokenSibling}, already trades: a token may already cover it.`);
    if (segment === 'parent-listed') f.push('DefiLlama files it under a parent protocol (the only watchlist rule it fails).');
    if (v.runwayDays === null) f.push('No listing date in the snapshot: runway set to the midpoint.');
    else if (v.runwayDays < 90) f.push(`Tracked for only ${v.runwayDays} days: TVL may be points-driven.`);
    if (ex !== null && ex <= -10) f.push(`TVL fell ${(-ex).toFixed(1)} points more than the market in the snapshot week.`);
    if (ex !== null && ex >= 15) f.push(`TVL grew ${ex.toFixed(1)} points faster than the market in the snapshot week.`);
    if (ex === null) f.push('No 7-day change reported: momentum left neutral.');
    if (p.chains.length === 1) f.push(`Single chain (${p.chains[0]}): its fate is tied to that chain.`);
    return f;
  }

  // Segments: watchlist (the house list), parent-listed (at or above the floor, passing every name and
  // category rule, yet off the watchlist: only DefiLlama's parent link is left), early (below the floor,
  // same rules, no trading same-name sibling). Everything else with no token is set aside, with its reason.
  function build(snap, overrides) {
    const M = Object.assign({}, MODEL, overrides || {});
    const fit = fitPeers(snap, M);
    const fam = families(snap.protocols);
    const watch = new Set(snap.watchlist);
    const picked = [], excluded = [];
    for (const p of snap.protocols) {
      if (hasToken(p)) continue;
      const f = fam.get(p.slug);
      const why = watch.has(p.slug) ? null : ruleExclusion(p) || (f.tokenSibling ? `shares its name with ${f.tokenSibling}, whose token trades: likely a product of it` : null);
      if (why) excluded.push({ slug: p.slug, name: p.name, category: p.category, tvl: p.tvl_usd, why });
      else picked.push({ p, segment: watch.has(p.slug) ? 'watchlist' : p.tvl_usd >= snap.floor_usd ? 'parent-listed' : 'early', f });
    }
    const rows = picked.map(({ p, segment, f }) => {
      const v = value(p, fit, snap.as_of, M);
      const sector = sectorOf(p.category);
      return Object.assign({ slug: p.slug, name: p.name, segment, sector, category: p.category, chains: p.chains, tvl: p.tvl_usd, change7d: p.change_7d, listedAt: p.listed_at, siblings: f.siblings }, v, {
        plan: farmPlan(p, sector, v, fit.market),
        flags: flagsFor(p, v, fit, f.tokenSibling, segment),
      });
    });
    // Rank by implied value; ties go to the slug so two runs write the same bytes.
    rows.sort((x, y) => y.implied - x.implied || (x.slug < y.slug ? -1 : 1));
    rows.forEach((r, i) => (r.rank = i + 1));
    excluded.sort((x, y) => y.tvl - x.tvl || (x.slug < y.slug ? -1 : 1));
    return { M, fit, rows, excluded, peers: fit.peers };
  }

  const api = { MODEL, SECTORS, build, planTotals, sectorOf, ruleExclusion, families, fitPeers, value, farmPlan, stepText, usd };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Radar = api;
})(typeof globalThis === 'object' ? globalThis : this);
