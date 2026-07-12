const $ = sel => document.querySelector(sel);
const counts = {};

function riskClass(status) {
  if (status === 'rejected' || status === 'escalated') return 'risk-high';
  if (status === 'pending') return 'risk-med';
  return 'risk-low';
}

function caseCard(t) {
  const el = document.createElement('div');
  el.className = `card ${riskClass(t.status)}`;
  el.innerHTML = `
    <div class="row"><span class="amt">$${Number(t.amount).toLocaleString()}</span>
      <span class="pill ${t.status}">${t.status}</span></div>
    <div class="sub">${escape(t.sender?.name ?? '')} → ${escape(t.recipient?.name ?? '')}</div>
    <div class="sub mono">${escape(t.transaction_id)} · ${escape(t.lane ?? '')}</div>`;
  return el;
}

function reviewCard(r) {
  const el = document.createElement('div');
  el.className = 'card risk-high';
  const snapshot = {
    transaction_id: r.transaction_id,
    proposed_disposition: 'escalate',
    amount: r.amount ?? 0,
    risk_factors: r.rules_triggered ?? [],
    compliance_score: r.compliance_score ?? 0.75,
  };
  el.innerHTML = `
    <div class="row"><b class="mono">${escape(r.transaction_id)}</b>
      <span class="pill escalated">held</span></div>
    <div class="sub">flag: ${escape(r.flag_reason ?? '')}</div>
    <div class="sub mono">rules: ${(r.rules_triggered ?? []).map(escape).join(', ')}</div>
    <div class="row" style="margin-top:8px;gap:8px">
      <button class="btn approve">Approve</button>
      <button class="btn reject">Reject</button></div>`;
  const resolve = decision => fetch(`/api/reviews/${encodeURIComponent(r.transaction_id)}/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision, evidence_hash: r.evidence_hash, snapshot }),
  }).then(res => res.json()).then(out => addFeed('human', r.transaction_id,
    out.status === 'committed' ? `human ${decision} committed` : `resolve ${out.status}`, out.status));
  el.querySelector('.approve').onclick = () => resolve('approve');
  el.querySelector('.reject').onclick = () => resolve('reject');
  return el;
}

function addFeed(actor, id, headline, kind) {
  const feed = $('#feed');
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = `<div class="row"><b>${escape(actor)}</b><span class="t">${new Date().toLocaleTimeString()}</span></div>
    <div>${escape(headline)} <span class="mono sub">${escape(id ?? '')}</span></div>`;
  feed.prepend(item);
  while (feed.childElementCount > 40) feed.lastElementChild.remove();
}

function bumpCounter(collection) {
  counts[collection] = (counts[collection] ?? 0) + 1;
  $('#counters').innerHTML = Object.entries(counts)
    .map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');
}

async function loadState() {
  const [cases, reviews] = await Promise.all([
    fetch('/api/cases').then(r => r.json()),
    fetch('/api/reviews').then(r => r.json()),
  ]);
  renderCases(cases.cases ?? []);
  renderReviews(reviews.reviews ?? []);
  refreshAudit();
}
function renderCases(list) {
  const q = $('#queue'); q.innerHTML = '';
  if (!list.length) { q.innerHTML = '<div class="empty">no cases</div>'; return; }
  list.forEach(t => q.appendChild(caseCard(t)));
}
function renderReviews(list) {
  const r = $('#reviews'); r.innerHTML = '';
  if (!list.length) { r.innerHTML = '<div class="empty">no cases awaiting review</div>'; return; }
  list.forEach(x => r.appendChild(reviewCard(x)));
}
async function refreshAudit() {
  const v = await fetch('/api/audit/verify').then(r => r.json()).catch(() => ({ ok: false }));
  const chip = $('#auditChip');
  chip.textContent = v.ok ? 'AUDIT ✓ VERIFIED' : 'AUDIT ✗ BROKEN';
  chip.style.color = v.ok ? 'var(--accent)' : 'var(--crit)';
}

function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('open', () => $('#live').classList.add('on'));
  es.addEventListener('error', () => $('#live').classList.remove('on'));
  es.addEventListener('change', e => {
    const ev = JSON.parse(e.data);
    bumpCounter(ev.collection);
    addFeed(ev.collection, ev.doc?.transaction_id, `${ev.operation} ${ev.collection}`, 'change');
    // Re-project the affected panel.
    if (ev.collection === 'transactions' || ev.collection === 'case_decisions') loadStateThrottled();
    if (ev.collection === 'reviews') loadStateThrottled();
    if (ev.collection === 'audit_trail') refreshAudit();
  });
}

let throttle = null;
function loadStateThrottled() { clearTimeout(throttle); throttle = setTimeout(loadState, 400); }

function escape(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

loadState();
connect();
