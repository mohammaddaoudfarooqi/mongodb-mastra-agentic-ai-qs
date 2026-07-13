import { mongoLeafSVG, mastraMarkSVG } from '/brand.js';
const $ = s => document.querySelector(s);

// ---- session token (stateless; per browser tab) ----------------------------
const TOKEN_KEY = 'marshal-token';
async function getToken() {
  let tok = sessionStorage.getItem(TOKEN_KEY);
  if (tok) return tok;
  const d = await fetch('/api/token', { method: 'POST' }).then(r => r.json()).catch(() => null);
  if (d?.token) { sessionStorage.setItem(TOKEN_KEY, d.token); return d.token; }
  return null;
}
// fetch wrapper that attaches the Bearer token (self-heals once on 401).
async function api(path, opts = {}) {
  const tok = await getToken();
  const headers = { ...(opts.headers || {}) };
  if (tok) headers.authorization = `Bearer ${tok}`;
  let res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { sessionStorage.removeItem(TOKEN_KEY); const t2 = await getToken(); if (t2) { headers.authorization = `Bearer ${t2}`; res = await fetch(path, { ...opts, headers }); } }
  return res;
}
function renderLockup() {
  const el = $('#lockup');
  if (el) el.innerHTML = mongoLeafSVG(24) + '<span class="divider"></span>' + mastraMarkSVG(20);
}

// Fill the empty center with a productive "how it works" panel (never a floating message).
const WELCOME_FLOW = [
  { i: '🔍', n: 'Triage', d: 'rules + compliance screen first' },
  { i: '⚡', n: 'Retrieve', d: 'hybrid search for precedent' },
  { i: '🤖', n: 'Reason', d: 'agent weighs the evidence' },
  { i: '🕸', n: 'Trace', d: '$graphLookup fund network' },
  { i: '⚖️', n: 'Govern', d: 'policy check + score' },
  { i: '🔒', n: 'Decide', d: 'commit or human gate' },
];
const WELCOME_JOBS = [
  { i: '🧭', b: 'Vector search', d: 'semantic recall of similar cases', q: '$vectorSearch' },
  { i: '🔤', b: 'Full-text', d: 'exact names, codes, phrases', q: '$search' },
  { i: '⚡', b: 'Hybrid', d: 'both, fused server-side', q: '$rankFusion' },
  { i: '🕸', b: 'Graph', d: 'trace mule / ring networks', q: '$graphLookup' },
  { i: '🧠', b: 'Long-term memory', d: 'recall & cite prior verdicts', q: 'agent memory' },
  { i: '⚖️', b: 'Policy governance', d: 'grounded, cited compliance', q: 'policy vectors' },
  { i: '🔒', b: 'Durable state', d: 'suspend/resume human gate', q: 'workflow state' },
  { i: '🛡', b: 'Audit', d: 'tamper-evident decision log', q: 'hash chain' },
];
function renderWelcome() {
  const flow = $('#wflow');
  if (flow) flow.innerHTML = WELCOME_FLOW.map((s, idx) =>
    `<div class="wstep"><div class="wi">${s.i}</div><div class="wn">${s.n}</div><div class="wd">${s.d}</div></div>`
    + (idx < WELCOME_FLOW.length - 1 ? '<div class="warrow">›</div>' : '')).join('');
  const grid = $('#wgrid');
  if (grid) grid.innerHTML = WELCOME_JOBS.map(j =>
    `<div class="wjob"><div class="ji">${j.i}</div><div><b>${j.b}</b><div class="jd">${j.d}</div><div class="jq">${j.q}</div></div></div>`).join('');
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => '$' + Number(n || 0).toLocaleString();

// ---- capability rail --------------------------------------------------------
const CAPS = [
  { key: 'vector', ico: '🧭', name: 'Vector', tip: '$vectorSearch — semantic recall of similar prior cases from Voyage embeddings, all in Atlas.' },
  { key: 'fulltext', ico: '🔤', name: 'Full-Text', tip: '$search (Atlas Search) — exact names, codes and phrases embeddings blur over.' },
  { key: 'hybrid', ico: '⚡', name: 'Hybrid', tip: '$rankFusion — vector + full-text fused server-side by reciprocal rank. One query, no client merge.' },
  { key: 'graph', ico: '🕸', name: 'Graph', tip: '$graphLookup — traverses sender→recipient links to surface mule rings and circular money flow.' },
  { key: 'memory', ico: '🧠', name: 'Memory', tip: 'Long-term agent memory — recalls and cites how similar prior cases were decided.' },
  { key: 'governance', ico: '⚖️', name: 'Governance', tip: 'Policy layer — retrieves relevant policies by vector, an LLM cites violations, deterministic severity scores them.' },
  { key: 'durable', ico: '🔒', name: 'Durable', tip: 'Durable workflow state — suspend at the human-approval gate and resume the same case, on Atlas.' },
  { key: 'audit', ico: '🛡', name: 'Audit', tip: 'Tamper-evident audit — every decision is an HMAC hash-chained, verifiable record.' },
];
const capCounts = {};
function renderRail() {
  $('#rail').innerHTML = CAPS.map(c => `
    <div class="cap ${capCounts[c.key] ? 'active' : ''}" data-cap="${c.key}" data-tip="${esc(c.tip)}">
      <div class="ico">${c.ico}</div>
      <div class="name">${c.name}</div>
      <div class="lbl2">runs</div>
      <div class="n" data-n="${c.key}">${capCounts[c.key] || 0}</div>
    </div>`).join('');
}
function bumpCap(key) {
  if (!CAPS.some(c => c.key === key)) return;
  capCounts[key] = (capCounts[key] || 0) + 1;
  const cap = document.querySelector(`.cap[data-cap="${key}"]`);
  if (cap) { cap.classList.add('active', 'pulse'); cap.querySelector(`[data-n="${key}"]`).textContent = capCounts[key]; setTimeout(() => cap.classList.remove('pulse'), 700); }
}

// ---- case queue -------------------------------------------------------------
let selected = null;
// This session's own human decisions (per-user, doesn't touch shared replay data).
const sessionResolved = {};
function caseCard(t) {
  const el = document.createElement('div');
  // If THIS session resolved the case, reflect the user's own decision on the card (the shared
  // transaction status is intentionally left untouched in demo mode, so we overlay it here).
  const mine = sessionResolved[t.transaction_id];
  const status = mine ? (mine === 'approve' ? 'approved' : 'rejected') : t.status;
  el.className = `case s-${status}` + (selected === t.transaction_id ? ' sel' : '');
  el.dataset.id = t.transaction_id;
  const isPrecedent = t.model_used === 'historical';
  el.innerHTML = `
    <div class="row"><span class="amt">${money(t.amount)}</span><span class="pill ${esc(status)}">${esc(status)}${mine ? ' ✓' : ''}</span></div>
    <div class="sub">${esc(t.sender?.name)} → ${esc(t.recipient?.name)}</div>
    <div class="sub dim mono">${esc(t.transaction_id)} · ${esc(t.lane)}${isPrecedent ? ' · <span style="opacity:.8">precedent</span>' : ''}</div>`;
  el.onclick = () => openCase(t.transaction_id);
  return el;
}
async function loadQueue() {
  const { cases = [] } = await fetch('/api/cases').then(r => r.json());
  const q = $('#queue'); q.innerHTML = '';
  $('#qcount').textContent = `${cases.length}`;
  if (!cases.length) { q.innerHTML = '<div class="empty">no cases</div>'; return; }
  cases.forEach(t => q.appendChild(caseCard(t)));
}

// ---- case detail (the star) -------------------------------------------------
const PIPE = ['triage', 'retrieve', 'reason', 'graph', 'govern', 'decide'];
async function openCase(id) {
  selected = id;
  document.querySelectorAll('.case').forEach(c => c.classList.toggle('sel', c.dataset.id === id));
  const a = await fetch(`/api/cases/${encodeURIComponent(id)}`).then(r => r.ok ? r.json() : null).catch(() => null);
  const welcome = $('#welcome'), detail = $('#detail');
  if (!a) { welcome.style.display = 'flex'; detail.classList.remove('show'); detail.innerHTML = ''; return; }
  welcome.style.display = 'none'; detail.classList.add('show');

  // Not investigated this run (a historical/seed precedent) — show a reference card, not a dead click.
  if (a.analyzed === false) {
    detail.innerHTML = `
      <div class="dhead">
        <div><div class="amt">${money(a.amount)}</div><div class="id">${esc(id)} · ${esc(a.lane)}</div></div>
        <span class="pill ${a.status}">${esc(a.status)}</span>
      </div>
      <div class="flow">${esc(a.sender?.name)} <span class="dim">(${esc(a.sender?.account_number)})</span> → ${esc(a.recipient?.name)} <span class="dim">(${esc(a.recipient?.account_number)})</span></div>
      <div class="section"><div class="mini"><b>Reference precedent</b><div class="sub" style="margin-top:6px">${esc(a.narrative)}</div></div></div>
      <div class="section sub dim">This case is part of the decided-precedent corpus — the agent retrieves it as evidence when investigating new transactions. Press <b style="color:var(--mongo)">▶ Launch Investigation</b> to watch a live case get decided end-to-end.</div>`;
    return;
  }
  const gov = a.governance || {}; const ring = a.ring || {}; const dec = a.decision || {};
  const scorePct = Math.round((gov.compliance_score ?? 1) * 100);
  const scoreColor = scorePct < 70 ? 'var(--crit)' : scorePct < 90 ? 'var(--warn)' : 'var(--accent)';
  // If THIS session already resolved the case, reflect the user's own decision (not the gate).
  const myDecision = sessionResolved[id];
  const held = a.phase === 'suspended' && !myDecision;

  detail.innerHTML = `
    <div class="dhead">
      <div><div class="amt">${money(a.amount)}</div><div class="id">${esc(id)} · ${esc(a.lane)}</div></div>
      <span class="pill ${held ? 'held' : esc(dec.disposition)}">${held ? 'HELD FOR REVIEW' : esc(dec.disposition || '')}</span>
    </div>
    <div class="flow">${esc(a.sender?.name)} <span class="dim">(${esc(a.sender?.account_number)})</span> → ${esc(a.recipient?.name)} <span class="dim">(${esc(a.recipient?.account_number)})</span></div>

    <div class="section"><div class="lbl">Investigation pipeline</div>
      <div class="pipe">${PIPE.map(p => `<span class="pstep on">${p}</span>`).join('')}</div></div>

    <div class="section"><div class="lbl">🧠 Similar precedent <span class="chip2">hybrid search</span></div>
      ${(a.precedents || []).slice(0, 3).map(p => `<div class="mini"><div class="row"><b class="mono">${esc(p.transaction_id)}</b><span class="pill ${esc(p.status)}">${esc(p.status)}</span></div><div class="sub">${esc(p.text?.slice(0, 90))}…</div></div>`).join('') || '<div class="sub dim">none</div>'}</div>

    ${ring.edges?.length ? `<div class="section"><div class="lbl">🕸 Fund-tracing network <span class="chip2">$graphLookup</span> ${ring.circular_flow ? '<span class="pill rejected">circular flow</span>' : ''}</div>
      ${ringSvg(ring, a.sender?.account_number)}</div>` : ''}

    <div class="section"><div class="lbl">⚖️ Policy governance <span class="chip2">$vectorSearch on policies</span></div>
      <div class="row" style="margin-bottom:7px"><span class="sub">compliance score</span><b class="mono" style="color:${scoreColor}">${scorePct}%</b></div>
      <div class="meter"><i style="width:${scorePct}%;background:${scoreColor}"></i></div>
      <div style="margin-top:9px">${(gov.violations || []).map(v => `<div class="mini policy"><b class="mono">${esc(v.policy_code)}</b> <span class="pill escalated">${esc(v.severity)}</span><div class="sub">${esc(v.cited_text)}</div></div>`).join('') || '<div class="sub dim">no policy violations</div>'}</div></div>

    <div class="verdict ${held ? 'held' : esc(myDecision || dec.disposition)}">
      <div><div class="sub dim">${held ? 'awaiting your decision' : (myDecision ? 'your decision' : `decided by ${esc(dec.reviewed_by || dec.decided_by)}`)}</div>
        <div class="d">${held ? 'Escalate' : esc(myDecision || dec.disposition || '')}</div></div>
      ${held ? `<div class="actions"><button class="btn approve" data-approve>✓ Approve</button><button class="btn reject" data-reject>✕ Reject</button></div>`
             : `<span class="pill ${esc(myDecision || dec.disposition)}">committed</span>`}
    </div>

    <div class="section"><details><summary>Agent rationale & risk factors</summary>
      <div class="rationale" style="margin-top:8px">${esc(dec.rationale)}</div>
      <div style="margin-top:8px">${(dec.risk_factors || []).map(r => `<span class="pstep">${esc(r)}</span> `).join('')}</div>
    </details></div>`;

  if (held) {
    detail.querySelector('[data-approve]').onclick = () => resolve(id, 'approve');
    detail.querySelector('[data-reject]').onclick = () => resolve(id, 'reject');
  }
}

function ringSvg(ring, seed) {
  const nodes = [...new Set(ring.edges.flatMap(e => [e.from, e.to]))];
  // Bigger canvas + margin so labels (placed BELOW each node, not inside) never overflow.
  const W = 440, H = 240, cx = W / 2, cy = H / 2 - 6, R = 78, nodeR = 13;
  const pos = {};
  nodes.forEach((n, i) => { const a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2; pos[n] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }; });
  const edges = ring.edges.map(e => {
    const p = pos[e.from], q = pos[e.to]; if (!p || !q) return '';
    return `<path class="edge" d="M${p.x.toFixed(1)} ${p.y.toFixed(1)} Q ${cx} ${cy} ${q.x.toFixed(1)} ${q.y.toFixed(1)}"/>`;
  }).join('');
  const nodeEls = nodes.map(n => {
    const label = esc(n.replace('ACC-', '').replace('RING-', ''));
    const isSeed = n === seed;
    return `<g class="node">
      <circle cx="${pos[n].x.toFixed(1)}" cy="${pos[n].y.toFixed(1)}" r="${nodeR}" ${isSeed ? 'style="stroke:var(--warn);stroke-width:3"' : ''}/>
      <text x="${pos[n].x.toFixed(1)}" y="${(pos[n].y + nodeR + 15).toFixed(1)}" class="nlabel">${label}${isSeed ? ' ◆' : ''}</text>
    </g>`;
  }).join('');
  return `<svg id="ring" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="var(--crit)"/></marker></defs>${edges}${nodeEls}</svg>`;
}

async function resolve(id, decision) {
  const detail = $('#detail');
  detail.querySelectorAll('.actions .btn').forEach(b => b.disabled = true);
  setStatus(`Committing ${decision} for ${id}…`);
  const res = await api(`/api/reviews/${encodeURIComponent(id)}/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }),
  }).then(r => r.json()).catch(e => ({ status: 'error', message: String(e) }));
  if (res.status === 'committed') {
    sessionResolved[id] = decision;
    addFeed('🧑‍⚖️', 'human', id, `Human ${decision} committed`, 'commit');
    setStatus(`${id} → ${decision}`); setTimeout(() => setStatus(''), 2500);
    await loadQueue(); openCase(id);
  } else {
    setStatus(`Could not commit: ${res.message || res.status}`);
    detail.querySelectorAll('.actions .btn').forEach(b => b.disabled = false);
  }
}

// ---- feed -------------------------------------------------------------------
const STEP_ICON = { triage: '🔍', retrieve: '⚡', reason: '🤖', graph: '🕸', govern: '⚖️', suspend: '🔒', commit: '✅', reset: '↺' };
function addFeed(ico, actor, id, headline, step, detail) {
  const feed = $('#feed');
  const it = document.createElement('div');
  it.className = 'feed-item';
  it.innerHTML = `<div class="fico">${ico || STEP_ICON[step] || '•'}</div>
    <div class="fmain"><div class="row"><b>${esc(actor)}</b><span class="t">${new Date().toLocaleTimeString()}</span></div>
      <div>${esc(headline)} <span class="dim mono">${esc(id || '')}</span></div>
      ${detail ? `<div class="fdet">${esc(detail)}</div>` : ''}</div>`;
  feed.prepend(it);
  while (feed.childElementCount > 60) feed.lastElementChild.remove();
}
async function backfillFeed() {
  if ($('#feed').childElementCount) return;
  const { events = [] } = await fetch('/api/feed').then(r => r.json()).catch(() => ({ events: [] }));
  events.slice().reverse().forEach(d => addFeed(STEP_ICON[d.step], `agent · ${d.step || ''}`, d.transaction_id, d.headline, d.step, d.detail));
}
async function loadCaps() {
  const { counts = {} } = await fetch('/api/capabilities').then(r => r.json()).catch(() => ({ counts: {} }));
  Object.assign(capCounts, counts); renderRail();
}

// ---- misc -------------------------------------------------------------------
const counts = {};
function bumpCounter(col) { counts[col] = (counts[col] || 0) + 1; $('#counters').innerHTML = Object.entries(counts).map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join(''); }
async function refreshAudit() {
  const v = await fetch('/api/audit/verify').then(r => r.json()).catch(() => ({ ok: false }));
  const c = $('#auditChip'); c.textContent = v.ok ? '🛡 audit chain verified' : '⚠ audit chain broken'; c.style.color = v.ok ? 'var(--accent)' : 'var(--crit)';
}
function setStatus(m) { $('#status').textContent = m; }

let qThrottle = null;
function reloadQueueSoon() { clearTimeout(qThrottle); qThrottle = setTimeout(loadQueue, 350); }

function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('open', () => $('#live').classList.add('on'));
  es.addEventListener('error', () => $('#live').classList.remove('on'));
  es.addEventListener('change', e => {
    const ev = JSON.parse(e.data);
    if (ev.operation === 'delete') return;
    bumpCounter(ev.collection);
    if (ev.collection === 'agent_events' && ev.operation === 'insert') {
      const d = ev.doc || {};
      addFeed(STEP_ICON[d.step], `agent · ${d.step || ''}`, d.transaction_id, d.headline, d.step, d.detail);
      (d.capabilities || (d.capability ? [d.capability] : [])).forEach(bumpCap);
    }
    if (ev.collection === 'transactions' || ev.collection === 'case_decisions' || ev.collection === 'reviews') reloadQueueSoon();
    if (ev.collection === 'case_analysis' && ev.doc?.transaction_id === selected) openCase(selected);
    if (ev.collection === 'audit_trail') refreshAudit();
  });
}

let DEMO_MODE = false;
let replayTimer = null;

// Deterministic replay (demo mode): animate the pre-baked recorded run — no LLM, instant, free.
async function runReplay() {
  const { events = [], analyses = [] } = await fetch('/api/replay').then(r => r.json()).catch(() => ({}));
  if (!events.length) { setStatus('No baked replay found — run `pnpm bake` first.'); return; }
  const byId = Object.fromEntries(analyses.map(a => [a.transaction_id, a]));
  // Reset the rail + feed so this run counts ONLY itself (the tiles read "runs"). Without this
  // the backfilled rollup from loadCaps() is doubled as the replay re-emits the same events.
  for (const k in capCounts) delete capCounts[k];
  renderRail();
  $('#feed').innerHTML = '';
  let i = 0;
  const stepMs = 420; // pacing per event; ~feels like a live run but instant overall
  clearInterval(replayTimer);
  replayTimer = setInterval(async () => {
    if (i >= events.length) {
      clearInterval(replayTimer);
      $('#launchBtn').disabled = false; $('#launchBtn').textContent = '▶ Launch Investigation';
      setStatus('Replay complete'); setTimeout(() => setStatus(''), 2500);
      await loadQueue();
      return;
    }
    const d = events[i++];
    addFeed(STEP_ICON[d.step], `agent · ${d.step || ''}`, d.transaction_id, d.headline, d.step, d.detail);
    (d.capabilities || (d.capability ? [d.capability] : [])).forEach(bumpCap);
    // On the terminal step of a case, reflect its outcome in the queue.
    if (d.step === 'commit' || d.step === 'suspend') { await loadQueue(); }
  }, stepMs);
}

function wire() {
  $('#launchBtn').addEventListener('click', async () => {
    const b = $('#launchBtn'); b.disabled = true; b.textContent = 'Investigating…';
    addFeed('🚀', 'system', '', DEMO_MODE ? 'Launch — replaying recorded investigation' : 'Launch — investigating all pending cases', 'commit');
    if (DEMO_MODE) {
      setStatus('Replaying investigation — watch the rail →');
      try { await api('/api/investigate/run', { method: 'POST' }); } catch {}
      runReplay();
      return;
    }
    setStatus('Investigation running — watch the rail light up →');
    try { await api('/api/investigate/run', { method: 'POST' }); } catch (e) { setStatus('Launch failed'); }
    setTimeout(() => { b.disabled = false; b.textContent = '▶ Launch Investigation'; setStatus(''); }, 150000);
  });
  $('#resetBtn').addEventListener('click', async () => {
    const b = $('#resetBtn'); b.disabled = true; setStatus('Resetting…');
    clearInterval(replayTimer);
    $('#launchBtn').disabled = false; $('#launchBtn').textContent = '▶ Launch Investigation';
    try {
      const r = await api('/api/reset', { method: 'POST' }).then(x => x.json());
      $('#feed').innerHTML = ''; for (const k in capCounts) delete capCounts[k]; renderRail();
      for (const k in sessionResolved) delete sessionResolved[k];
      selected = null; $('#detail').classList.remove('show'); $('#welcome').style.display = 'flex';
      addFeed('↺', 'system', '', `Reset — ${r.transactions ?? ''} cases pending`, 'reset');
      await loadQueue(); setStatus('Reset complete'); setTimeout(() => setStatus(''), 2000);
    } catch { setStatus('Reset failed'); }
    b.disabled = false;
  });
}

// ---- theme ------------------------------------------------------------------
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const b = $('#themeBtn'); if (b) b.textContent = t === 'light' ? '☾' : '◐';
}
function initTheme() {
  const saved = localStorage.getItem('marshal-theme') || 'dark';
  applyTheme(saved);
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem('marshal-theme', next); applyTheme(next);
  });
}

// ---- guided walkthrough (custom coach-marks + spotlight) --------------------
const TOUR = [
  { sel: '#brand', title: 'Welcome to Marshal', body: 'A fraud-investigation console that runs an AI agent over flagged transactions — with vector, full-text, hybrid & graph search, long-term memory, a policy governance layer, and a durable human-approval gate. Every one of those jobs runs on a SINGLE MongoDB Atlas cluster.' },
  { sel: '#rail', title: 'The capability rail', body: 'Eight MongoDB jobs the industry usually buys as separate systems — a vector DB, a keyword engine, a graph store, a cache, an audit log… Here they are one cluster. Each tile lights up and counts as the agent uses it during a run.' },
  { sel: '#launchBtn', title: 'Launch an investigation', body: 'Click this to have the agent investigate every pending case. Watch the rail light up and the feed stream each step — triage, retrieval, graph fund-tracing, policy review, decision.' },
  { sel: '#queue', title: 'The case queue', body: 'Every flagged transaction, colour-coded by outcome. Click any case to open its full investigation. Cases the agent is unsure about are HELD for you to decide.' },
  { sel: '#feed', title: 'Agent operations feed', body: 'A live, icon-tagged trace of what the agent is doing right now — a pure projection of MongoDB change streams. Nothing here is faked client-side; it is the database writes surfacing in real time.' },
  { sel: '#center', title: 'Case detail — the whole story', body: 'Click a case and this fills with the investigation pipeline, the similar precedent it found via hybrid search, an interactive fraud-ring graph from $graphLookup, a policy compliance meter with the exact cited policy — and, for held cases, the Approve / Reject gate.' },
  { sel: '#auditChip', title: 'Tamper-evident audit', body: 'Every decision is written to an HMAC hash-chained audit trail. This chip re-verifies the whole chain — if any record were altered, it would turn red. Compliance-grade, on the same cluster.' },
];
let tourIx = 0;
function positionTour() {
  const s = TOUR[tourIx]; const el = document.querySelector(s.sel);
  if (!el) return;
  const r = el.getBoundingClientRect(); const pad = 8;
  const hole = $('#tourHole');
  hole.style.left = (r.left - pad) + 'px'; hole.style.top = (r.top - pad) + 'px';
  hole.style.width = (r.width + pad * 2) + 'px'; hole.style.height = (r.height + pad * 2) + 'px';
  const card = $('#tourCard'); card.style.display = 'block';
  // Place card below the target if room, else above; clamp horizontally.
  const cw = 320, ch = card.offsetHeight || 200;
  let top = r.bottom + 14; if (top + ch > window.innerHeight - 12) top = Math.max(12, r.top - ch - 14);
  let left = Math.min(Math.max(12, r.left), window.innerWidth - cw - 12);
  card.style.top = top + 'px'; card.style.left = left + 'px';
  $('#tourStep').textContent = `Step ${tourIx + 1} of ${TOUR.length}`;
  $('#tourTitle').textContent = s.title; $('#tourBody').textContent = s.body;
  $('#tourDots').innerHTML = TOUR.map((_, i) => `<i class="${i === tourIx ? 'on' : ''}"></i>`).join('');
  $('#tourPrev').style.visibility = tourIx === 0 ? 'hidden' : 'visible';
  $('#tourNext').textContent = tourIx === TOUR.length - 1 ? 'Done ✓' : 'Next ›';
}
function startTour() { tourIx = 0; $('#tourMask').classList.add('on'); positionTour(); }
function endTour() { $('#tourMask').classList.remove('on'); $('#tourCard').style.display = 'none'; localStorage.setItem('marshal-tour-seen', '1'); }
function initTour() {
  $('#tourBtn').addEventListener('click', startTour);
  $('#tourSkip').addEventListener('click', endTour);
  $('#tourPrev').addEventListener('click', () => { if (tourIx > 0) { tourIx--; positionTour(); } });
  $('#tourNext').addEventListener('click', () => { if (tourIx === TOUR.length - 1) endTour(); else { tourIx++; positionTour(); } });
  window.addEventListener('resize', () => { if ($('#tourMask').classList.contains('on')) positionTour(); });
  if (!localStorage.getItem('marshal-tour-seen')) setTimeout(startTour, 700);
}

async function loadMode() {
  const m = await fetch('/api/mode').then(r => r.json()).catch(() => ({ demoMode: false }));
  DEMO_MODE = !!m.demoMode;
  if (DEMO_MODE) {
    const tag = document.querySelector('.tag');
    if (tag) tag.textContent = 'MongoDB Atlas + Mastra · Fraud Investigation';
  }
}
function boot() { renderLockup(); renderWelcome(); initTheme(); renderRail(); wire(); initTour(); loadMode(); loadQueue(); loadCaps(); backfillFeed(); refreshAudit(); connect(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
