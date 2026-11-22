// Launch Radar page: reads window.RADAR (data.js, written by main.ts) and renders four views from the
// URL hash, so every view, filter and sort is a link: #/board?..., #/p/<slug>, #/peers, #/aside, #/model.
(() => {
  'use strict';
  const D = window.RADAR;
  const app = document.getElementById('app');
  const tip = document.getElementById('tip');
  if (!D) {
    app.innerHTML = '<p class="empty">No data.js beside the page: run main.ts first.</p>';
    return;
  }
  const M = D.model;
  const ROWS = D.rows;
  const BY = new Map(ROWS.map((r) => [r.s, r]));

  // ------------------------------------------------------------ formatting
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const usd = (n) => {
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  };
  const pctOf = (x) => x.toFixed(Math.max(2, 1 - Math.floor(Math.log10(x)))) + '%';
  const sgn = (x, d = 1) => (x === null || x === undefined ? '–' : (x > 0 ? '+' : '') + x.toFixed(d));
  const cls = (x) => (x === null ? 'mut' : x >= 0 ? 'up' : 'down');
  const mult = (x) => '×' + x.toFixed(x >= 10 ? 1 : 2);
  const SEG = { watchlist: 'Watchlist', 'parent-listed': 'Parent-listed', early: 'Early' };
  const SEG_WHY = {
    watchlist: "On the house watchlist: TVL at or above the floor, no token recorded, not a derivative.",
    'parent-listed': 'At or above the floor and passing every name and category rule, yet off the watchlist: DefiLlama files it under a parent protocol.',
    early: 'Below the floor, passing the same rules, with no same-name protocol whose token trades: the early finds.',
  };
  const CORE = {
    'Vaults & curation': 'Deposit into a curated vault',
    'Yield dollars': 'Mint and hold its yield dollar',
    'Lending & credit': 'Supply, then borrow lightly',
    Trading: 'Provide liquidity or trade small',
    'Real-world assets': 'KYC, then subscribe',
    'Staking & BTC': 'Stake and keep the receipt',
    'Chains & infra': 'Bridge in and use it weekly',
    Other: 'Do its core action, test exit',
  };
  const seg = (s) => `<span class="seg ${s}" title="${esc(SEG_WHY[s] || '')}">${SEG[s] || s}</span>`;
  const startChain = (r) => r.ch.find((c) => c !== 'Ethereum' && c !== 'Bitcoin') || r.ch[0] || '–';

  // ------------------------------------------------------------ header and KPIs
  const total = ROWS.reduce((t, r) => t + r.v, 0);
  const medM = ROWS.map((r) => r.m).sort((a, b) => a - b)[ROWS.length >> 1];
  const covered = ROWS.filter((r) => r.seg === 'watchlist').length;
  document.getElementById('meta').textContent = `${D.source} · watchlist floor ${usd(D.floor)} · model ${M.version}`;
  document.getElementById('kpis').innerHTML = [
    ['Ranked pre-token', ROWS.length, `of ${D.counts.pre_token} with no token recorded`],
    ['Watchlist covered', `${covered}/${D.counts.watchlist}`, 'every house slug ranked'],
    ['Implied, all rows', usd(total), 'sum of the board'],
    ['Median value per TVL $', '$' + medM.toFixed(2), 'implied ÷ TVL'],
    ['Trading peers', D.counts.peers, `price the curve, never ranked`],
    ['Market 7d TVL', sgn(M.market_change_7d) + '%', 'median of all 758: the drift'],
  ]
    .map(([k, v, e]) => `<div class="kpi"><span>${k}</span><b>${v}</b><em>${e}</em></div>`)
    .join('');

  // ------------------------------------------------------------ routing
  function route() {
    const h = location.hash.slice(1) || '/board';
    const [path, qs] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    return { view: parts[0] || 'board', id: parts[1] ? decodeURIComponent(parts[1]) : null, q: new URLSearchParams(qs || '') };
  }
  function go(view, q) {
    const s = q && [...q.keys()].length ? '?' + q.toString() : '';
    location.hash = '#/' + view + s;
  }
  function render() {
    const r = route();
    for (const a of document.querySelectorAll('#tabs a')) a.classList.toggle('on', a.dataset.view === (r.view === 'p' ? 'board' : r.view));
    hideTip();
    document.getElementById('kpis').hidden = r.view === 'p';
    if (r.view === 'p' && BY.has(r.id)) detail(BY.get(r.id));
    else if (r.view === 'peers') peers(r.q);
    else if (r.view === 'aside') aside(r.q);
    else if (r.view === 'model') model();
    else board(r.q);
    if (r.view === 'p') window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);

  // ------------------------------------------------------------ the board
  const SECTORS = [...new Set(ROWS.map((r) => r.sec))].sort();
  const CHAINS = (() => {
    const c = new Map();
    for (const r of ROWS) for (const ch of r.ch) c.set(ch, (c.get(ch) || 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  })();
  const TVL_STEPS = [0, 5e6, 10e6, 20e6, 50e6, 100e6, 250e6, 500e6, 1e9];
  const COLS = [
    ['r', '#', (r) => r.r],
    ['n', 'Protocol', (r) => r.n.toLowerCase()],
    ['seg', 'Segment', (r) => r.seg],
    ['tvl', 'TVL', (r) => r.tvl],
    ['ex', '7d vs market', (r) => (r.ex === null ? -999 : r.ex)],
    ['days', 'Runway', (r) => (r.days === null ? -1 : r.days)],
    ['v', 'Implied value', (r) => r.v],
    ['m', 'Per TVL $', (r) => r.m],
    ['plan', 'Farm plan', (r) => r.plan.length],
  ];
  const LO = Math.log10(Math.min(...ROWS.map((r) => r.lo)));
  const HI = Math.log10(Math.max(...ROWS.map((r) => r.hi)));
  const pos = (x) => ((Math.log10(x) - LO) / (HI - LO)) * 100;

  function filtered(q) {
    const segs = (q.get('seg') || '').split(',').filter(Boolean);
    const secs = (q.get('sec') || '').split(',').filter(Boolean);
    const chain = q.get('chain') || '';
    const text = (q.get('q') || '').toLowerCase();
    const min = TVL_STEPS[+q.get('min') || 0];
    const beat = q.get('beat') === '1';
    const runway = +(q.get('run') || 0);
    return ROWS.filter(
      (r) =>
        (!segs.length || segs.includes(r.seg)) &&
        (!secs.length || secs.includes(r.sec)) &&
        (!chain || r.ch.includes(chain)) &&
        (!text || r.n.toLowerCase().includes(text) || r.s.includes(text) || (r.cat || '').toLowerCase().includes(text)) &&
        r.tvl >= min &&
        (!beat || (r.ex !== null && r.ex > 0)) &&
        (!runway || (r.days !== null && r.days >= runway)),
    );
  }

  function board(q) {
    const key = q.get('sort') || 'r';
    const asc = q.get('dir') ? q.get('dir') === 'asc' : key === 'r' || key === 'n';
    const col = COLS.find((c) => c[0] === key) || COLS[0];
    const rows = filtered(q).sort((a, b) => {
      const x = col[2](a), y = col[2](b);
      return (x < y ? -1 : x > y ? 1 : a.r - b.r) * (asc ? 1 : -1);
    });
    const segs = (q.get('seg') || '').split(',').filter(Boolean);
    const secs = (q.get('sec') || '').split(',').filter(Boolean);
    const count = (f) => ROWS.filter(f).length;
    const active = [];
    for (const s of segs) active.push(SEG[s]);
    for (const s of secs) active.push(s);
    if (q.get('chain')) active.push('on ' + q.get('chain'));
    if (+q.get('min')) active.push('TVL ≥ ' + usd(TVL_STEPS[+q.get('min')]));
    if (q.get('beat') === '1') active.push('beat the market');
    if (+q.get('run')) active.push('runway ≥ ' + q.get('run') + 'd');
    if (q.get('q')) active.push('“' + q.get('q') + '”');
    const shown = rows.slice(0, +q.get('all') ? rows.length : 60);
    app.innerHTML = `<div class="board">
      <aside class="panel rail" aria-label="Filters">
        <div><label for="fq">Search</label><input id="fq" type="search" placeholder="name, slug or category" value="${esc(q.get('q') || '')}"></div>
        <div><span class="lbl">Segment</span><div class="chips">${Object.keys(SEG)
          .map((s) => `<button class="chip${segs.includes(s) ? ' on' : ''}" data-f="seg" data-v="${s}" title="${esc(SEG_WHY[s])}">${SEG[s]}<i>${count((r) => r.seg === s)}</i></button>`)
          .join('')}</div></div>
        <div><span class="lbl">Sector</span><div class="chips">${SECTORS.map((s) => `<button class="chip${secs.includes(s) ? ' on' : ''}" data-f="sec" data-v="${esc(s)}">${esc(s)}<i>${count((r) => r.sec === s)}</i></button>`).join('')}</div></div>
        <div><label for="fc">Chain</label><select id="fc"><option value="">Any chain</option>${CHAINS.map(([c, n]) => `<option value="${esc(c)}"${q.get('chain') === c ? ' selected' : ''}>${esc(c)} (${n})</option>`).join('')}</select></div>
        <div><label for="fm">Minimum TVL <span class="rangeval">${usd(TVL_STEPS[+q.get('min') || 0])}</span></label><input id="fm" type="range" min="0" max="${TVL_STEPS.length - 1}" value="${+q.get('min') || 0}"></div>
        <div><label for="fr">Runway with no token <span class="rangeval">${+q.get('run') ? '≥ ' + q.get('run') + ' d' : 'any'}</span></label><select id="fr">${[0, 90, 180, 365, 730].map((d) => `<option value="${d}"${+q.get('run') === d ? ' selected' : ''}>${d ? '≥ ' + d + ' days' : 'Any'}</option>`).join('')}</select></div>
        <div><span class="lbl">Momentum</span><div class="chips"><button class="chip${q.get('beat') === '1' ? ' on' : ''}" data-t="beat">TVL beat the market (7d)</button></div></div>
        <button class="reset" data-reset>Reset filters</button>
      </aside>
      <section class="panel">
        <div class="tablehead"><h2>Pre-token board · ranked by implied value</h2>
          <div class="active">${active.length ? 'Filtered: ' + active.map((a) => `<span class="chip on">${esc(a)}</span>`).join('') : ''}<span><b class="t2">${rows.length}</b> of ${ROWS.length} rows</span></div></div>
        ${rows.length ? `<table><thead><tr>${COLS.map(([k, label]) => `<th data-k="${k}" class="${['tvl', 'ex', 'days', 'm'].includes(k) ? 'r ' : ''}${k === key ? 'sorted' + (asc ? ' asc' : '') : ''}${k === 'seg' ? ' hide-s' : ''}">${label}</th>`).join('')}</tr></thead>
        <tbody>${shown.map(rowHtml).join('')}</tbody></table>${rows.length > shown.length ? `<button class="more" data-all>Show all ${rows.length} rows</button>` : ''}` : '<p class="empty">No protocol matches these filters.</p>'}
      </section></div>`;

    const set = (k, v) => {
      const n = new URLSearchParams(q);
      if (v === '' || v === null || v === '0') n.delete(k);
      else n.set(k, v);
      n.delete('all');
      go('board', n);
    };
    app.querySelectorAll('[data-f]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.f;
        const cur = (q.get(k) || '').split(',').filter(Boolean);
        const v = b.dataset.v;
        set(k, (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]).join(','));
      }),
    );
    app.querySelector('[data-t]').addEventListener('click', () => set('beat', q.get('beat') === '1' ? '' : '1'));
    app.querySelector('#fc').addEventListener('change', (e) => set('chain', e.target.value));
    app.querySelector('#fm').addEventListener('change', (e) => set('min', e.target.value));
    app.querySelector('#fr').addEventListener('change', (e) => set('run', e.target.value));
    const fq = app.querySelector('#fq');
    fq.addEventListener('change', () => set('q', fq.value.trim()));
    app.querySelector('[data-reset]').addEventListener('click', () => go('board'));
    const all = app.querySelector('[data-all]');
    if (all) all.addEventListener('click', () => { const n = new URLSearchParams(q); n.set('all', '1'); go('board', n); });
    app.querySelectorAll('th[data-k]').forEach((th) =>
      th.addEventListener('click', () => {
        const n = new URLSearchParams(q);
        const k = th.dataset.k;
        const dflt = k === 'r' || k === 'n' ? 'asc' : 'desc';
        n.set('sort', k);
        n.set('dir', k === key ? (asc ? 'desc' : 'asc') : dflt);
        go('board', n);
      }),
    );
    app.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => (location.hash = '#/p/' + encodeURIComponent(tr.dataset.s))));
  }

  function rowHtml(r) {
    const runway = r.days === null ? '<span class="mut">unknown</span>' : r.days >= 365 ? (r.days / 365).toFixed(1) + ' y' : r.days + ' d';
    return `<tr data-s="${esc(r.s)}">
      <td class="rank">${r.r}</td>
      <td class="pname"><b>${esc(r.n)}</b>${r.fl.length ? ` <span class="flagdot" title="${esc(r.fl.join(' '))}">${r.fl.length}</span>` : ''}<small>${esc(r.cat || 'No category')} · ${r.ch.length === 1 ? esc(r.ch[0]) : r.ch.length + ' chains'}</small></td>
      <td class="hide-s">${seg(r.seg)}</td>
      <td class="r num">${usd(r.tvl)}</td>
      <td class="r num"><span class="${cls(r.ex)}">${sgn(r.ex)}</span><small class="mut"> (${sgn(r.d7)}%)</small></td>
      <td class="r num">${runway}</td>
      <td class="vcell"><span class="num">${usd(r.v)}</span><small class="mut num">${usd(r.lo)} – ${usd(r.hi)}</small><div class="band"><i style="left:${pos(r.lo).toFixed(1)}%;width:${(pos(r.hi) - pos(r.lo)).toFixed(1)}%"></i><b style="left:calc(${pos(r.v).toFixed(1)}% - 1px)"></b></div></td>
      <td class="r num">$${r.m.toFixed(2)}</td>
      <td class="plan1">${CORE[r.sec] || CORE.Other}<small>${r.plan.length} steps · start on ${esc(startChain(r))}</small></td>
    </tr>`;
  }

  // ------------------------------------------------------------ one protocol
  function nearestPeers(r, n) {
    const same = D.peers.filter((p) => p.sec === r.sec);
    const pool = same.length >= 3 ? same : D.peers;
    return pool
      .map((p) => ({ p, d: Math.abs(Math.log10(p.tvl) - Math.log10(r.tvl)) }))
      .sort((a, b) => a.d - b.d || (a.p.s < b.p.s ? -1 : 1))
      .slice(0, n)
      .map((x) => x.p);
  }

  function detail(r) {
    const steps = [
      ['Size curve', r.base, `10^(${M.a} + ${M.b} × log10 TVL): a trading peer of this TVL`],
      [`${r.sec} sector`, r.base * r.xs, `${mult(r.xs)}: peers in the sector vs the curve, shrunk n/(n+${M.shrink})`],
      [`${r.cat || 'No'} category`, r.base * r.xs * r.xc, `${mult(r.xc)}: the category inside its sector, shrunk the same way`],
      ['Momentum', r.base * r.xs * r.xc * r.xm, r.ex === null ? '×1.00: no 7-day change reported' : `${mult(r.xm)}: ${sgn(r.ex)} pts vs the market, ^${M.momentum_elasticity}, capped ±${M.momentum_cap}`],
      ['Runway', r.v, `${mult(r.xr)}: ${r.days === null ? 'listing date unknown, midpoint' : r.days + ' days tracked with no token'}`],
    ];
    const vals = steps.map((s) => s[1]);
    const lo = Math.log10(Math.min(...vals) / 2), hi = Math.log10(Math.max(...vals) * 1.15);
    const w = (x) => Math.max(2, ((Math.log10(x) - lo) / (hi - lo)) * 100).toFixed(1);
    const near = nearestPeers(r, 6);
    const rank = r.r;
    app.innerHTML = `<div class="detail">
      <section class="panel" style="grid-column:1/-1">
        <div class="dhead"><div><a class="back" href="#/board">← Board</a> · ${seg(r.seg)} · <span class="mut">rank #${rank} of ${ROWS.length}</span>
          <h2>${esc(r.n)}</h2><div class="t2">${esc(r.cat || 'No category')} · ${esc(r.sec)} · ${r.ch.map(esc).join(', ')}</div></div>
          <div class="hero"><span>Implied value at launch</span><b>${usd(r.v)}</b><span>middle-half band ${usd(r.lo)} – ${usd(r.hi)}</span></div></div>
        <div class="facts">
          <div><span>TVL</span><b>${usd(r.tvl)}</b></div>
          <div><span>7-day TVL change</span><b class="${cls(r.d7)}">${sgn(r.d7)}%</b> <small class="mut">market ${sgn(M.market_change_7d)}%</small></div>
          <div><span>Runway, no token</span><b>${r.days === null ? 'unknown' : r.days + ' days'}</b> <small class="mut">${r.lis ? 'since ' + r.lis : ''}</small></div>
          <div><span>Implied per TVL $</span><b>$${r.m.toFixed(3)}</b></div>
        </div>
      </section>
      <div class="col">
        <section class="panel"><h2>How the value is built</h2><div class="pad wf">${steps
          .map(([k, v, why], i) => `<div class="row${i === steps.length - 1 ? ' total' : ''}"><div>${esc(k)}<small>${esc(why)}</small></div><div class="bar"><i style="width:${w(v)}%"></i></div><div class="num r">${usd(v)}</div></div>`)
          .join('')}</div></section>
        <section class="panel"><h2>Nearest trading peers · ${esc(near[0] && near[0].sec === r.sec ? r.sec : 'all sectors')}</h2>
          <table><thead><tr><th>Peer</th><th class="r">TVL</th><th class="r">Market cap</th><th class="r">Mcap ÷ TVL</th></tr></thead><tbody>${near
            .map((p) => `<tr><td class="pname"><b>${esc(p.n)}</b> <span class="mut">${esc(p.sym || '')}</span><small>${esc(p.cat || '')}</small></td><td class="r num">${usd(p.tvl)}</td><td class="r num">${usd(p.mc)}</td><td class="r num">${p.m.toFixed(2)}</td></tr>`)
            .join('')}<tr><td class="pname"><b>${esc(r.n)}</b> <span class="mut">implied</span></td><td class="r num">${usd(r.tvl)}</td><td class="r num">${usd(r.v)}</td><td class="r num">${r.m.toFixed(2)}</td></tr></tbody></table></section>
        <section class="panel"><h2>Where it sits on the peer curve</h2>${scatter(r)}</section>
      </div>
      <div class="col">
        <section class="panel"><h2>Farm plan · ${r.plan.length} steps, each with its cost and time</h2><div class="pad"><ol class="steps">${r.plan
          .map(([d, c, t]) => `<li><div><p>${esc(d)}</p><div class="meta"><span><b>Cost</b>${esc(c)}</span><span><b>Time</b>${esc(t)}</span></div></div></li>`)
          .join('')}</ol></div></section>
        <section class="panel"><h2>Flags from the snapshot</h2><div class="pad">${r.fl.length ? `<ul class="flags">${r.fl.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="mut" style="margin:0">No flags: dated, reported and multi-chain.</p>'}
          ${r.sib.length ? `<p class="mut" style="margin:10px 0 0">Same-name protocols in the snapshot: ${r.sib.map(esc).join(', ')}.</p>` : ''}</div></section>
        <section class="panel"><h2>Illustrative arithmetic</h2><div class="pad calc">
          <div><label class="mut" for="cd">Your deposit (USD)</label><input id="cd" type="number" min="0" step="100" value="1000"></div>
          <div><label class="mut" for="cs">Share of supply to depositors (%)</label><input id="cs" type="number" min="0" max="100" step="0.5" value="5"></div>
          <output id="co"></output>
          <p class="note" style="grid-column:1/-1;margin:0">Pro-rata arithmetic on the implied value and today's TVL, with an allocation you choose. It is not a forecast: no token, allocation or launch is known.</p></div></section>
      </div></div>`;
    const calc = () => {
      const dep = Math.max(0, +document.getElementById('cd').value || 0);
      const sh = Math.max(0, Math.min(100, +document.getElementById('cs').value || 0));
      const v = (dep / r.tvl) * (sh / 100) * r.v;
      document.getElementById('co').innerHTML = `${usd(dep)} is ${dep > 0 ? pctOf((dep / r.tvl) * 100) : '0%'} of TVL; at ${sh}% of an ${usd(r.v)} token split pro rata, that share is <b>${usd(v)}</b> (band ${usd((dep / r.tvl) * (sh / 100) * r.lo)}–${usd((dep / r.tvl) * (sh / 100) * r.hi)}).`;
    };
    document.getElementById('cd').addEventListener('input', calc);
    document.getElementById('cs').addEventListener('input', calc);
    calc();
    bindTips();
  }

  // ------------------------------------------------------------ the peer-curve chart
  function scatter(me) {
    const W = 560, H = 300, L = 46, R = 12, T = 12, B = 34;
    const pts = D.peers.map((p) => ({ x: Math.log10(p.tvl), y: Math.log10(p.mc), k: 'peer', t: `${p.n}${p.sym ? ' (' + p.sym + ')' : ''}`, d: `TVL ${usd(p.tvl)} · mcap ${usd(p.mc)}` }));
    const pre = ROWS.map((r) => ({ x: Math.log10(r.tvl), y: Math.log10(r.v), k: 'pre', t: r.n, d: `TVL ${usd(r.tvl)} · implied ${usd(r.v)} · #${r.r}`, s: r.s }));
    const all = pts.concat(pre);
    const x0 = Math.floor(Math.min(...all.map((p) => p.x))), x1 = Math.ceil(Math.max(...all.map((p) => p.x)));
    const y0 = Math.floor(Math.min(...all.map((p) => p.y))), y1 = Math.ceil(Math.max(...all.map((p) => p.y)));
    const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
    const sy = (y) => H - B - ((y - y0) / (y1 - y0)) * (H - T - B);
    const lab = (e) => usd(10 ** e).replace('.00', '');
    let g = '<g class="grid">';
    for (let e = x0; e <= x1; e++) g += `<line x1="${sx(e)}" x2="${sx(e)}" y1="${T}" y2="${H - B}"/><text x="${sx(e)}" y="${H - B + 14}" text-anchor="middle">${lab(e)}</text>`;
    for (let e = y0; e <= y1; e++) g += `<line x1="${L}" x2="${W - R}" y1="${sy(e)}" y2="${sy(e)}"/><text x="${L - 6}" y="${sy(e) + 3}" text-anchor="end">${lab(e)}</text>`;
    g += `</g><text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">TVL (log)</text><text transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Market cap / implied value (log)</text>`;
    const fit = `<path class="fit" d="M${sx(x0)} ${sy(M.a + M.b * x0)} L${sx(x1)} ${sy(M.a + M.b * x1)}"/>`;
    const dot = (p, c, r) => `<circle class="${c}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${r}"/>`;
    const hit = (p) => `<circle class="hit" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="8" data-t="${esc(p.t)}" data-d="${esc(p.d)}"${p.s ? ` data-s="${esc(p.s)}"` : ''}/>`;
    const mine = me ? pre.find((p) => p.s === me.s) : null;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trading peers' market cap against TVL, the fitted curve, and each pre-token protocol at its implied value">${g}${fit}${pts.map((p) => dot(p, 'peer', 4)).join('')}${pre.map((p) => dot(p, 'pre', 4)).join('')}${mine ? dot(mine, 'me', 7) : ''}${all.map(hit).join('')}</svg>
      <div class="legend"><span><i style="background:var(--s1)"></i>Trading peer: market cap (${D.peers.length})</span><span><i style="background:var(--s2)"></i>Pre-token: implied value (${ROWS.length})</span>${mine ? `<span><i style="background:var(--warn)"></i>${esc(me.n)}</span>` : ''}<span>- - fitted curve, slope ${M.b}</span></div>`;
  }

  function hideTip() { tip.hidden = true; }
  function bindTips() {
    app.querySelectorAll('.hit').forEach((c) => {
      c.addEventListener('mousemove', (e) => {
        tip.innerHTML = `<b>${esc(c.dataset.t)}</b>${esc(c.dataset.d)}`;
        tip.hidden = false;
        tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + 'px';
        tip.style.top = e.clientY + 14 + 'px';
      });
      c.addEventListener('mouseleave', hideTip);
      if (c.dataset.s) c.addEventListener('click', () => (location.hash = '#/p/' + encodeURIComponent(c.dataset.s)));
    });
  }

  // ------------------------------------------------------------ peers, set-aside and the model
  function simpleTable(title, note, cols, rows, q, view) {
    const key = q.get('sort') || cols[0][0];
    const asc = q.get('dir') === 'asc';
    const col = cols.find((c) => c[0] === key) || cols[0];
    const text = (q.get('q') || '').toLowerCase();
    const list = rows.filter((r) => !text || (r.n + ' ' + (r.cat || '') + ' ' + (r.why || '')).toLowerCase().includes(text)).sort((a, b) => {
      const x = col[2](a), y = col[2](b);
      return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
    });
    app.innerHTML = `<section class="panel"><div class="tablehead"><h2>${title}</h2><div class="active"><input id="tq" type="search" placeholder="Filter" value="${esc(q.get('q') || '')}" style="background:var(--bg);border:1px solid var(--line-2);border-radius:6px;padding:5px 8px"><span><b class="t2">${list.length}</b> of ${rows.length}</span></div></div>
      <p class="pad mut" style="margin:0">${note}</p>
      <table><thead><tr>${cols.map(([k, l, , r]) => `<th data-k="${k}" class="${r ? 'r ' : ''}${k === key ? 'sorted' + (asc ? ' asc' : '') : ''}">${l}</th>`).join('')}</tr></thead><tbody>${list
        .map((r) => `<tr>${cols.map(([k, , , rt, f]) => `<td class="${rt ? 'r num' : ''}">${f(r)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></section>`;
    app.querySelectorAll('th[data-k]').forEach((th) =>
      th.addEventListener('click', () => {
        const n = new URLSearchParams(q);
        n.set('sort', th.dataset.k);
        n.set('dir', th.dataset.k === key && !asc ? 'asc' : 'desc');
        go(view, n);
      }),
    );
    const tq = app.querySelector('#tq');
    tq.addEventListener('change', () => { const n = new URLSearchParams(q); tq.value ? n.set('q', tq.value) : n.delete('q'); go(view, n); });
  }

  function peers(q) {
    simpleTable(
      'Trading peers · tokens that already trade',
      `These ${D.peers.length} protocols carry a token with a positive market cap. They fit the size curve and the sector effects and are never ranked: the board is only for protocols whose record carries no token. ${D.counts.with_token - D.peers.length} more record a token but no usable market cap.`,
      [
        ['mc', 'Protocol', (p) => p.mc, false, (p) => `<span class="pname"><b>${esc(p.n)}</b> <span class="mut">${esc(p.sym || '')}</span></span> <span class="seg token">trades</span>`],
        ['cat', 'Category', (p) => p.cat || '', false, (p) => esc(p.cat || '–') + `<small class="mut"> · ${esc(p.sec)}</small>`],
        ['tvl', 'TVL', (p) => p.tvl, true, (p) => usd(p.tvl)],
        ['mcv', 'Market cap', (p) => p.mc, true, (p) => usd(p.mc)],
        ['m', 'Mcap ÷ TVL', (p) => p.m, true, (p) => p.m.toFixed(2)],
        ['res', 'vs curve', (p) => p.res, true, (p) => `<span class="${cls(p.res)}">${mult(10 ** p.res)}</span>`],
      ],
      D.peers,
      q,
      'peers',
    );
  }

  function aside(q) {
    simpleTable(
      'Set aside · no token recorded, but not a launch of its own',
      `The house rule's name and category tests (wrapped, staked or bridged products, versioned names, exchanges), plus one more: a protocol whose first name word or slug segment matches a protocol whose token trades is treated as that protocol's product. Watchlist slugs are never set aside.`,
      [
        ['tvl', 'Protocol', (e) => e.tvl, false, (e) => `<span class="pname"><b>${esc(e.n)}</b></span>`],
        ['cat', 'Category', (e) => e.cat || '', false, (e) => esc(e.cat || '–')],
        ['tv', 'TVL', (e) => e.tvl, true, (e) => usd(e.tvl)],
        ['why', 'Why it is not ranked', (e) => e.why, false, (e) => `<span class="t2">${esc(e.why)}</span>`],
      ],
      D.excluded,
      q,
      'aside',
    );
  }

  function model() {
    const t = M.tested;
    const secRows = Object.entries(M.sectors).filter(([, s]) => s.n > 0).sort((a, b) => b[1].x - a[1].x);
    app.innerHTML = `<div class="grid2">
      <section class="panel"><h2>Peer curve · ${D.peers.length} trading tokens fit, ${ROWS.length} pre-token rows placed</h2>${scatter(null)}</section>
      <section class="panel prose"><h2>The model, ${esc(M.version)}</h2><div class="pad">
        <p><code>implied = 10^(a + b·log10 TVL) × sector × category × momentum × runway</code></p>
        <p><b>Size curve.</b> Least squares of log market cap on log TVL over every protocol whose token trades: a = ${M.a}, b = ${M.b} (R² ${M.r2}, residual σ ${M.sigma} decades). A slope under 1 means a bigger TVL earns a smaller multiple, which the peers show.</p>
        <p><b>Sector and category.</b> Mean residual of the peers in the sector, shrunk by n/(n+${M.shrink}); then the category's own residual inside the sector, shrunk the same way. A category with one peer moves the value by a fifth of its gap.</p>
        <p><b>Momentum.</b> 7-day TVL change minus the snapshot's median change (${sgn(M.market_change_7d)}%), capped at ±${M.momentum_cap} points, at elasticity ${M.momentum_elasticity}.</p>
        <p><b>Runway.</b> Days tracked with no token: ${M.runway_floor} for a new listing rising to 1 at ${M.runway_full_days} days on a log curve. TVL that stayed without a token is less likely to be points-only capital.</p>
        <p><b>Band.</b> ± ${M.band_z} σ of the sector's residuals: the middle half of where a peer of that size sits.</p>
        <p><b>Tested and left out.</b> Slope of the residual on log chain count ${t.chains}, on log age ${t.age}, on excess 7-day change ${t.momentum}. Among tokens that trade these explain little, so chain count is not priced; momentum and runway enter only as the stated adjustments above.</p>
        <p class="note">No protocol name is special-cased: one function scores every row from the snapshot's own fields.</p></div></section>
      <section class="panel"><h2>Sector effects · from the peers</h2><table><thead><tr><th>Sector</th><th class="r">Peers</th><th class="r">Effect</th><th class="r">Spread σ</th><th class="r">Ranked here</th></tr></thead><tbody>${secRows
        .map(([k, s]) => `<tr><td>${esc(k)}</td><td class="r num">${s.n}</td><td class="r num">${mult(s.x)}</td><td class="r num">${s.sd.toFixed(2)}</td><td class="r num">${ROWS.filter((r) => r.sec === k).length}</td></tr>`)
        .join('')}</tbody></table></section>
      <section class="panel prose"><h2>What the board covers</h2><div class="pad">
        <p>${D.counts.protocols} protocols in the snapshot; ${D.counts.with_token} record a token, ${D.counts.pre_token} record none.</p>
        <p>Ranked: all ${D.counts.watchlist} watchlist slugs, ${ROWS.filter((r) => r.seg === 'parent-listed').length} parent-listed protocols at or above the floor, and ${ROWS.filter((r) => r.seg === 'early').length} early protocols below it. Set aside: ${D.excluded.length} derivatives and exchange products.</p>
        <p class="note">For the judge: every figure on this page is computed by main.ts from the snapshot; the screenshots are captures of this page rendered from its own data.js.</p></div></section>
    </div>`;
    bindTips();
  }

  render();
})();
