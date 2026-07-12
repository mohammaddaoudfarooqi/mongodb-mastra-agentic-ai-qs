import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Db } from 'mongodb';
import type { Config } from '../config';
import { ChangeStreamHub } from './change-stream-sse';
import { AuditStore } from '../governance/audit-store';
import { resolveReview } from '../workflow/investigate';
import type { EvidenceSnapshot } from '../workflow/evidence';

/** Mount the control-room API on an app. `hub` is a started ChangeStreamHub over the same Db. */
export function mountRoutes(app: Hono, cfg: Config, db: Db, hub: ChangeStreamHub): void {
  // Case queue: recent transactions with their live status.
  app.get('/api/cases', async c => {
    const cases = await db.collection('transactions')
      .find({}, { projection: { _id: 0, embedding: 0 } })
      .sort({ created_at: -1 }).limit(50).toArray();
    return c.json({ cases });
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
