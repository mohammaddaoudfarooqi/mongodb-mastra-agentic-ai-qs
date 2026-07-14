import { Memory } from '@mastra/memory';
import { MongoDBStore, MongoDBVector } from '@mastra/mongodb';
import type { Config } from '../config';
import { getMemoryEmbedder, MEMORY_EMBED_MODEL } from './memory-embedder';

/**
 * Institutional case memory backed by @mastra/memory.
 *
 * This is a batch investigation pipeline, not a chat app — there are no conversational threads. So
 * instead of per-user working memory, we use ONE shared "fraud-desk" resource as the institution's
 * long-term memory: every decided case is indexed as an observation, and each new case semantically
 * recalls the most similar prior verdicts. This replaces the previous "memory" capability, which was
 * relabeled vector search over the transactions corpus (run-engine `precedents.slice(0,2)` and the
 * `recall_verdicts` tool). Now recall runs over a genuinely separate, Mastra-managed observation
 * vector index (`memory_observations_<dim>`), distinct from the transactions retrieval indexes.
 *
 * Storage (threads/messages/OM records) lives in MongoDBStore; the recall vectors live in
 * MongoDBVector — both on the SAME Atlas cluster as the operational data. The embedder is the
 * MongoDB-hosted Voyage text model (see memory-embedder).
 */
export const FRAUD_DESK_RESOURCE = 'fraud-desk';
export const INSTITUTIONAL_THREAD = 'institutional-memory';

/** Voyage text embeddings are 1024-dim; Memory names its observation index `memory_observations_<dim>`
 *  (MongoDBVector uses the default `_` separator). Provisioning targets this exact name. */
export const MEMORY_EMBED_DIM = 1024;
export const MEMORY_OBSERVATION_INDEX = `memory_observations_${MEMORY_EMBED_DIM}`;

/**
 * Provision the observation vector index @mastra/memory queries, so semantic recall works on the
 * very first run. Memory would auto-create it on first write, but Atlas builds search indexes
 * asynchronously — provisioning up front + waiting for READY avoids an empty-recall race. The index
 * name/dim MUST match what Memory derives (`memory_observations_<dim>`, default `_` separator).
 * Idempotent: `createIndex` no-ops on IndexAlreadyExists.
 */
export async function provisionMemoryIndex(cfg: Config): Promise<void> {
  const vector = new MongoDBVector({ id: 'marshal-memory-vector', uri: cfg.mongoUri, dbName: cfg.mongoDb });
  try {
    await vector.connect();
    await vector.createIndex({ indexName: MEMORY_OBSERVATION_INDEX, dimension: MEMORY_EMBED_DIM, metric: 'cosine' });
    await vector.waitForIndexReady({ indexName: MEMORY_OBSERVATION_INDEX });
  } finally {
    await vector.disconnect().catch(() => { /* best-effort close */ });
  }
}

/** Build the shared institutional Memory instance (MongoDBStore + MongoDBVector + Voyage embedder). */
export function buildInstitutionalMemory(cfg: Config): Memory {
  return new Memory({
    storage: new MongoDBStore({ id: 'marshal-memory-store', uri: cfg.mongoUri, dbName: cfg.mongoDb }),
    vector: new MongoDBVector({ id: 'marshal-memory-vector', uri: cfg.mongoUri, dbName: cfg.mongoDb }),
    embedder: getMemoryEmbedder(cfg) as any,
    // Batch flow: no in-thread history, no working memory. We drive recall/index explicitly via
    // searchMessages/indexObservation, so the automatic per-turn memory behaviors stay off.
    options: {
      lastMessages: false,
      workingMemory: { enabled: false },
    },
  });
}

/** The minimal Memory surface this module uses — injected as a fake in unit tests (hermetic). */
export interface InstitutionalMemory {
  indexObservation(args: {
    text: string; groupId: string; range: string; threadId: string; resourceId: string; observedAt?: Date;
  }): Promise<void>;
  searchMessages(args: {
    query: string; resourceId: string; topK?: number;
  }): Promise<{ results: Array<{ threadId: string; score: number; groupId?: string; text?: string }> }>;
}

export interface DecidedCaseMemo {
  transaction_id: string;
  disposition: string;
  lane: string;
  risk_factors: string[];
  amount: number;
}

/**
 * Compose the compact, SHAPE-ONLY memory text for a decided case. Mirrors the audit-store discipline:
 * ids, disposition, lane, amount bucket, and risk-factor summary — never raw party names / PII.
 */
export function buildCaseMemoText(memo: DecidedCaseMemo): string {
  const factors = memo.risk_factors.length ? memo.risk_factors.join('; ') : 'none';
  return [
    `Case ${memo.transaction_id} decided ${memo.disposition}.`,
    `Lane: ${memo.lane}. Amount: $${Math.round(memo.amount).toLocaleString()}.`,
    `Risk factors: ${factors}.`,
  ].join(' ');
}

/**
 * Record a decided case into institutional memory as a semantically-recallable observation. Keyed by
 * transaction_id (groupId) under the shared fraud-desk resource. Shape-only text (no PII).
 */
export async function recordDecidedCase(
  memory: InstitutionalMemory, memo: DecidedCaseMemo, observedAt: Date,
): Promise<void> {
  await memory.indexObservation({
    text: buildCaseMemoText(memo),
    groupId: memo.transaction_id,
    range: '0-0',
    threadId: INSTITUTIONAL_THREAD,
    resourceId: FRAUD_DESK_RESOURCE,
    observedAt,
  });
}

export interface RecalledVerdict {
  transaction_id: string;
  score: number;
  summary: string;
}

/**
 * Semantically recall prior decided cases resembling `query` from the shared institutional memory.
 * Returns transaction_id (the observation groupId) + score + the stored shape-only summary.
 */
export async function recallSimilarVerdicts(
  memory: InstitutionalMemory, query: string, topK = 3,
): Promise<RecalledVerdict[]> {
  const { results } = await memory.searchMessages({ query, resourceId: FRAUD_DESK_RESOURCE, topK });
  return results
    .filter(r => r.groupId)
    .map(r => ({ transaction_id: r.groupId as string, score: r.score, summary: r.text ?? '' }));
}

// Referenced so provisioning/logging can assert the memory model + dim line up with the index name.
export const MEMORY_MODEL = MEMORY_EMBED_MODEL;
