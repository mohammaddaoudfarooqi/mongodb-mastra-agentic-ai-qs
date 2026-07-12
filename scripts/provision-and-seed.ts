import { MongoClient } from 'mongodb';
import { loadConfig } from '../src/config';
import { logger } from '../src/observability/logger';
import {
  assertRankFusionSupported, provisionTransactionVectorIndex, provisionTransactionSearchIndex,
} from '../src/data/provision-transactions';
import { seedTransactions, countDecidedPrecedents } from '../src/data/seed-transactions';
import { runSearchSelfCheck } from '../src/data/search-self-check';
import { TRANSACTIONS_COLLECTION } from '../src/mastra/schemas/transactions';
import { getQueryEmbedder } from '../src/mastra/embed';

async function main() {
  try { process.loadEnvFile(); } catch { /* .env optional */ }
  const cfg = loadConfig();
  const client = new MongoClient(cfg.mongoUri);
  try {
    await client.connect();
    const db = client.db(cfg.mongoDb);

    await assertRankFusionSupported(db);
    await provisionTransactionVectorIndex(db);
    await provisionTransactionSearchIndex(db);

    const embedder = getQueryEmbedder(cfg);
    const embed = (texts: string[]) => Promise.all(texts.map(t => embedder.embedQuery(t)));
    const written = await seedTransactions(db.collection(TRANSACTIONS_COLLECTION) as any, embed);
    logger.info('seeded transactions', { written });
    logger.info('decided precedents', {
      count: await countDecidedPrecedents(db.collection(TRANSACTIONS_COLLECTION) as any),
    });

    await runSearchSelfCheck(db, embed);
    logger.info('provision-and-seed complete');
  } finally {
    await client.close();
  }
}

main().then(() => process.exit(0)).catch(err => {
  logger.error('provision-and-seed failed', { err: String(err) });
  process.exit(1);
});
