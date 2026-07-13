import type { Db } from 'mongodb';
import type { Config } from '../config';
import { RetrievalService } from '../retrieval/service';
import { buildInvestigationAgent, runInvestigation } from '../mastra/investigation-agent';
import { reviewAction } from '../governance/reviewer';
import { buildPolicyJudge } from '../governance/judge';
import { runCaseInvestigation } from './investigate';
import { evidenceHash, type EvidenceSnapshot } from './evidence';
import { triage, reconcile } from '../decision/core';
import { getQueryEmbedder } from '../mastra/embed';
import { TRANSACTIONS_COLLECTION } from '../mastra/schemas/transactions';

export const AGENT_EVENTS_COLLECTION = 'agent_events';
export const CASE_ANALYSIS_COLLECTION = 'case_analysis';

/** The MongoDB capabilities each investigation exercises — surfaced to the UI capability rail. */
export type Capability = 'vector' | 'fulltext' | 'hybrid' | 'graph' | 'memory' | 'governance' | 'durable' | 'audit';

async function emit(db: Db, e: { transaction_id: string; step: string; headline: string; detail?: string; capability?: Capability }) {
  await db.collection(AGENT_EVENTS_COLLECTION).insertOne({ ...e, ts: new Date() });
}

/**
 * Investigate every PENDING transaction with the real pipeline, one at a time, emitting a step
 * event at each stage AND persisting a rich case_analysis document (precedents, ring graph,
 * policies, verdict, decision, capabilities exercised) so the UI's case-detail view is a pure
 * projection of stored data.
 */
export async function runPendingInvestigations(db: Db, cfg: Config): Promise<{ investigated: number }> {
  const emb = getQueryEmbedder(cfg);
  const svc = new RetrievalService(db, t => emb.embedQuery(t));
  const agent = buildInvestigationAgent(cfg, svc);
  const judge = buildPolicyJudge(cfg);

  const pending = await db.collection(TRANSACTIONS_COLLECTION)
    .find({ status: 'pending' }, { projection: { embedding: 0 } })
    .sort({ amount: -1 }).toArray();

  let n = 0;
  for (const t of pending as any[]) {
    const id = t.transaction_id;
    const caps = new Set<Capability>();
    await emit(db, { transaction_id: id, step: 'triage', headline: `Investigating ${id}`, detail: `$${t.amount.toLocaleString()} · ${t.lane}` });

    // Retrieval (hybrid = vector + full-text).
    const precedents = await svc.hybrid(t.text, 4);
    caps.add('hybrid'); caps.add('vector'); caps.add('fulltext');
    await emit(db, { transaction_id: id, step: 'retrieve', headline: `${precedents.length} precedents (hybrid search)`, detail: precedents.map(p => p.transaction_id).join(', '), capability: 'hybrid' });

    // Memory recall (cite prior verdicts).
    const memory = precedents.slice(0, 2).map(p => ({ transaction_id: p.transaction_id, disposition: p.status, lane: p.lane }));
    if (memory.length) caps.add('memory');

    // Agent reasoning.
    const verdict = await runInvestigation(agent, cfg, t.text);
    await emit(db, { transaction_id: id, step: 'reason', headline: `Agent: ${verdict.recommendation} · confidence ${verdict.confidence}`, detail: verdict.risk_factors[0] });

    // Graph fund-tracing.
    const ring = await svc.traceFundsGraph(t.sender.account_number);
    caps.add('graph');
    if (ring.suspicious_patterns) await emit(db, { transaction_id: id, step: 'graph', headline: `Ring detected · ${ring.network_size} hops`, detail: `circular_flow=${ring.circular_flow} layering=${ring.layering}`, capability: 'graph' });

    // Governance review.
    const gov = await reviewAction(db, x => emb.embedQuery(x), judge, `Disposition ${verdict.recommendation} for ${id}: ${t.text}`);
    caps.add('governance');
    await emit(db, { transaction_id: id, step: 'govern', headline: `Policy score ${gov.compliance_score}${gov.held ? ' · HELD' : ''}`, detail: gov.violations.map(v => v.policy_code).join(', '), capability: 'governance' });

    // Deterministic decision + durable gate.
    const facts = { transaction_id: id, amount: t.amount, sender_account: t.sender.account_number, lane: t.lane, sanctions_hit: t.lane === 'sanctions', ring_suspicious: ring.suspicious_patterns };
    const decision = triage(facts) ?? reconcile(facts, verdict);
    const now = new Date().toISOString();
    const snapshot: EvidenceSnapshot = {
      transaction_id: id, proposed_disposition: decision.disposition, amount: t.amount,
      risk_factors: decision.risk_factors, compliance_score: gov.compliance_score,
    };
    const out = await runCaseInvestigation(db, cfg.auditSecret, facts, verdict, gov.compliance_score, gov.held, now);
    caps.add('durable'); caps.add('audit');

    // Persist the full analysis for the case-detail view (projection of stored data).
    await db.collection(CASE_ANALYSIS_COLLECTION).replaceOne({ transaction_id: id }, {
      transaction_id: id, amount: t.amount, lane: t.lane,
      sender: t.sender, recipient: t.recipient, narrative: t.text,
      precedents, memory, ring, governance: gov, verdict,
      decision: { disposition: decision.disposition, decided_by: decision.decided_by, risk_factors: decision.risk_factors, rationale: decision.rationale },
      phase: out.phase, evidence_hash: out.evidence_hash ?? evidenceHash(snapshot),
      snapshot, capabilities: [...caps], updated_at: new Date(),
    }, { upsert: true });

    await emit(db, {
      transaction_id: id, step: out.phase === 'suspended' ? 'suspend' : 'commit',
      headline: out.phase === 'suspended' ? `HELD for human review` : `Auto-${out.decision.disposition}`,
      detail: out.decision.disposition, capability: 'durable',
    });
    n++;
  }
  return { investigated: n };
}
