import type { Db } from 'mongodb';
import type { Config } from '../config';
import { RetrievalService } from '../retrieval/service';
import { buildInvestigationAgent, runInvestigation } from '../mastra/investigation-agent';
import { reviewAction } from '../governance/reviewer';
import { buildPolicyJudge } from '../governance/judge';
import { runCaseInvestigation } from './investigate';
import { getQueryEmbedder } from '../mastra/embed';
import { TRANSACTIONS_COLLECTION } from '../mastra/schemas/transactions';

export const AGENT_EVENTS_COLLECTION = 'agent_events';

/** Emit one agent-step event; the change stream surfaces it to the ops feed (UI = DB projection). */
async function emit(db: Db, e: { transaction_id: string; step: string; headline: string; detail?: string }) {
  await db.collection(AGENT_EVENTS_COLLECTION).insertOne({ ...e, ts: new Date() });
}

/**
 * Investigate every PENDING transaction with the real pipeline, one at a time, emitting a step
 * event at each stage so the UI animates the run (retrieve → graph → govern → decide → commit/suspend).
 * This is the "LAUNCH the simulation" driver.
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
    await emit(db, { transaction_id: id, step: 'triage', headline: `Investigating ${id}`, detail: `$${t.amount} · ${t.lane}` });

    const verdict = await runInvestigation(agent, cfg, t.text);
    await emit(db, { transaction_id: id, step: 'reason', headline: `Agent recommends ${verdict.recommendation} (${verdict.confidence})`, detail: verdict.risk_factors[0] });

    const ring = await svc.traceFunds(t.sender.account_number);
    if (ring.suspicious_patterns) await emit(db, { transaction_id: id, step: 'graph', headline: `trace_funds: ring suspicious`, detail: `network_size=${ring.network_size} circular_flow=${ring.circular_flow}` });

    const gov = await reviewAction(db, x => emb.embedQuery(x), judge, `Disposition ${verdict.recommendation} for ${id}: ${t.text}`);
    await emit(db, { transaction_id: id, step: 'govern', headline: `policy score ${gov.compliance_score}${gov.held ? ' — HELD' : ''}`, detail: gov.violations.map(v => v.policy_code).join(', ') });

    const facts = {
      transaction_id: id, amount: t.amount, sender_account: t.sender.account_number, lane: t.lane,
      sanctions_hit: t.lane === 'sanctions', ring_suspicious: ring.suspicious_patterns,
    };
    const now = new Date().toISOString();
    const out = await runCaseInvestigation(db, cfg.auditSecret, facts, verdict, gov.compliance_score, gov.held, now);
    await emit(db, {
      transaction_id: id, step: out.phase === 'suspended' ? 'suspend' : 'commit',
      headline: out.phase === 'suspended' ? `HELD for human review (${out.decision.disposition})` : `auto-${out.decision.disposition}`,
      detail: out.decision.risk_factors.join(', '),
    });
    n++;
  }
  return { investigated: n };
}
