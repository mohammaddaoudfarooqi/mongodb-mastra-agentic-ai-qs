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

/** Mount the control-room API on an app. `hub` is a started ChangeStreamHub over the same Db. */
export function mountRoutes(app: Hono, cfg: Config, db: Db, hub: ChangeStreamHub): void {
  // Case queue: recent transactions with their live status.
  app.get('/api/cases', async c => {
    const cases = await db.collection('transactions')
      .find({}, { projection: { _id: 0, embedding: 0 } })
      .sort({ created_at: -1 }).limit(50).toArray();
    return c.json({ cases });
  });

  // Full analysis for one case — powers the case-detail drill-down (projection of stored data).
  app.get('/api/cases/:id', async c => {
    const doc = await db.collection('case_analysis').findOne({ transaction_id: c.req.param('id') }, { projection: { _id: 0 } });
    if (!doc) return c.json({ error: 'not_analyzed' }, 404);
    return c.json(doc);
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

  // Pending human-review gate.
  app.get('/api/reviews', async c => {
    const reviews = await db.collection('reviews')
      .find({ status: 'pending_review' }, { projection: { _id: 0 } }).toArray();
    return c.json({ reviews });
  });

  // Resume a suspended case with a human verdict. The client sends ONLY the decision; the server
  // loads the evidence snapshot + hash it persisted at suspend-time and verifies against those
  // (never a client-reconstructed snapshot — that was the bug that made resolves always fail).
  app.post('/api/reviews/:id/resolve', async c => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as { decision?: 'approve' | 'reject' };
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      return c.json({ error: 'decision must be approve|reject' }, 400);
    }
    const review = await db.collection('reviews').findOne({ transaction_id: id, status: 'pending_review' });
    if (!review || !review.snapshot || !review.evidence_hash) {
      return c.json({ status: 'not_found', message: 'No pending review for this case.' }, 404);
    }
    const now = new Date().toISOString();
    const res = await resolveReview(db, cfg.auditSecret, {
      transaction_id: id, human_decision: body.decision,
      echoed_evidence_hash: review.evidence_hash as string,
      current: review.snapshot as EvidenceSnapshot, now,
    });
    if (res.status === 'rejected_stale') {
      return c.json({ status: 'rejected_stale', message: 'Evidence changed since review.' }, 409);
    }
    await db.collection('reviews').updateOne({ transaction_id: id }, { $set: { status: 'resolved', reviewDecision: body.decision } });
    await db.collection('case_analysis').updateOne({ transaction_id: id }, { $set: { phase: 'committed', 'decision.reviewed_by': 'human', 'decision.disposition': body.decision } });
    return c.json({ status: 'committed', decision: body.decision });
  });

  // Reset to a clean all-pending slate for a fresh demo run (keeps the seeded transactions +
  // their embeddings; only clears run-derived state and re-sets every transaction to pending).
  app.post('/api/reset', async c => {
    for (const n of ['cases', 'case_decisions', 'reviews', 'audit_trail', 'agent_events', 'case_analysis']) {
      await db.collection(n).deleteMany({});
    }
    // Restore each transaction's status to its seed value (live cases -> pending, historical keep decided).
    const seed = loadTransactionSeed();
    for (const s of seed) {
      await db.collection('transactions').updateOne({ transaction_id: s.transaction_id }, { $set: { status: s.status } });
    }
    return c.json({ status: 'reset', transactions: seed.length });
  });

  // LAUNCH: investigate every pending case with the real agent pipeline, emitting step events the
  // change stream surfaces to the ops feed. Fire-and-forget so the HTTP call returns immediately;
  // the UI watches progress live via /api/stream.
  app.post('/api/investigate/run', async c => {
    runPendingInvestigations(db, cfg)
      .then(r => logger.info('investigation run complete', r))
      .catch(err => logger.error('investigation run failed', { err: String(err) }));
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
