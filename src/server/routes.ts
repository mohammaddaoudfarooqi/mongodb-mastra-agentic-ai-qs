import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Db } from 'mongodb';
import type { Config } from '../config';
import { ChangeStreamHub } from './change-stream-sse';
import { AuditStore } from '../governance/audit-store';
import { resolveReview } from '../workflow/investigate';
import type { EvidenceSnapshot } from '../workflow/evidence';
import { runPendingInvestigations } from '../workflow/run-engine';
import { loadTransactionSeed } from '../ingestion/transaction-fixtures';
import { logger } from '../observability/logger';
import { newSessionId, signToken, verifyToken, bearer } from './session';

/**
 * Re-derive the evidence snapshot from CURRENT case/transaction state (review finding #2), so the
 * stale-evidence check compares live state to the hash captured at suspend-time — not a stored
 * snapshot to itself. Returns null if the case has no analysis yet (caller falls back).
 */
async function deriveEvidenceSnapshot(db: Db, transactionId: string): Promise<EvidenceSnapshot | null> {
  const a = await db.collection('case_analysis').findOne({ transaction_id: transactionId });
  const txn = await db.collection('transactions').findOne({ transaction_id: transactionId });
  if (!a || !txn) return null;
  return {
    transaction_id: transactionId,
    proposed_disposition: a.decision?.disposition,
    amount: txn.amount,
    risk_factors: a.decision?.risk_factors ?? [],
    compliance_score: a.governance?.compliance_score ?? 0,
  } as EvidenceSnapshot;
}

/** Mount the control-room API on an app. `hub` is a started ChangeStreamHub over the same Db. */
export function mountRoutes(app: Hono, cfg: Config, db: Db, hub: ChangeStreamHub): void {
  // Derive the caller's session id ONLY from a verified Bearer token (never the body).
  const sidOf = (c: any): string | null => verifyToken(cfg.auditSecret, bearer(c.req.header('authorization')));

  // Guard for state-mutating routes (review finding #7): require a valid session token, which the
  // SPA always mints. This blocks anonymous / cross-site callers from resetting state, triggering
  // expensive investigations, or resolving reviews. Returns the sid, or null after sending 401.
  const requireSid = (c: any): string | null => {
    const sid = sidOf(c);
    return sid;
  };

  // Mint a stateless session token (per browser tab). No server-side session store.
  app.post('/api/token', c => {
    const sessionId = newSessionId();
    return c.json({ token: signToken(cfg.auditSecret, sessionId), sessionId });
  });
  // Case queue: recent transactions with their live status.
  app.get('/api/cases', async c => {
    const cases = await db.collection('transactions')
      .find({}, { projection: { _id: 0, embedding: 0 } })
      .sort({ created_at: -1 }).limit(50).toArray();
    return c.json({ cases });
  });

  // Full analysis for one case — powers the case-detail drill-down (projection of stored data).
  // If the case hasn't been investigated this run (e.g. a historical/seed precedent), fall back
  // to the raw transaction so the UI can still show a "reference precedent" card instead of a
  // dead click.
  app.get('/api/cases/:id', async c => {
    const id = c.req.param('id');
    const doc = await db.collection('case_analysis').findOne({ transaction_id: id }, { projection: { _id: 0 } });
    if (doc) return c.json({ ...doc, analyzed: true });
    const txn = await db.collection('transactions').findOne({ transaction_id: id }, { projection: { _id: 0, embedding: 0 } });
    if (!txn) return c.json({ error: 'not_found' }, 404);
    return c.json({
      analyzed: false, transaction_id: id, amount: txn.amount, lane: txn.lane,
      sender: txn.sender, recipient: txn.recipient, narrative: txn.text, status: txn.status,
    });
  });

  // Capability rollup — how many times each MongoDB capability has been exercised (capability rail).
  app.get('/api/capabilities', async c => {
    const rows = await db.collection('agent_events').aggregate([
      { $match: { capabilities: { $exists: true, $ne: [] } } },
      { $unwind: '$capabilities' },
      { $group: { _id: '$capabilities', count: { $sum: 1 } } },
    ]).toArray();
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r._id as string] = r.count as number;
    return c.json({ counts });
  });

  // Recent agent-operations feed (so a fresh page load shows the last run's activity).
  app.get('/api/feed', async c => {
    const events = await db.collection('agent_events')
      .find({}, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(60).toArray();
    return c.json({ events });
  });

  // Pending human-review gate — the shared held cases MINUS the ones THIS session has already
  // resolved (session-scoped so 100+ concurrent users each see/clear their own gate).
  app.get('/api/reviews', async c => {
    const sid = sidOf(c);
    const reviews = await db.collection('reviews')
      .find({ status: 'pending_review' }, { projection: { _id: 0 } }).toArray();
    if (!sid) return c.json({ reviews });
    const resolvedIds = new Set(
      (await db.collection('session_resolutions').find({ sessionId: sid }, { projection: { transaction_id: 1 } }).toArray())
        .map(r => r.transaction_id),
    );
    return c.json({ reviews: reviews.filter(r => !resolvedIds.has(r.transaction_id)) });
  });

  // Resume a suspended case with a human verdict. The client sends ONLY the decision.
  //
  // Concurrency: the human decision is recorded PER SESSION in `session_resolutions` (keyed by the
  // token-derived sid), so 100+ users can each approve/reject the same held case independently
  // without touching the shared replay data. In single-user (no-token) mode we also commit to the
  // shared ledger for the full end-to-end demo (evidence-hash verified, ACID + audit chain).
  app.post('/api/reviews/:id/resolve', async c => {
    const id = c.req.param('id');
    const sid = requireSid(c);
    if (!sid) return c.json({ error: 'unauthorized — missing/invalid session token' }, 401);
    const body = await c.req.json().catch(() => ({})) as { decision?: 'approve' | 'reject' };
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      return c.json({ error: 'decision must be approve|reject' }, 400);
    }
    const review = await db.collection('reviews').findOne({ transaction_id: id, status: 'pending_review' });
    if (!review || !review.snapshot || !review.evidence_hash) {
      return c.json({ status: 'not_found', message: 'No pending review for this case.' }, 404);
    }
    const now = new Date().toISOString();

    // In DEMO mode (100+ concurrent viewers) resolutions are session-scoped — record this user's
    // decision and leave the shared replay pristine. In LIVE mode (quickstart / single presenter)
    // we commit to the shared ledger with full verification below.
    if (cfg.demoMode) {
      await db.collection('session_resolutions').updateOne(
        { sessionId: sid, transaction_id: id },
        { $set: { sessionId: sid, transaction_id: id, decision: body.decision, decided_at: new Date() } },
        { upsert: true },
      );
      return c.json({ status: 'committed', decision: body.decision, scope: 'session' });
    }

    // No session (single-user / presenter): commit to the shared ledger with full verification.
    // Concurrency guard (review finding #5): atomically claim the review by transitioning
    // pending_review -> resolving. Only the first concurrent caller wins; a loser sees no pending
    // review and returns 409, so a case can't be double-committed.
    const claim = await db.collection('reviews').findOneAndUpdate(
      { transaction_id: id, status: 'pending_review' },
      { $set: { status: 'resolving' } },
    );
    if (!claim) return c.json({ status: 'already_resolved', message: 'This case was already resolved.' }, 409);

    // Real stale-evidence check (review finding #2): re-derive the evidence snapshot from CURRENT
    // case/transaction state and compare its hash to the one stored at suspend-time. If the case
    // changed since the reviewer saw it, the hash won't match and we refuse — instead of comparing
    // the stored snapshot to itself (which could never drift).
    const currentSnapshot = await deriveEvidenceSnapshot(db, id);
    const res = await resolveReview(db, cfg.auditSecret, {
      transaction_id: id, human_decision: body.decision,
      echoed_evidence_hash: review.evidence_hash as string,
      current: (currentSnapshot ?? review.snapshot) as EvidenceSnapshot, now,
    });
    if (res.status === 'rejected_stale') {
      // Release the claim so a corrected retry is possible.
      await db.collection('reviews').updateOne({ transaction_id: id }, { $set: { status: 'pending_review' } });
      return c.json({ status: 'rejected_stale', message: 'Evidence changed since review.' }, 409);
    }
    await db.collection('reviews').updateOne({ transaction_id: id }, { $set: { status: 'resolved', reviewDecision: body.decision } });
    await db.collection('case_analysis').updateOne({ transaction_id: id }, { $set: { phase: 'committed', 'decision.reviewed_by': 'human', 'decision.disposition': body.decision } });
    return c.json({ status: 'committed', decision: body.decision, scope: 'shared' });
  });

  // Runtime mode — the UI adapts labels and Launch behavior to this.
  app.get('/api/mode', c => c.json({ demoMode: cfg.demoMode }));

  // Replay data (demo mode): the pre-baked recorded run — ordered agent_events + per-case
  // analyses. The client animates these instead of calling the live agent. Read-only + shared.
  app.get('/api/replay', async c => {
    const events = await db.collection('agent_events').find({}, { projection: { _id: 0 } }).sort({ ts: 1 }).toArray();
    const analyses = await db.collection('case_analysis').find({}, { projection: { _id: 0 } }).toArray();
    return c.json({ events, analyses });
  });

  // Reset to a clean all-pending slate. In DEMO mode we KEEP the baked replay
  // (case_analysis + agent_events) — that is the recording — and only clear per-run decision
  // state. In live mode we clear everything (a fresh live run regenerates it).
  app.post('/api/reset', async c => {
    const sid = requireSid(c);
    if (!sid) return c.json({ error: 'unauthorized — missing/invalid session token' }, 401);
    // In DEMO mode a reset clears ONLY this user's resolutions — never the shared replay or another
    // user's state (safe for 100+ concurrent attendees).
    if (cfg.demoMode) {
      await db.collection('session_resolutions').deleteMany({ sessionId: sid });
      return c.json({ status: 'reset', scope: 'session', transactions: loadTransactionSeed().length, demoMode: cfg.demoMode });
    }
    // LIVE mode (single-user quickstart): full reset so a fresh live run regenerates everything.
    const clear = ['cases', 'case_decisions', 'reviews', 'audit_trail', 'agent_events', 'case_analysis'];
    for (const n of clear) await db.collection(n).deleteMany({});
    const seed = loadTransactionSeed();
    for (const s of seed) {
      await db.collection('transactions').updateOne({ transaction_id: s.transaction_id }, { $set: { status: s.status } });
    }
    return c.json({ status: 'reset', scope: 'shared', transactions: seed.length, demoMode: cfg.demoMode });
  });

  // LAUNCH. In DEMO mode this is a no-op signal — the client drives a deterministic replay of the
  // baked run (no LLM). In LIVE mode it runs the real agent pipeline (fire-and-forget; the UI
  // watches progress via /api/stream).
  let runInFlight = false; // in-process guard: don't double-process the same pending set (finding #5)
  app.post('/api/investigate/run', async c => {
    if (!requireSid(c)) return c.json({ error: 'unauthorized — missing/invalid session token' }, 401);
    if (cfg.demoMode) return c.json({ status: 'replay' });
    if (runInFlight) return c.json({ status: 'already_running' }, 409);
    runInFlight = true;
    runPendingInvestigations(db, cfg)
      .then(r => logger.info('investigation run complete', r))
      .catch(err => logger.error('investigation run failed', { err: String(err) }))
      .finally(() => { runInFlight = false; });
    return c.json({ status: 'started' });
  });

  // Audit-chain integrity (verify_chain).
  app.get('/api/audit/verify', async c => {
    const v = await new AuditStore(db, cfg.auditSecret).verify();
    return c.json(v);
  });

  // Live change-stream feed. Late-joiners get the current state via /api/cases first.
  app.get('/api/stream', c => streamSSE(c, async stream => {
    const unsub = hub.subscribe(ev => { stream.writeSSE({ event: 'change', data: JSON.stringify(ev) }); });
    // Keep-alive pings so proxies don't drop the connection.
    let open = true;
    stream.onAbort(() => { open = false; unsub(); });
    while (open) { await stream.writeSSE({ event: 'ping', data: '{}' }); await stream.sleep(15000); }
  }));
}
