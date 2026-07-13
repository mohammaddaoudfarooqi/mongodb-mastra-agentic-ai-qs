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

  // Resume a suspended case with a human verdict (evidence-hash drift-checked).
  app.post('/api/reviews/:id/resolve', async c => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as {
      decision?: 'approve' | 'reject'; evidence_hash?: string; snapshot?: EvidenceSnapshot;
    };
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      return c.json({ error: 'decision must be approve|reject' }, 400);
    }
    if (!body.evidence_hash || !body.snapshot) {
      return c.json({ error: 'evidence_hash and snapshot are required' }, 400);
    }
    const now = new Date().toISOString();
    const res = await resolveReview(db, cfg.auditSecret, {
      transaction_id: id, human_decision: body.decision,
      echoed_evidence_hash: body.evidence_hash, current: body.snapshot, now,
    });
    if (res.status === 'rejected_stale') {
      return c.json({ status: 'rejected_stale', message: 'Evidence changed since review; refresh and try again.' }, 409);
    }
    await db.collection('reviews').updateOne({ transaction_id: id }, { $set: { status: 'resolved', reviewDecision: body.decision } });
    return c.json({ status: 'committed' });
  });

  // Reset to a clean all-pending slate for a fresh demo run (keeps the seeded transactions +
  // their embeddings; only clears run-derived state and re-sets every transaction to pending).
  app.post('/api/reset', async c => {
    for (const n of ['cases', 'case_decisions', 'reviews', 'audit_trail', 'agent_events']) {
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
