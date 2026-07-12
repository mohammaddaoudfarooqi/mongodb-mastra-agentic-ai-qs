import type { Collection } from 'mongodb';
import type { Transaction } from '../mastra/schemas/transactions';
import { DECIDED_STATUSES } from '../mastra/schemas/transactions';
import { loadTransactionSeed } from '../ingestion/transaction-fixtures';

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/** Embed each seed record's narrative and upsert by transaction_id. Idempotent. Returns count. */
export async function seedTransactions(
  col: Collection<Transaction>, embed: EmbedFn,
): Promise<number> {
  const records = loadTransactionSeed();
  const vectors = await embed(records.map(r => r.text));
  let n = 0;
  for (let i = 0; i < records.length; i++) {
    const doc = { ...records[i], embedding: vectors[i] } as Transaction;
    await col.replaceOne({ transaction_id: doc.transaction_id }, doc, { upsert: true });
    n++;
  }
  return n;
}

export async function countDecidedPrecedents(col: Collection<Transaction>): Promise<number> {
  return col.countDocuments({ status: { $in: [...DECIDED_STATUSES] } });
}
