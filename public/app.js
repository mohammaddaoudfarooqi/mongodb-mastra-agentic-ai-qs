const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => '$' + Number(n || 0).toLocaleString();

// ---- capability rail --------------------------------------------------------
const CAPS = [
  { key: 'vector', ico: '🧭', name: 'Vector' },
  { key: 'fulltext', ico: '🔤', name: 'Full-Text' },
  { key: 'hybrid', ico: '⚡', name: 'Hybrid' },
  { key: 'graph', ico: '🕸', name: 'Graph' },
  { key: 'memory', ico: '🧠', name: 'Memory' },
  { key: 'governance', ico: '⚖️', name: 'Governance' },
  { key: 'durable', ico: '🔒', name: 'Durable' },
  { key: 'audit', ico: '🛡', name: 'Audit' },
];
const capCounts = {};
function renderRail() {
  $('#rail').innerHTML = CAPS.map(c => `
    <div class="cap ${capCounts[c.key] ? 'active' : ''}" data-cap="${c.key}">
      <div class="ico">${c.ico}</div><div class="name">${c.name}</div>
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
function caseCard(t) {
  const el = document.createElement('div');
  el.className = `case s-${t.status}` + (selected === t.transaction_id ? ' sel' : '');
  el.dataset.id = t.transaction_id;
  el.innerHTML = `
    <div class="row"><span class="amt">${money(t.amount)}</span><span class="pill ${t.status}">${t.status}</span></div>
    <div class="sub">${esc(t.sender?.name)} → ${esc(t.recipient?.name)}</div>
    <div class="sub dim mono">${esc(t.transaction_id)} · ${esc(t.lane)}</div>`;
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
  const gov = a.governance || {}; const ring = a.ring || {}; const dec = a.decision || {};
  const scorePct = Math.round((gov.compliance_score ?? 1) * 100);
  const scoreColor = scorePct < 70 ? 'var(--crit)' : scorePct < 90 ? 'var(--warn)' : 'var(--accent)';
  const held = a.phase === 'suspended';

  detail.innerHTML = `
    <div class="dhead">
      <div><div class="amt">${money(a.amount)}</div><div class="id">${esc(id)} · ${esc(a.lane)}</div></div>
      <span class="pill ${held ? 'held' : dec.disposition}">${held ? 'HELD FOR REVIEW' : (dec.disposition || '')}</span>
    </div>
    <div class="flow">${esc(a.sender?.name)} <span class="dim">(${esc(a.sender?.account_number)})</span> → ${esc(a.recipient?.name)} <span class="dim">(${esc(a.recipient?.account_number)})</span></div>

    <div class="section"><div class="lbl">Investigation pipeline</div>
      <div class="pipe">${PIPE.map(p => `<span class="pstep on">${p}</span>`).join('')}</div></div>

    <div class="section"><div class="lbl">🧠 Similar precedent <span class="chip2">hybrid search</span></div>
      ${(a.precedents || []).slice(0, 3).map(p => `<div class="mini"><div class="row"><b class="mono">${esc(p.transaction_id)}</b><span class="pill ${p.status}">${p.status}</span></div><div class="sub">${esc(p.text?.slice(0, 90))}…</div></div>`).join('') || '<div class="sub dim">none</div>'}</div>

    ${ring.edges?.length ? `<div class="section"><div class="lbl">🕸 Fund-tracing network <span class="chip2">$graphLookup</span> ${ring.circular_flow ? '<span class="pill rejected">circular flow</span>' : ''}</div>
      ${ringSvg(ring, a.sender?.account_number)}</div>` : ''}

    <div class="section"><div class="lbl">⚖️ Policy governance <span class="chip2">$vectorSearch on policies</span></div>
      <div class="row" style="margin-bottom:7px"><span class="sub">compliance score</span><b class="mono" style="color:${scoreColor}">${scorePct}%</b></div>
      <div class="meter"><i style="width:${scorePct}%;background:${scoreColor}"></i></div>
      <div style="margin-top:9px">${(gov.violations || []).map(v => `<div class="mini policy"><b class="mono">${esc(v.policy_code)}</b> <span class="pill escalated">${esc(v.severity)}</span><div class="sub">${esc(v.cited_text)}</div></div>`).join('') || '<div class="sub dim">no policy violations</div>'}</div></div>

    <div class="verdict ${held ? 'held' : dec.disposition}">
      <div><div class="sub dim">${held ? 'awaiting human decision' : `decided by ${esc(dec.decided_by)}`}</div>
        <div class="d">${held ? 'Escalate' : (dec.disposition || '')}</div></div>
      ${held ? `<div class="actions"><button class="btn approve" data-approve>✓ Approve</button><button class="btn reject" data-reject>✕ Reject</button></div>`
             : `<span class="pill ${dec.disposition}">committed</span>`}
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
  const W = 320, H = 150, cx = W / 2, cy = H / 2, r = 55;
  const pos = {}; nodes.forEach((n, i) => { const a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2; pos[n] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }; });
  const edges = ring.edges.map(e => { const p = pos[e.from], q = pos[e.to]; if (!p || !q) return ''; return `<path class="edge" d="M${p.x} ${p.y} Q ${cx} ${cy} ${q.x} ${q.y}"/>`; }).join('');
  const nodeEls = nodes.map(n => `<g class="node"><circle cx="${pos[n].x}" cy="${pos[n].y}" r="16" ${n === seed ? 'style="stroke:var(--warn);stroke-width:3"' : ''}/><text x="${pos[n].x}" y="${pos[n].y + 3}">${esc(n.replace('ACC-', ''))}</text></g>`).join('');
  return `<svg id="ring" viewBox="0 0 ${W} ${H}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="var(--crit)"/></marker></defs>${edges}${nodeEls}</svg>`;
}

async function resolve(id, decision) {
  const detail = $('#detail');
  detail.querySelectorAll('.actions .btn').forEach(b => b.disabled = true);
  setStatus(`Committing ${decision} for ${id}…`);
  const res = await fetch(`/api/reviews/${encodeURIComponent(id)}/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }),
  }).then(r => r.json()).catch(e => ({ status: 'error', message: String(e) }));
  if (res.status === 'committed') {
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
      if (d.capability) bumpCap(d.capability);
    }
    if (ev.collection === 'transactions' || ev.collection === 'case_decisions' || ev.collection === 'reviews') reloadQueueSoon();
    if (ev.collection === 'case_analysis' && ev.doc?.transaction_id === selected) openCase(selected);
    if (ev.collection === 'audit_trail') refreshAudit();
  });
}

function wire() {
  $('#launchBtn').addEventListener('click', async () => {
    const b = $('#launchBtn'); b.disabled = true; b.textContent = 'Investigating…';
    setStatus('Investigation running — watch the rail light up →');
    addFeed('🚀', 'system', '', 'Launch — investigating all pending cases', 'commit');
    try { await fetch('/api/investigate/run', { method: 'POST' }); } catch (e) { setStatus('Launch failed'); }
    setTimeout(() => { b.disabled = false; b.textContent = '▶ Launch Investigation'; setStatus(''); }, 150000);
  });
  $('#resetBtn').addEventListener('click', async () => {
    const b = $('#resetBtn'); b.disabled = true; setStatus('Resetting…');
    try {
      const r = await fetch('/api/reset', { method: 'POST' }).then(x => x.json());
      $('#feed').innerHTML = ''; for (const k in capCounts) delete capCounts[k]; renderRail();
      selected = null; $('#detail').classList.remove('show'); $('#welcome').style.display = 'flex';
      addFeed('↺', 'system', '', `Reset — ${r.transactions ?? ''} cases pending`, 'reset');
      await loadQueue(); setStatus('Reset complete'); setTimeout(() => setStatus(''), 2000);
    } catch { setStatus('Reset failed'); }
    b.disabled = false;
  });
}

function boot() { renderRail(); wire(); loadQueue(); loadCaps(); backfillFeed(); refreshAudit(); connect(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
