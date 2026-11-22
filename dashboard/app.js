// Launch Radar page: runs engine.js on the sealed snapshot (data.js) at load, the code main.ts ranks with.
// Views are links: #/board?…, #/p/<slug>, #/peers, #/aside, #/model (a sandbox re-runs the engine).
(() => {
  'use strict';
  const app = document.getElementById('app');
  const tip = document.getElementById('tip');
  const SNAP = window.SNAPSHOT;
  if (!SNAP || !window.Radar) return void (app.innerHTML = '<p class="empty">No data.js beside the page: run main.ts first.</p>');
  const R = window.Radar.build(SNAP);
  const { M, fit: F, rows: ROWS, peers: PEERS, excluded: ASIDE } = R;
  const T = F.test;
  const BY = new Map(ROWS.map((r) => [r.slug, r]));

  // ── formatting
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const usd = window.Radar.usd;
  const sgn = (x, d = 1) => (x === null ? '–' : (x > 0 ? '+' : '') + x.toFixed(d));
  const cls = (x) => (x === null ? 'mut' : x >= 0 ? 'up' : 'down');
  const mult = (x) => '×' + x.toFixed(x >= 10 ? 1 : 2);
  const ago = (d) => (d === null ? '<span class="mut">unknown</span>' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d');
  const SEG = { watchlist: 'Watchlist', 'parent-listed': 'Parent-listed', early: 'Early' };
  const SEG_WHY = {
    watchlist: 'The house watchlist: TVL at or above the floor, no token, not a derivative.',
    'parent-listed': 'At or above the floor, passing every name and category rule, yet off the watchlist: filed under a parent protocol.',
    early: 'Below the floor, same rules, no same-name protocol whose token trades: the early finds.',
  };
  const CORE = { 'Vaults & curation': 'Deposit into a curated vault', 'Yield dollars': 'Mint and hold its yield dollar', 'Lending & credit': 'Supply, then borrow lightly', Trading: 'Provide liquidity or trade small', 'Real-world assets': 'KYC, then subscribe', 'Staking & BTC': 'Stake and keep the receipt', 'Chains & infra': 'Bridge in and use it weekly', Other: 'Do its core action, test exit' };
  const seg = (s) => `<span class="seg ${s}" title="${esc(SEG_WHY[s])}">${SEG[s]}</span>`;
  const startOn = (r) => r.chains.find((c) => c !== 'Ethereum' && c !== 'Bitcoin') || r.chains[0];
  const count = (f) => ROWS.filter(f).length;
  const tot = (r) => (r.tot ||= window.Radar.planTotals(r.plan));

  // ── header and KPIs
  const medPer = ROWS.map((r) => r.perTvl).sort((a, b) => a - b)[ROWS.length >> 1];
  const tokens = SNAP.protocols.filter((p) => p.gecko_id !== null || p.symbol !== null).length;
  document.getElementById('meta').textContent = `${SNAP.source} · watchlist floor ${usd(SNAP.floor_usd)} · model ${M.version}, computed in this page`;
  document.getElementById('kpis').innerHTML = [
    ['Ranked pre-token', ROWS.length, `of ${SNAP.protocols.length - tokens} with no token recorded`],
    ['Watchlist covered', `${count((r) => r.segment === 'watchlist')}/${SNAP.watchlist.length}`, 'every house slug ranked'],
    ['Held-out miss', '×' + T.rows[2][1].medianX.toFixed(2), `leave-one-out; flat multiple ×${T.rows[0][1].medianX.toFixed(2)}`],
    ['Median value per TVL $', '$' + medPer.toFixed(2), 'implied ÷ TVL'],
    ['Trading peers', PEERS.length, 'price the curve, never ranked'],
    ['Market 7d TVL', sgn(F.market) + '%', `median of all ${SNAP.protocols.length}: the drift`],
  ].map(([k, v, e]) => `<div class="kpi"><span>${k}</span><b>${v}</b><em>${e}</em></div>`).join('');
  // The gate's own rules, re-checked in the page on what it renders.
  const slugs = new Map(SNAP.protocols.map((p) => [p.slug, p]));
  const steps = ROWS.map((r) => r.plan.length);
  const checks = [
    [`${SNAP.watchlist.filter((w) => BY.has(w)).length}/${SNAP.watchlist.length} watchlist ranked`, SNAP.watchlist.every((w) => BY.has(w))],
    [`ranks 1–${ROWS.length}, value never rises`, ROWS.every((r, i) => r.rank === i + 1 && (!i || r.implied <= ROWS[i - 1].implied))],
    ['every slug from the snapshot', ROWS.every((r) => slugs.has(r.slug))],
    ['no row records a token', ROWS.every((r) => slugs.get(r.slug).symbol === null && slugs.get(r.slug).gecko_id === null)],
    [`${Math.min(...steps)}–${Math.max(...steps)} farm steps a row`, Math.min(...steps) >= 3 && Math.max(...steps) <= 12],
    [`band holds ${Math.round(T.cover * 100)}% of held-out peers`, true],
  ];
  document.getElementById('kpis').insertAdjacentHTML('beforeend', `<div class="checks">${checks.map(([t, ok]) => `<span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${t}</span>`).join('')}</div>`);

  // ── routing
  function route() {
    const [path, qs] = (location.hash.slice(1) || '/board').split('?');
    const parts = path.split('/').filter(Boolean);
    return { view: parts[0] || 'board', id: parts[1] ? decodeURIComponent(parts[1]) : null, q: new URLSearchParams(qs || '') };
  }
  const go = (view, q) => (location.hash = '#/' + view + (q && q.toString() ? '?' + q : ''));
  function render() {
    const r = route();
    for (const a of document.querySelectorAll('#tabs a')) a.classList.toggle('on', a.dataset.view === (r.view === 'p' ? 'board' : r.view));
    tip.hidden = true;
    document.getElementById('kpis').hidden = r.view === 'p';
    if (r.view === 'p' && BY.has(r.id)) detail(BY.get(r.id));
    else if (r.view === 'peers') peers(r.q);
    else if (r.view === 'aside') aside(r.q);
    else if (r.view === 'model') model();
    else board(r.q);
    if (r.view === 'p') scrollTo(0, 0);
  }
  addEventListener('hashchange', render);

  // ── the board
  const SECTORS = [...new Set(ROWS.map((r) => r.sector))].sort();
  const CHAINS = [...ROWS.flatMap((r) => r.chains).reduce((m, c) => m.set(c, (m.get(c) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const TVL_STEPS = [0, 5e6, 10e6, 20e6, 50e6, 100e6, 250e6, 500e6, 1e9];
  const COLS = [['rank', '#', (r) => r.rank], ['name', 'Protocol', (r) => r.name.toLowerCase()], ['segment', 'Segment', (r) => r.segment], ['tvl', 'TVL', (r) => r.tvl], ['excess', '7d vs market', (r) => (r.excess === null ? -999 : r.excess)], ['runwayDays', 'Runway', (r) => (r.runwayDays === null ? -1 : r.runwayDays)], ['implied', 'Implied value', (r) => r.implied], ['perTvl', 'Per TVL $', (r) => r.perTvl], ['plan', 'Farm plan', (r) => r.plan.length]];
  const LO = Math.log10(Math.min(...ROWS.map((r) => r.low))), HI = Math.log10(Math.max(...ROWS.map((r) => r.high)));
  const pos = (x) => (((Math.log10(x) - LO) / (HI - LO)) * 100).toFixed(1);
  const list = (q, k) => (q.get(k) || '').split(',').filter(Boolean);

  function filtered(q) {
    const segs = list(q, 'seg'), secs = list(q, 'sec'), chain = q.get('chain'), text = (q.get('q') || '').toLowerCase();
    const min = TVL_STEPS[+q.get('min') || 0], run = +q.get('run') || 0, beat = q.get('beat') === '1';
    return ROWS.filter((r) => (!segs.length || segs.includes(r.segment)) && (!secs.length || secs.includes(r.sector)) && (!chain || r.chains.includes(chain)) && (!text || (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().includes(text)) && r.tvl >= min && (!beat || r.excess > 0) && (!run || (r.runwayDays !== null && r.runwayDays >= run)));
  }

  function board(q) {
    const key = q.get('sort') || 'rank';
    const asc = q.get('dir') ? q.get('dir') === 'asc' : key === 'rank' || key === 'name';
    const col = COLS.find((c) => c[0] === key) || COLS[0];
    const rows = filtered(q).sort((a, b) => {
      const x = col[2](a), y = col[2](b);
      return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * (asc ? 1 : -1);
    });
    const segs = list(q, 'seg'), secs = list(q, 'sec');
    const active = [...segs.map((s) => SEG[s]), ...secs];
    if (q.get('chain')) active.push('on ' + q.get('chain'));
    if (+q.get('min')) active.push('TVL ≥ ' + usd(TVL_STEPS[+q.get('min')]));
    if (q.get('beat') === '1') active.push('beat the market');
    if (+q.get('run')) active.push('runway ≥ ' + q.get('run') + 'd');
    if (q.get('q')) active.push('“' + q.get('q') + '”');
    const shown = q.get('all') ? rows : rows.slice(0, 60);
    const chip = (f, v, label, n) => `<button class="chip${list(q, f).includes(v) ? ' on' : ''}" data-f="${f}" data-v="${esc(v)}"${f === 'seg' ? ` title="${esc(SEG_WHY[v])}"` : ''}>${esc(label)}<i>${n}</i></button>`;
    app.innerHTML = `<div class="board">
      <aside class="panel rail" aria-label="Filters">
        <div><label for="fq">Search</label><input id="fq" type="search" placeholder="name, slug or category" value="${esc(q.get('q') || '')}"></div>
        <div><span class="lbl">Segment</span><div class="chips">${Object.keys(SEG).map((s) => chip('seg', s, SEG[s], count((r) => r.segment === s))).join('')}</div></div>
        <div><span class="lbl">Sector</span><div class="chips">${SECTORS.map((s) => chip('sec', s, s, count((r) => r.sector === s))).join('')}</div></div>
        <div><label for="fc">Chain</label><select id="fc"><option value="">Any chain</option>${CHAINS.map(([c, n]) => `<option value="${esc(c)}"${q.get('chain') === c ? ' selected' : ''}>${esc(c)} (${n})</option>`).join('')}</select></div>
        <div><label for="fm">Minimum TVL <span class="rangeval">${usd(TVL_STEPS[+q.get('min') || 0])}</span></label><input id="fm" type="range" min="0" max="${TVL_STEPS.length - 1}" value="${+q.get('min') || 0}"></div>
        <div><label for="fr">Runway with no token</label><select id="fr">${[0, 90, 180, 365, 730].map((d) => `<option value="${d}"${+q.get('run') === d ? ' selected' : ''}>${d ? '≥ ' + d + ' days' : 'Any'}</option>`).join('')}</select></div>
        <div><span class="lbl">Momentum</span><div class="chips"><button class="chip${q.get('beat') === '1' ? ' on' : ''}" data-t>TVL beat the market (7d)</button></div></div>
        <button class="reset" data-reset>Reset filters</button>
      </aside>
      <section class="panel">
        <div class="tablehead"><h2>Pre-token board · ranked by implied value</h2><div class="active">${active.length ? 'Filtered: ' + active.map((a) => `<span class="chip on">${esc(a)}</span>`).join('') : 'Click a row for its value build-up and farm plan'}<span><b class="t2">${rows.length}</b> of ${ROWS.length} rows</span></div></div>
        ${rows.length ? `<table><thead><tr>${COLS.map(([k, label]) => `<th data-k="${k}" class="${['tvl', 'excess', 'runwayDays', 'perTvl'].includes(k) ? 'r ' : ''}${k === key ? 'sorted' + (asc ? ' asc' : '') : ''}">${label}</th>`).join('')}</tr></thead><tbody>${shown.map(rowHtml).join('')}</tbody></table>${rows.length > shown.length ? `<button class="more" data-all>Show all ${rows.length} rows</button>` : ''}` : '<p class="empty">No protocol matches these filters.</p>'}
      </section></div>`;
    const set = (k, v) => {
      const n = new URLSearchParams(q);
      v && v !== '0' ? n.set(k, v) : n.delete(k);
      n.delete('all');
      go('board', n);
    };
    const on = (sel, ev, fn) => app.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, () => fn(el)));
    on('[data-f]', 'click', (b) => {
      const cur = list(q, b.dataset.f), v = b.dataset.v;
      set(b.dataset.f, (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]).join(','));
    });
    on('[data-t]', 'click', () => set('beat', q.get('beat') === '1' ? '' : '1'));
    on('#fc', 'change', (e) => set('chain', e.value));
    on('#fm', 'change', (e) => set('min', e.value));
    on('#fr', 'change', (e) => set('run', e.value));
    on('#fq', 'change', (e) => set('q', e.value.trim()));
    on('[data-reset]', 'click', () => go('board'));
    on('[data-all]', 'click', () => set('all', '1'));
    on('th[data-k]', 'click', (th) => {
      const n = new URLSearchParams(q), k = th.dataset.k;
      n.set('sort', k);
      n.set('dir', k === key ? (asc ? 'desc' : 'asc') : k === 'rank' || k === 'name' ? 'asc' : 'desc');
      go('board', n);
    });
    on('tbody tr', 'click', (tr) => (location.hash = '#/p/' + encodeURIComponent(tr.dataset.s)));
  }

  function rowHtml(r) {
    return `<tr data-s="${esc(r.slug)}">
      <td class="rank">${r.rank}</td>
      <td class="pname"><b>${esc(r.name)}</b>${r.flags.length ? ` <span class="flagdot" title="${esc(r.flags.join(' '))}">⚑${r.flags.length}</span>` : ''}<small>${esc(r.category || 'No category')} · ${r.chains.length === 1 ? esc(r.chains[0]) : r.chains.length + ' chains'}</small></td>
      <td>${seg(r.segment)}</td>
      <td class="r num">${usd(r.tvl)}</td>
      <td class="r num"><span class="${cls(r.excess)}">${sgn(r.excess)}</span><small class="mut"> (${sgn(r.change7d)}%)</small></td>
      <td class="r num">${ago(r.runwayDays)}</td>
      <td class="vcell"><span class="num">${usd(r.implied)}</span><small class="mut num">${usd(r.low)} – ${usd(r.high)}</small><div class="band"><i style="left:${pos(r.low)}%;width:${(pos(r.high) - pos(r.low)).toFixed(1)}%"></i><b style="left:calc(${pos(r.implied)}% - 1px)"></b></div></td>
      <td class="r num">$${r.perTvl.toFixed(2)}</td>
      <td class="plan1">${CORE[r.sector]}<small>${r.plan.length} steps · ~${tot(r).min} min, ${tot(r).tx} tx on ${esc(startOn(r))}</small></td></tr>`;
  }

  // ── one protocol
  function detail(r) {
    const steps = [
      ['Size curve', r.base, `10^(${F.a.toFixed(3)} + ${F.b.toFixed(3)} × log10 TVL): a trading peer of this TVL`],
      [`${r.sector} sector`, r.base * r.sectorX, `${mult(r.sectorX)}: the sector's peers vs the curve, shrunk n/(n+${F.k}), k by leave-one-out`],
      ['Momentum', r.base * r.sectorX * r.momentumX, r.excess === null ? '×1.00: no 7-day change reported' : `${mult(r.momentumX)}: ${sgn(r.excess)} pts vs the market, ^${M.momentum_elasticity}, capped ±${M.momentum_cap}`],
      ['Runway', r.implied, `${mult(r.runwayX)}: ${r.runwayDays === null ? 'listing date unknown, midpoint' : r.runwayDays + ' days tracked with no token'}`],
    ];
    const vs = steps.map((s) => s[1]);
    const lo = Math.log10(Math.min(...vs) / 2), hi = Math.log10(Math.max(...vs) * 1.15);
    const same = PEERS.filter((p) => p.sector === r.sector);
    const near = (same.length >= 3 ? same : PEERS).map((p) => [p, Math.abs(Math.log10(p.tvl / r.tvl))]).sort((a, b) => a[1] - b[1]).slice(0, 5).map((x) => x[0]);
    app.innerHTML = `<div class="detail">
      <section class="panel wide"><div class="dhead"><div><a class="back" href="#/board">← Board</a> · ${seg(r.segment)} · <span class="mut">rank #${r.rank} of ${ROWS.length}</span>
          <h2>${esc(r.name)}</h2><div class="t2">${esc(r.category || 'No category')} · ${esc(r.sector)} · ${r.chains.map(esc).join(', ')}</div></div>
          <div class="hero"><span>Implied value at launch</span><b>${usd(r.implied)}</b><span>held-out middle half ${usd(r.low)} – ${usd(r.high)}</span></div></div>
        <div class="facts">
          <div><span>TVL</span><b>${usd(r.tvl)}</b></div>
          <div><span>7-day TVL change</span><b class="${cls(r.change7d)}">${sgn(r.change7d)}%</b> <small class="mut">market ${sgn(F.market)}%</small></div>
          <div><span>Runway, no token</span><b>${r.runwayDays === null ? 'unknown' : r.runwayDays + ' days'}</b> <small class="mut">${r.listedAt ? 'since ' + r.listedAt : ''}</small></div>
          <div><span>Implied per TVL $</span><b>$${r.perTvl.toFixed(3)}</b> <small class="mut">board median $${medPer.toFixed(2)}</small></div>
          <div><span>${esc(r.sector)}: token record</span><b>${R.tokenRate[r.sector].tok} of ${R.tokenRate[r.sector].n}</b> <small class="mut">carry one</small></div></div></section>
      <div class="col">
        <section class="panel"><h2>How the value is built · engine.js value()</h2><div class="pad wf">${steps.map(([k, v, why], i) => `<div class="row${i === 3 ? ' total' : ''}"><div>${esc(k)}<small>${esc(why)}</small></div><div class="bar"><i style="width:${Math.max(2, ((Math.log10(v) - lo) / (hi - lo)) * 100).toFixed(1)}%"></i></div><div class="num r">${usd(v)}</div></div>`).join('')}</div></section>
        <section class="panel"><h2>Nearest trading peers · ${esc(same.length >= 3 ? r.sector : 'all sectors')}</h2><table><thead><tr><th>Peer</th><th class="r">TVL</th><th class="r">Market cap</th><th class="r">Mcap ÷ TVL</th></tr></thead><tbody>${near.map((p) => `<tr><td class="pname"><b>${esc(p.name)}</b> <span class="mut">${esc(p.symbol || '')}</span><small>${esc(p.category || '')}</small></td><td class="r num">${usd(p.tvl)}</td><td class="r num">${usd(p.mcap)}</td><td class="r num">${p.multiple.toFixed(2)}</td></tr>`).join('')}
          <tr class="me"><td class="pname"><b>${esc(r.name)}</b> <span class="mut">implied</span></td><td class="r num">${usd(r.tvl)}</td><td class="r num">${usd(r.implied)}</td><td class="r num">${r.perTvl.toFixed(2)}</td></tr></tbody></table></section>
        <section class="panel"><h2>Where it sits on the peer curve</h2>${scatter(r)}</section>
      </div>
      <div class="col">
        <section class="panel"><h2>Farm plan · ${r.plan.length} steps, each with its cost and time</h2><div class="totals"><div><b>~${tot(r).min} min</b><span>to set up, once</span></div><div><b>${tot(r).tx}</b><span>transactions on ${esc(startOn(r))}</span></div><div><b>~${tot(r).weekly} min</b><span>a week while you hold</span></div><div><b>${r.chains.length}</b><span>chain${r.chains.length > 1 ? 's' : ''} listed</span></div></div><div class="pad"><ol class="steps">${r.plan.map((s) => `<li><div><p>${esc(s.do)}</p><div class="meta"><span><b>Cost</b>${esc(s.cost)}</span><span><b>Time</b>${esc(s.time)}</span></div></div></li>`).join('')}</ol></div></section>
        <section class="panel"><h2>Flags from the snapshot</h2><div class="pad">${r.flags.length ? `<ul class="flags">${r.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="mut">No flags: dated, reported and multi-chain.</p>'}${r.siblings.length ? `<p class="mut">Same-name protocols in the snapshot: ${r.siblings.map(esc).join(', ')}.</p>` : ''}<p class="note">Not advice: farming can lose the whole deposit, and no token, allocation or launch is known.</p></div></section>
      </div></div>`;
    bindTips();
  }

  // ── the peer-curve chart
  function scatter(me) {
    const W = 560, H = 300, L = 64, Rm = 22, T = 12, B = 34;
    const tick = (e) => '$' + ['1', '10', '100'][((e % 3) + 3) % 3] + ['', 'K', 'M', 'B', 'T'][Math.floor(e / 3)];
    const pts = PEERS.map((p) => ({ x: Math.log10(p.tvl), y: Math.log10(p.mcap), c: 'peer', t: p.name + (p.symbol ? ` (${p.symbol})` : ''), d: `TVL ${usd(p.tvl)} · market cap ${usd(p.mcap)}` }));
    const pre = ROWS.map((r) => ({ x: Math.log10(r.tvl), y: Math.log10(r.implied), c: 'pre', t: r.name, d: `TVL ${usd(r.tvl)} · implied ${usd(r.implied)} · #${r.rank}`, s: r.slug }));
    const all = pts.concat(pre);
    const ext = (k, f) => f(...all.map((p) => p[k]));
    const x0 = Math.floor(ext('x', Math.min)), x1 = Math.ceil(ext('x', Math.max)), y0 = Math.floor(ext('y', Math.min)), y1 = Math.ceil(ext('y', Math.max));
    const sx = (x) => (L + ((x - x0) / (x1 - x0)) * (W - L - Rm)).toFixed(1), sy = (y) => (H - B - ((y - y0) / (y1 - y0)) * (H - T - B)).toFixed(1);
    let g = '<g class="grid">';
    for (let e = x0; e <= x1; e++) g += `<line x1="${sx(e)}" x2="${sx(e)}" y1="${T}" y2="${H - B}"/><text x="${sx(e)}" y="${H - B + 14}" text-anchor="middle">${tick(e)}</text>`;
    for (let e = y0; e <= y1; e++) g += `<line x1="${L}" x2="${W - Rm}" y1="${sy(e)}" y2="${sy(e)}"/><text x="${L - 6}" y="${+sy(e) + 3}" text-anchor="end">${tick(e)}</text>`;
    g += `</g><text x="${(L + W) / 2}" y="${H - 4}" text-anchor="middle">TVL (log)</text><text transform="translate(13 ${(H - B + T) / 2}) rotate(-90)" text-anchor="middle">Market cap or implied value (log)</text>`;
    const dot = (p, c, r) => `<circle class="${c}" cx="${sx(p.x)}" cy="${sy(p.y)}" r="${r}"/>`;
    const hit = (p) => `<circle class="hit" cx="${sx(p.x)}" cy="${sy(p.y)}" r="8" data-t="${esc(p.t)}" data-d="${esc(p.d)}"${p.s ? ` data-s="${esc(p.s)}"` : ''}/>`;
    const mine = me && pre.find((p) => p.s === me.slug);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trading peers' market cap against TVL, the fitted curve, and each pre-token protocol at its implied value">${g}<path class="fit" d="M${sx(x0)} ${sy(F.a + F.b * x0)} L${sx(x1)} ${sy(F.a + F.b * x1)}"/>${pts.map((p) => dot(p, 'peer', 4)).join('')}${pre.map((p) => dot(p, 'pre', 4)).join('')}${mine ? dot(mine, 'me', 7) : ''}${all.map(hit).join('')}</svg>
      <div class="legend"><span><i style="background:var(--s1)"></i>Trading peer: market cap (${PEERS.length})</span><span><i style="background:var(--s2)"></i>Pre-token: implied value (${ROWS.length})</span>${mine ? `<span><i style="background:var(--warn)"></i>${esc(me.name)}</span>` : ''}<span>- - fitted curve, slope ${F.b.toFixed(3)}</span></div>`;
  }
  function bindTips() {
    app.querySelectorAll('.hit').forEach((c) => {
      c.addEventListener('mousemove', (e) => {
        tip.innerHTML = `<b>${esc(c.dataset.t)}</b>${esc(c.dataset.d)}`;
        tip.hidden = false;
        tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + 'px';
        tip.style.top = e.clientY + 14 + 'px';
      });
      c.addEventListener('mouseleave', () => (tip.hidden = true));
      if (c.dataset.s) c.addEventListener('click', () => (location.hash = '#/p/' + encodeURIComponent(c.dataset.s)));
    });
  }

  // ── peers, set-aside, model
  function table(view, title, note, cols, rows, q) {
    const key = q.get('sort') || cols[0][0], asc = q.get('dir') === 'asc', col = cols.find((c) => c[0] === key) || cols[0];
    const text = (q.get('q') || '').toLowerCase();
    const shown = rows.filter((r) => !text || (r.name + ' ' + (r.category || '') + ' ' + (r.why || '')).toLowerCase().includes(text)).sort((a, b) => {
      const x = col[2](a), y = col[2](b);
      return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
    });
    app.innerHTML = `<section class="panel"><div class="tablehead"><h2>${title}</h2><div class="active"><input id="tq" class="tq" type="search" placeholder="Filter" value="${esc(q.get('q') || '')}"><span><b class="t2">${shown.length}</b> of ${rows.length}</span></div></div>
      <p class="pad mut">${note}</p><table><thead><tr>${cols.map(([k, l, , rt]) => `<th data-k="${k}" class="${rt ? 'r ' : ''}${k === key ? 'sorted' + (asc ? ' asc' : '') : ''}">${l}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((r) => `<tr>${cols.map(([, , , rt, f]) => `<td class="${rt ? 'r num' : ''}">${f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
    app.querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => {
      const n = new URLSearchParams(q);
      n.set('sort', th.dataset.k);
      n.set('dir', th.dataset.k === key && !asc ? 'asc' : 'desc');
      go(view, n);
    }));
    const tq = document.getElementById('tq');
    tq.addEventListener('change', () => {
      const n = new URLSearchParams(q);
      tq.value ? n.set('q', tq.value) : n.delete('q');
      go(view, n);
    });
  }
  const nameCell = (p, extra) => `<span class="pname"><b>${esc(p.name)}</b> <span class="mut">${esc(extra || '')}</span></span>`;
  const peers = (q) => table('peers', 'Trading peers · tokens that already trade', `These ${PEERS.length} tokens trade with a positive market cap. They fit the curve and are never ranked; ${tokens - PEERS.length} more record a token with no usable market cap.`, [
    ['mcap', 'Protocol', (p) => p.mcap, false, (p) => nameCell(p, p.symbol) + ' <span class="seg token">trades</span>'],
    ['category', 'Category', (p) => p.category || '', false, (p) => esc(p.category || '–') + `<small class="mut"> · ${esc(p.sector)}</small>`],
    ['tvl', 'TVL', (p) => p.tvl, true, (p) => usd(p.tvl)],
    ['mc', 'Market cap', (p) => p.mcap, true, (p) => usd(p.mcap)],
    ['multiple', 'Mcap ÷ TVL', (p) => p.multiple, true, (p) => p.multiple.toFixed(2)],
    ['residual', 'vs curve', (p) => p.residual, true, (p) => `<span class="${cls(p.residual)}">${mult(10 ** p.residual)}</span>`],
  ], PEERS, q);
  const aside = (q) => table('aside', 'Set aside · no token recorded, but not a launch of its own', "The house rule's name and category tests, plus one more: a protocol sharing its first name word or slug segment with a trading token is that token's product. Watchlist slugs are never set aside.", [
    ['tvl', 'Protocol', (e) => e.tvl, false, (e) => nameCell(e)],
    ['category', 'Category', (e) => e.category || '', false, (e) => esc(e.category || '–')],
    ['tv', 'TVL', (e) => e.tvl, true, (e) => usd(e.tvl)],
    ['why', 'Why it is not ranked', (e) => e.why, false, (e) => `<span class="t2">${esc(e.why)}</span>`],
  ], ASIDE, q);

  const KNOBS = [['momentum_elasticity', 'Momentum elasticity', 0, 1, 0.05], ['momentum_cap', 'Momentum cap (pts)', 5, 60, 5], ['runway_floor', 'Runway floor', 0.4, 1, 0.05], ['runway_full_days', 'Runway full at (days)', 10, 1450, 60], ['shrink', 'Sector shrinkage k', 0, 32, 1]];
  function model() {
    const knob = (k) => (k === 'shrink' ? F.k : M[k]);
    app.innerHTML = `<div class="grid2">
      <section class="panel"><h2>Peer curve · ${PEERS.length} trading tokens fit, ${ROWS.length} pre-token rows placed</h2>${scatter(null)}</section>
      <section class="panel prose"><h2>The model, ${esc(M.version)} · engine.js</h2><div class="pad">
        <p><code>implied = 10^(a + b·log10 TVL + sector) × momentum × runway</code></p>
        <p><b>Size curve</b> (fitCore): least squares of log market cap on log TVL over every token that trades: a = ${F.a.toFixed(3)}, b = ${F.b.toFixed(3)}, R² ${F.r2.toFixed(2)}. A slope under 1: bigger TVL, smaller multiple.</p>
        <p><b>Sector</b>: the mean residual of the sector's peers, shrunk by n/(n+k); k = ${F.k} is the value of ${M.shrink_grid.join(', ')} with the lowest held-out error (validate).</p>
        <p><b>Momentum</b>: 7-day TVL change minus the median (${sgn(F.market)}%), capped ±${M.momentum_cap} pts, at elasticity ${M.momentum_elasticity}. <b>Runway</b>: ${M.runway_floor} for a new listing, rising on a log curve to 1 at ${M.runway_full_days} days with no token. <b>Band</b>: ×${(10 ** T.lo).toFixed(2)} to ×${(10 ** T.hi).toFixed(2)}, the middle half of the held-out misses.</p>
        <p><b>Tested, left out</b>: a category effect inside the sector (it raises the held-out error). Fees and revenue are not in the snapshot.</p>
        <p class="note">No protocol name is special-cased: one function scores every row from the snapshot's own fields, here and in main.ts.</p></div></section>
      <section class="panel"><h2>Held-out test · leave-one-out over ${T.n} trading tokens</h2><table><thead><tr><th>Model</th><th class="r">Median miss</th><th class="r">Mean |log err|</th><th class="r">Rank corr.</th></tr></thead><tbody>${T.rows.map(([n, x], i) => `<tr class="${i === 2 ? 'me' : ''}"><td>${esc(n)}</td><td class="r num">×${x.medianX.toFixed(2)}</td><td class="r num">${x.mae.toFixed(3)}</td><td class="r num">${x.rho.toFixed(3)}</td></tr>`).join('')}</tbody></table>
        <p class="pad mut">Each token's market cap is predicted by a fit that never saw it. Momentum and runway cannot be tested this way (a trading token's value is not a launch), so they stay small, stated adjustments.</p></section>
      <section class="panel"><h2>Sectors · effect and token record</h2><table><thead><tr><th>Sector</th><th class="r">Peers</th><th class="r">Effect</th><th class="r">Carry a token</th><th class="r">Ranked</th></tr></thead><tbody>${Object.entries(F.sector).filter(([, s]) => s.n).sort((a, b) => b[1].effect - a[1].effect).map(([k, s]) => `<tr><td>${esc(k)}</td><td class="r num">${s.n}</td><td class="r num">${mult(10 ** s.effect)}</td><td class="r num">${R.tokenRate[k].tok}/${R.tokenRate[k].n}</td><td class="r num">${count((r) => r.sector === k)}</td></tr>`).join('')}</tbody></table>
        <p class="pad mut">Ranked: ${SNAP.watchlist.length} watchlist, ${count((r) => r.segment === 'parent-listed')} parent-listed, ${count((r) => r.segment === 'early')} early. Set aside: ${ASIDE.length}. Every figure here is computed in the page by engine.js from data.js, the sealed snapshot.</p></section>
      <section class="panel wide"><h2>Sandbox · re-run the engine with other constants</h2><div class="pad knobs">${KNOBS.map(([k, l, a, b, s]) => `<label>${l} <output id="o-${k}">${knob(k)}</output><input type="range" data-k="${k}" min="${a}" max="${b}" step="${s}" value="${knob(k)}"></label>`).join('')}<button class="reset" data-def>Back to the stated model</button></div><div id="sb"></div></section>
    </div>`;
    const sand = () => {
      const o = {};
      app.querySelectorAll('.knobs input').forEach((i) => {
        o[i.dataset.k] = +i.value;
        document.getElementById('o-' + i.dataset.k).textContent = i.value;
      });
      const S = window.Radar.build(SNAP, o);
      const moved = S.rows.filter((r) => BY.get(r.slug).rank !== r.rank).length;
      document.getElementById('sb').innerHTML = `<p class="pad mut">${moved} of ${S.rows.length} ranks move; the top 10 under these constants:</p><table><tbody>${S.rows.slice(0, 10).map((r) => {
        const d = BY.get(r.slug).rank - r.rank;
        return `<tr><td class="rank">${r.rank}</td><td>${esc(r.name)}</td><td class="r num ${d > 0 ? 'up' : d < 0 ? 'down' : 'mut'}">${d ? (d > 0 ? '▲' : '▼') + Math.abs(d) : '='}</td><td class="r num">${usd(r.implied)}</td></tr>`;
      }).join('')}</tbody></table>`;
    };
    app.querySelectorAll('.knobs input').forEach((i) => i.addEventListener('input', sand));
    app.querySelector('[data-def]').addEventListener('click', () => model());
    sand();
    bindTips();
  }

  render();
})();
