import type { Db } from 'mongodb';
import {
  buildVectorPipeline, buildLexicalPipeline, buildRankFusionPipeline, buildGraphPipeline,
  summarizeRing, type RingSummary,
} from './pipelines';
import { TRANSACTIONS_COLLECTION } from '../mastra/schemas/transactions';

export type EmbedQuery = (text: string) => Promise<number[]>;

export interface RetrievalHit {
  transaction_id: string;
  text: string;
  amount: number;
  currency: string;
  sender: { name: string; account_number: string };
  recipient: { name: string; account_number: string };
  status: string;
  lane: string;
  score?: number;
}

/**
 * The retrieval surface the agent's tools call. All methods run a single aggregation on the
 * `transactions` collection — one collection, one engine (vector, lexical, hybrid, graph).
 */
export class RetrievalService {
  constructor(private db: Db, private embedQuery: EmbedQuery) {}

  private col() { return this.db.collection(TRANSACTIONS_COLLECTION); }

  /** Semantic precedent (decided cases only). */
  async vector(query: string, limit = 5): Promise<RetrievalHit[]> {
    const qvec = await this.embedQuery(query);
    return this.col().aggregate<RetrievalHit>(buildVectorPipeline(qvec, { limit })).toArray();
  }

  /** Full-text (BM25) over narrative + party names. */
  async lexical(query: string, limit = 5): Promise<RetrievalHit[]> {
    return this.col().aggregate<RetrievalHit>(buildLexicalPipeline(query, { limit })).toArray();
  }

  /** Hybrid (server-side reciprocal rank fusion). */
  async hybrid(query: string, k = 5): Promise<RetrievalHit[]> {
    const qvec = await this.embedQuery(query);
    return this.col().aggregate<RetrievalHit>(buildRankFusionPipeline(qvec, query, { k })).toArray();
  }

  /** Trace the sender's transfer network and summarize fraud-ring signals. */
  async traceFunds(accountId: string, maxDepth = 3): Promise<RingSummary> {
    const docs = await this.col().aggregate(buildGraphPipeline(accountId, { maxDepth })).toArray();
    return summarizeRing(docs[0] ?? { chain: [] }, accountId);
  }
}
