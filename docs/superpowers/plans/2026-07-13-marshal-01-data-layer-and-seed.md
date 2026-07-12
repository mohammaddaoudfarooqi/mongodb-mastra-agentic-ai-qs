# Marshal — Plan 1: Data Layer & Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the MongoDB data layer for Marshal — the `transactions` collection (operational record + retrieval corpus), its vector + Atlas Search indexes, a labeled 6-lane seed corpus, an idempotent provisioning script, and a post-seed search self-check — so every later plan has a queryable, indexed, ground-truth-labeled dataset on one Atlas cluster.

**Architecture:** Mirror the current sibling app's proven patterns exactly: Zod-typed schema modules under `src/mastra/schemas/`, a raw `mongodb` driver for the operational collection, `@mastra/mongodb` `MongoDBVector` for vector-index provisioning, `tsx` scripts under `scripts/`, and vitest TDD. The `transactions` collection holds the narrative `text`, a 1024-dim `embedding`, the `sender`/`recipient` sub-docs used by the graph tool, a `status` lifecycle field, and a `lane` label that doubles as the eval ground truth.

**Tech Stack:** TypeScript 5, Node 22, `mongodb` ^6, `@mastra/mongodb`, `voyageai` (voyage-4, 1024-dim), `zod` ^3, `tsx`, `vitest` ^2, Hono (later plans).

## Global Constraints

- **One Atlas cluster, one connection string.** No second datastore, no external search/graph engine. Everything is MongoDB.
- **Embeddings:** Voyage `voyage-4`-family, **1024 dimensions, cosine** similarity. Match the sibling app's `createKnowledgeVector` pattern (`dimension: 1024, metric: 'cosine'`).
- **Hybrid search requires MongoDB 8.0+** (`$rankFusion`). Every current Atlas tier including free M0 is 8.0+. A version guard must fail loudly against an older self-hosted server.
- **Naming/copy rules:** the product name is **Marshal** but MUST be read from config (a single env/config value), never hardcoded in source. Do NOT use the term "Constitutional AI" anywhere. Do NOT name other vendors' products in code, comments, or copy.
- **`status` decided-set is a single source of truth:** `DECIDED_STATUSES = ['approved','rejected','escalated']`. Precedent retrieval filters to this set. Define once; import everywhere (regression-fenced).
- **TDD, DRY, YAGNI, frequent commits.** Every task ends with a passing test and a commit.

---

### Task 1: Transaction schema module

**Files:**
- Create: `src/mastra/schemas/transactions.ts`
- Test: `src/mastra/schemas/transactions.test.ts`

**Interfaces:**
- Consumes: nothing (foundation).
- Produces:
  - `Transaction` (TS interface) — fields below.
  - `TransactionSchema` (Zod schema) validating a `Transaction`.
  - `DECIDED_STATUSES: readonly ['approved','rejected','escalated']`.
  - `LANES: readonly Lane[]` where `Lane = 'clean_approve' | 'clear_reject' | 'structuring' | 'high_value' | 'ring' | 'sanctions'`.
  - `TRANSACTIONS_COLLECTION = 'transactions'`, `TRANSACTIONS_VECTOR_INDEX = 'transactions_vector_index'`, `TRANSACTIONS_SEARCH_INDEX = 'transactions_search_index'`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/mastra/schemas/transactions.test.ts
import { describe, it, expect } from 'vitest';
import {
  TransactionSchema, DECIDED_STATUSES, LANES,
  TRANSACTIONS_COLLECTION, TRANSACTIONS_VECTOR_INDEX, TRANSACTIONS_SEARCH_INDEX,
} from './transactions';

const valid = {
  transaction_id: 'txn-0001',
  text: 'Cash deposit of 4950 USD just under the 5000 reporting threshold.',
  amount: 4950,
  currency: 'USD',
  sender: { name: 'Acme LLC', account_number: 'ACC-1001' },
  recipient: { name: 'Beta Inc', account_number: 'ACC-2002' },
  status: 'pending',
  lane: 'structuring',
  model_used: 'historical',
  embedding: Array.from({ length: 1024 }, () => 0),
  created_at: new Date('2026-06-01T00:00:00Z'),
};

describe('TransactionSchema', () => {
  it('accepts a valid transaction', () => {
    expect(() => TransactionSchema.parse(valid)).not.toThrow();
  });
  it('rejects an embedding that is not 1024-dim', () => {
    expect(() => TransactionSchema.parse({ ...valid, embedding: [0, 0, 0] })).toThrow();
  });
  it('rejects an unknown status', () => {
    expect(() => TransactionSchema.parse({ ...valid, status: 'frozen' })).toThrow();
  });
  it('rejects an unknown lane', () => {
    expect(() => TransactionSchema.parse({ ...valid, lane: 'made_up' })).toThrow();
  });
  it('exposes the decided-status single source of truth', () => {
    expect(DECIDED_STATUSES).toEqual(['approved', 'rejected', 'escalated']);
  });
  it('exposes all six lanes and the collection/index names', () => {
    expect(LANES).toHaveLength(6);
    expect(TRANSACTIONS_COLLECTION).toBe('transactions');
    expect(TRANSACTIONS_VECTOR_INDEX).toBe('transactions_vector_index');
    expect(TRANSACTIONS_SEARCH_INDEX).toBe('transactions_search_index');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/mastra/schemas/transactions.test.ts`
Expected: FAIL — `Cannot find module './transactions'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/mastra/schemas/transactions.ts
import { z } from 'zod';

/** The three terminal statuses. Precedent retrieval filters to this set so a case can only
 *  cite an already-decided case as precedent. Single source of truth — import, never re-list. */
export const DECIDED_STATUSES = ['approved', 'rejected', 'escalated'] as const;
export type DecidedStatus = (typeof DECIDED_STATUSES)[number];

/** Ground-truth scenario labels. Double as eval labels (Plan 7) and demo fixtures. */
export const LANES = [
  'clean_approve', 'clear_reject', 'structuring', 'high_value', 'ring', 'sanctions',
] as const;
export type Lane = (typeof LANES)[number];

export const TRANSACTIONS_COLLECTION = 'transactions';
export const TRANSACTIONS_VECTOR_INDEX = 'transactions_vector_index';
export const TRANSACTIONS_SEARCH_INDEX = 'transactions_search_index';

export const EMBED_DIM = 1024;

const PartySchema = z.object({
  name: z.string().min(1),
  account_number: z.string().min(1),
});

export const TransactionSchema = z.object({
  transaction_id: z.string().min(1),
  text: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  sender: PartySchema,
  recipient: PartySchema,
  status: z.enum(['pending', ...DECIDED_STATUSES]),
  lane: z.enum(LANES),
  // 'historical' marks the seed precedent corpus; 'live' marks cases created during a run.
  model_used: z.enum(['historical', 'live']),
  embedding: z.array(z.number()).length(EMBED_DIM),
  created_at: z.date(),
});

export type Transaction = z.infer<typeof TransactionSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/mastra/schemas/transactions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck & commit**

```bash
pnpm typecheck
git add src/mastra/schemas/transactions.ts src/mastra/schemas/transactions.test.ts
git commit -m "feat(data): transaction schema + decided-status/lane constants"
```

---

### Task 2: Labeled seed corpus (6 lanes)

**Files:**
- Create: `src/ingestion/data/transactions.seed.json`
- Create: `src/ingestion/transaction-fixtures.ts`
- Test: `src/ingestion/transaction-fixtures.test.ts`

**Interfaces:**
- Consumes: `Transaction`, `LANES`, `TransactionSchema` (Task 1).
- Produces:
  - `loadTransactionSeed(): Omit<Transaction, 'embedding'>[]` — reads the JSON, returns records **without** embeddings (embeddings are added at seed time, Task 4).
  - `EXPECTED_DISPOSITION: Record<Lane, 'approve' | 'reject' | 'escalate'>` — the eval ground truth per lane.

- [ ] **Step 1: Write the failing test**

```typescript
// src/ingestion/transaction-fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { loadTransactionSeed, EXPECTED_DISPOSITION } from './transaction-fixtures';
import { LANES, TransactionSchema } from '../mastra/schemas/transactions';

describe('transaction seed corpus', () => {
  const seed = loadTransactionSeed();

  it('covers every lane at least twice (precedent + a live-review case)', () => {
    for (const lane of LANES) {
      const n = seed.filter(s => s.lane === lane).length;
      expect(n, `lane ${lane}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('every record validates against the schema when an embedding is attached', () => {
    for (const rec of seed) {
      const withEmbed = { ...rec, embedding: Array.from({ length: 1024 }, () => 0) };
      expect(() => TransactionSchema.parse(withEmbed), rec.transaction_id).not.toThrow();
    }
  });

  it('has unique transaction_ids', () => {
    const ids = seed.map(s => s.transaction_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes exactly one live-review case per lane (model_used=live, status=pending)', () => {
    for (const lane of LANES) {
      const live = seed.filter(s => s.lane === lane && s.model_used === 'live');
      expect(live.length, `live case for ${lane}`).toBe(1);
      expect(live[0].status).toBe('pending');
    }
  });

  it('every historical precedent has a decided status', () => {
    for (const rec of seed.filter(s => s.model_used === 'historical')) {
      expect(['approved', 'rejected', 'escalated'], rec.transaction_id).toContain(rec.status);
    }
  });

  it('maps every lane to an expected disposition', () => {
    for (const lane of LANES) expect(EXPECTED_DISPOSITION[lane]).toBeDefined();
  });

  it('has a ring lane whose sender/recipient accounts form a closable cycle', () => {
    const ring = seed.filter(s => s.lane === 'ring');
    const senders = new Set(ring.map(r => r.sender.account_number));
    const recipients = ring.map(r => r.recipient.account_number);
    // at least one ring recipient points back to a ring sender (circular flow)
    expect(recipients.some(r => senders.has(r))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ingestion/transaction-fixtures.test.ts`
Expected: FAIL — `Cannot find module './transaction-fixtures'`.

- [ ] **Step 3: Author the seed JSON**

Create `src/ingestion/data/transactions.seed.json` with **at least 14 records**: for each of the 6 lanes, 1+ `historical` precedent (decided) and exactly 1 `live` case (`status: "pending"`). The `ring` lane's `live` case seeds account `ACC-RING-A`; its historical records form a cycle `ACC-RING-A → ACC-RING-B → ACC-RING-C → ACC-RING-A`. Every record omits `embedding` (added at seed time). Example records (author the rest in the same shape):

```json
[
  {
    "transaction_id": "txn-clean-01",
    "text": "Recurring payroll credit of 3200 USD from Northwind Foods to a long-tenured employee account. Consistent monthly pattern.",
    "amount": 3200, "currency": "USD",
    "sender": { "name": "Northwind Foods", "account_number": "ACC-1001" },
    "recipient": { "name": "J. Rivera", "account_number": "ACC-1002" },
    "status": "approved", "lane": "clean_approve", "model_used": "historical",
    "created_at": "2026-05-02T10:00:00Z"
  },
  {
    "transaction_id": "txn-review-clean",
    "text": "Recurring payroll credit of 3200 USD from Northwind Foods to a long-tenured employee account.",
    "amount": 3200, "currency": "USD",
    "sender": { "name": "Northwind Foods", "account_number": "ACC-1001" },
    "recipient": { "name": "J. Rivera", "account_number": "ACC-1002" },
    "status": "pending", "lane": "clean_approve", "model_used": "live",
    "created_at": "2026-06-10T09:00:00Z"
  },
  {
    "transaction_id": "txn-struct-01",
    "text": "Cash deposit of 4950 USD, just under the 5000 reporting threshold. Third sub-threshold deposit this week from the same account.",
    "amount": 4950, "currency": "USD",
    "sender": { "name": "Cash Corner", "account_number": "ACC-3001" },
    "recipient": { "name": "Cash Corner", "account_number": "ACC-3001" },
    "status": "rejected", "lane": "structuring", "model_used": "historical",
    "created_at": "2026-04-18T14:00:00Z"
  },
  {
    "transaction_id": "txn-review-struct",
    "text": "Cash deposit of 4950 USD, just under the 5000 reporting threshold, following two similar deposits.",
    "amount": 4950, "currency": "USD",
    "sender": { "name": "Cash Corner", "account_number": "ACC-3001" },
    "recipient": { "name": "Cash Corner", "account_number": "ACC-3001" },
    "status": "pending", "lane": "structuring", "model_used": "live",
    "created_at": "2026-06-11T11:00:00Z"
  },
  {
    "transaction_id": "txn-ring-01",
    "text": "Transfer of 920 USD from Quartz Trading to Vertex Holdings, part of a rapid multi-hop chain.",
    "amount": 920, "currency": "USD",
    "sender": { "name": "Quartz Trading", "account_number": "ACC-RING-A" },
    "recipient": { "name": "Vertex Holdings", "account_number": "ACC-RING-B" },
    "status": "rejected", "lane": "ring", "model_used": "historical",
    "created_at": "2026-03-30T08:00:00Z"
  },
  {
    "transaction_id": "txn-ring-02",
    "text": "Transfer of 880 USD from Vertex Holdings to Slate Partners, continuing the layering chain.",
    "amount": 880, "currency": "USD",
    "sender": { "name": "Vertex Holdings", "account_number": "ACC-RING-B" },
    "recipient": { "name": "Slate Partners", "account_number": "ACC-RING-C" },
    "status": "rejected", "lane": "ring", "model_used": "historical",
    "created_at": "2026-03-30T08:05:00Z"
  },
  {
    "transaction_id": "txn-ring-03",
    "text": "Transfer of 850 USD from Slate Partners back to Quartz Trading, closing a circular money-flow loop.",
    "amount": 850, "currency": "USD",
    "sender": { "name": "Slate Partners", "account_number": "ACC-RING-C" },
    "recipient": { "name": "Quartz Trading", "account_number": "ACC-RING-A" },
    "status": "rejected", "lane": "ring", "model_used": "historical",
    "created_at": "2026-03-30T08:10:00Z"
  },
  {
    "transaction_id": "txn-review-ring",
    "text": "Transfer of 900 USD from Quartz Trading to Vertex Holdings; account is part of a suspected mule network.",
    "amount": 900, "currency": "USD",
    "sender": { "name": "Quartz Trading", "account_number": "ACC-RING-A" },
    "recipient": { "name": "Vertex Holdings", "account_number": "ACC-RING-B" },
    "status": "pending", "lane": "ring", "model_used": "live",
    "created_at": "2026-06-11T12:00:00Z"
  }
]
```

Add the remaining lanes (`clear_reject`, `high_value`, `sanctions`) each with 1 historical + 1 live record, following the same shape (e.g. `high_value` live = a $75,000 wire; `sanctions` live = a counterparty on a watchlist; `clear_reject` = an obviously fraudulent charge).

- [ ] **Step 4: Write the fixtures loader**

```typescript
// src/ingestion/transaction-fixtures.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Transaction, Lane } from '../mastra/schemas/transactions';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Seed record shape: a Transaction minus the embedding (attached at seed time) with an
 *  ISO date string for created_at (coerced to a Date here). */
type SeedRecord = Omit<Transaction, 'embedding' | 'created_at'> & { created_at: string };

export function loadTransactionSeed(): Omit<Transaction, 'embedding'>[] {
  const raw = readFileSync(join(HERE, 'data', 'transactions.seed.json'), 'utf8');
  const records = JSON.parse(raw) as SeedRecord[];
  return records.map(r => ({ ...r, created_at: new Date(r.created_at) }));
}

export const EXPECTED_DISPOSITION: Record<Lane, 'approve' | 'reject' | 'escalate'> = {
  clean_approve: 'approve',
  clear_reject: 'reject',
  structuring: 'escalate',
  high_value: 'escalate',
  ring: 'escalate',
  sanctions: 'reject',
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/ingestion/transaction-fixtures.test.ts`
Expected: PASS (7 tests). If a lane-count or ring-cycle assertion fails, add/fix seed records until green.

- [ ] **Step 6: Typecheck & commit**

```bash
pnpm typecheck
git add src/ingestion/data/transactions.seed.json src/ingestion/transaction-fixtures.ts src/ingestion/transaction-fixtures.test.ts
git commit -m "feat(data): labeled 6-lane transaction seed corpus + fixtures loader"
```

---

### Task 3: Index provisioning module

**Files:**
- Create: `src/data/provision-transactions.ts`
- Test: `src/data/provision-transactions.test.ts`

**Interfaces:**
- Consumes: `TRANSACTIONS_COLLECTION`, `TRANSACTIONS_VECTOR_INDEX`, `TRANSACTIONS_SEARCH_INDEX`, `EMBED_DIM` (Task 1); `MongoDBVector` from `@mastra/mongodb`; `Db` from `mongodb`.
- Produces:
  - `provisionTransactionVectorIndex(v: MongoDBVector): Promise<void>` — creates the 1024-dim cosine vector index and waits for ready.
  - `provisionTransactionSearchIndex(db: Db): Promise<void>` — creates the Atlas `$search` index (dynamic mapping) on `transactions`; idempotent; best-effort (logs on failure).
  - `assertRankFusionSupported(db: Db): Promise<void>` — reads server version via `buildInfo`, throws if `< 8.0`.

- [ ] **Step 1: Write the failing test** (unit-level: version guard parsing; index calls are integration-tested by the script in Task 5)

```typescript
// src/data/provision-transactions.test.ts
import { describe, it, expect } from 'vitest';
import { parseMajorMinor, supportsRankFusion } from './provision-transactions';

describe('rank-fusion version guard', () => {
  it('parses major.minor', () => {
    expect(parseMajorMinor('8.0.4')).toEqual([8, 0]);
    expect(parseMajorMinor('7.3.1')).toEqual([7, 3]);
  });
  it('accepts 8.0+ and rejects older', () => {
    expect(supportsRankFusion('8.0.0')).toBe(true);
    expect(supportsRankFusion('8.1.2')).toBe(true);
    expect(supportsRankFusion('7.0.14')).toBe(false);
    expect(supportsRankFusion('6.0.0')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/data/provision-transactions.test.ts`
Expected: FAIL — `Cannot find module './provision-transactions'`.

- [ ] **Step 3: Write the implementation** (mirrors the sibling app's `src/mastra/vector.ts` provisioning idioms)

```typescript
// src/data/provision-transactions.ts
import type { Db } from 'mongodb';
import type { MongoDBVector } from '@mastra/mongodb';
import { logger } from '../observability/logger';
import {
  TRANSACTIONS_COLLECTION, TRANSACTIONS_VECTOR_INDEX, TRANSACTIONS_SEARCH_INDEX, EMBED_DIM,
} from '../mastra/schemas/transactions';

export function parseMajorMinor(version: string): [number, number] {
  const [maj, min] = version.split('.');
  return [Number(maj) || 0, Number(min) || 0];
}
export function supportsRankFusion(version: string): boolean {
  const [maj, min] = parseMajorMinor(version);
  return maj > 8 || (maj === 8 && min >= 0);
}

export async function assertRankFusionSupported(db: Db): Promise<void> {
  const info = (await db.admin().buildInfo()) as { version: string };
  if (!supportsRankFusion(info.version)) {
    throw new Error(
      `MongoDB ${info.version} predates $rankFusion (needs 8.0+). Use an Atlas cluster (any tier) or self-hosted 8.0+.`,
    );
  }
  logger.info('server supports $rankFusion', { version: info.version });
}

export async function provisionTransactionVectorIndex(v: MongoDBVector): Promise<void> {
  await v.createIndex({ indexName: TRANSACTIONS_VECTOR_INDEX, dimension: EMBED_DIM, metric: 'cosine' });
  await v.waitForIndexReady({ indexName: TRANSACTIONS_VECTOR_INDEX });
  logger.info('transactions vector index ready', { index: TRANSACTIONS_VECTOR_INDEX });
}

export async function provisionTransactionSearchIndex(db: Db): Promise<void> {
  const col = db.collection(TRANSACTIONS_COLLECTION);
  try {
    // createSearchIndex requires the namespace to exist; a no-op index materializes it.
    await col.createIndex({ _id: 1 }).catch(() => { /* namespace may already exist */ });
    const existing = await col.listSearchIndexes().toArray().catch(() => []);
    if (existing.some((i: any) => i.name === TRANSACTIONS_SEARCH_INDEX)) return;
    await col.createSearchIndex({
      name: TRANSACTIONS_SEARCH_INDEX,
      // Index the narrative + party names; dynamic mapping covers text + sender/recipient.name.
      definition: { mappings: { dynamic: true } },
    });
    logger.info('transactions search index created', { index: TRANSACTIONS_SEARCH_INDEX });
  } catch (err) {
    logger.warn('transactions search index creation failed; hybrid search runs vector-only until it exists', {
      index: TRANSACTIONS_SEARCH_INDEX, err: String(err),
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/data/provision-transactions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck & commit**

```bash
pnpm typecheck
git add src/data/provision-transactions.ts src/data/provision-transactions.test.ts
git commit -m "feat(data): transaction index provisioning + rank-fusion version guard"
```

---

### Task 4: Seed writer with embeddings + decided-status filtered retrieval self-check helper

**Files:**
- Create: `src/data/seed-transactions.ts`
- Test: `src/data/seed-transactions.test.ts`

**Interfaces:**
- Consumes: `loadTransactionSeed` (Task 2); `Transaction`, `TRANSACTIONS_COLLECTION`, `DECIDED_STATUSES` (Task 1); a `Collection<Transaction>` from `mongodb`; an `embed(texts: string[]) => Promise<number[][]>` function (injected — the caller wires Voyage in Task 5).
- Produces:
  - `seedTransactions(col, embed): Promise<number>` — embeds each record's `text`, upserts by `transaction_id`, returns the count written. Idempotent (re-run replaces).
  - `countDecidedPrecedents(col): Promise<number>` — counts docs whose `status ∈ DECIDED_STATUSES` (used by the self-check).

- [ ] **Step 1: Write the failing test** (uses an in-memory fake collection + a deterministic fake embedder — no live DB)

```typescript
// src/data/seed-transactions.test.ts
import { describe, it, expect, vi } from 'vitest';
import { seedTransactions, countDecidedPrecedents } from './seed-transactions';

// Minimal fake of the Mongo Collection surface these functions use.
function fakeCollection() {
  const store = new Map<string, any>();
  return {
    store,
    async replaceOne(filter: any, doc: any, opts: any) {
      store.set(filter.transaction_id, doc);
      return { upsertedCount: 1 };
    },
    countDocuments(query: any) {
      const set = query?.status?.$in as string[] | undefined;
      const n = [...store.values()].filter(d => !set || set.includes(d.status)).length;
      return Promise.resolve(n);
    },
  };
}

const fakeEmbed = vi.fn(async (texts: string[]) =>
  texts.map((_, i) => Array.from({ length: 1024 }, () => (i + 1) / 1000)));

describe('seedTransactions', () => {
  it('embeds and writes every seed record, returning the count', async () => {
    const col = fakeCollection();
    const n = await seedTransactions(col as any, fakeEmbed);
    expect(n).toBeGreaterThanOrEqual(14);
    expect(col.store.size).toBe(n);
    // every stored doc has a 1024-dim embedding
    for (const doc of col.store.values()) expect(doc.embedding).toHaveLength(1024);
    expect(fakeEmbed).toHaveBeenCalled();
  });

  it('counts only decided precedents', async () => {
    const col = fakeCollection();
    await seedTransactions(col as any, fakeEmbed);
    const decided = await countDecidedPrecedents(col as any);
    // live cases are pending, so decided < total
    expect(decided).toBeGreaterThan(0);
    expect(decided).toBeLessThan(col.store.size);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/data/seed-transactions.test.ts`
Expected: FAIL — `Cannot find module './seed-transactions'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/data/seed-transactions.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/data/seed-transactions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck & commit**

```bash
pnpm typecheck
git add src/data/seed-transactions.ts src/data/seed-transactions.test.ts
git commit -m "feat(data): seed writer with embeddings + decided-precedent count"
```

---

### Task 5: Provision + seed CLI script with post-seed search self-check

**Files:**
- Create: `scripts/provision-and-seed.ts`
- Modify: `package.json` (add scripts `provision`, `seed`)

**Interfaces:**
- Consumes: everything above; `loadConfig` from `src/config` (existing); `createKnowledgeVector`-style `MongoDBVector` construction; a Voyage embedder. This is a runnable script (no unit test — it hits a live cluster; correctness is proven by the self-check it runs and by Task 6's integration test).

- [ ] **Step 1: Write the script** (mirrors sibling `scripts/provision-indexes.ts` structure)

```typescript
// scripts/provision-and-seed.ts
import { MongoClient } from 'mongodb';
import { MongoDBVector } from '@mastra/mongodb';
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
  const vector = new MongoDBVector({ id: 'transactions', uri: cfg.mongoUri, dbName: cfg.mongoDb });
  try {
    await client.connect();
    const db = client.db(cfg.mongoDb);

    await assertRankFusionSupported(db);
    await provisionTransactionVectorIndex(vector);
    await provisionTransactionSearchIndex(db);

    const embedder = getQueryEmbedder(cfg);
    const embed = (texts: string[]) => Promise.all(texts.map(t => embedder.embedQuery(t)));
    const written = await seedTransactions(db.collection(TRANSACTIONS_COLLECTION) as any, embed);
    logger.info('seeded transactions', { written });
    logger.info('decided precedents', { count: await countDecidedPrecedents(db.collection(TRANSACTIONS_COLLECTION) as any) });

    await runSearchSelfCheck(db, embed);
    logger.info('provision-and-seed complete');
  } finally {
    await client.close();
    await (vector as any).disconnect?.().catch?.(() => {});
  }
}

main().then(() => process.exit(0)).catch(err => {
  logger.error('provision-and-seed failed', { err: String(err) });
  process.exit(1);
});
```

- [ ] **Step 2: Add package scripts**

In `package.json` `scripts`, add:

```json
"provision": "tsx scripts/provision-and-seed.ts",
"seed": "tsx scripts/provision-and-seed.ts"
```

- [ ] **Step 3: Commit** (script is exercised in Task 6; no run required here if no cluster is available)

```bash
git add scripts/provision-and-seed.ts package.json
git commit -m "feat(data): provision-and-seed CLI (indexes + seed + self-check)"
```

---

### Task 6: Post-seed search self-check (fail-loud probe)

**Files:**
- Create: `src/data/search-self-check.ts`
- Test: `src/data/search-self-check.test.ts`

**Interfaces:**
- Consumes: `TRANSACTIONS_COLLECTION`, `TRANSACTIONS_VECTOR_INDEX`, `TRANSACTIONS_SEARCH_INDEX` (Task 1); `Db` and an `EmbedFn` (Task 4).
- Produces:
  - `runSearchSelfCheck(db: Db, embed: EmbedFn): Promise<void>` — runs one known-good `$vectorSearch` probe and one `$search` probe; **throws** if either returns 0 results (Atlas Search is eventually consistent — this catches the "empty results on a fresh cluster" demo-killer). Retries the search probe a few times with a delay before failing.

- [ ] **Step 1: Write the failing test** (fake `Db` whose `aggregate` returns a scripted result; assert throw-on-empty and pass-on-hit)

```typescript
// src/data/search-self-check.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runSearchSelfCheck } from './search-self-check';

function fakeDb(results: any[][]) {
  let call = 0;
  return {
    collection() {
      return {
        aggregate() {
          const r = results[Math.min(call, results.length - 1)];
          call++;
          return { toArray: async () => r };
        },
      };
    },
  };
}
const embed = async (texts: string[]) => texts.map(() => Array.from({ length: 1024 }, () => 0.1));

describe('runSearchSelfCheck', () => {
  it('passes when both probes return hits', async () => {
    const db = fakeDb([[{ transaction_id: 'x' }], [{ transaction_id: 'y' }]]);
    await expect(runSearchSelfCheck(db as any, embed)).resolves.toBeUndefined();
  });

  it('throws when a probe returns no results', async () => {
    const db = fakeDb([[]]); // vector probe empty
    await expect(runSearchSelfCheck(db as any, embed, { retries: 1, delayMs: 0 })).rejects.toThrow(/self-check/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/data/search-self-check.test.ts`
Expected: FAIL — `Cannot find module './search-self-check'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/data/search-self-check.ts
import type { Db } from 'mongodb';
import { logger } from '../observability/logger';
import type { EmbedFn } from './seed-transactions';
import {
  TRANSACTIONS_COLLECTION, TRANSACTIONS_VECTOR_INDEX, TRANSACTIONS_SEARCH_INDEX,
} from '../mastra/schemas/transactions';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runSearchSelfCheck(
  db: Db, embed: EmbedFn, opts: { retries?: number; delayMs?: number } = {},
): Promise<void> {
  const retries = opts.retries ?? 8;
  const delayMs = opts.delayMs ?? 2000;
  const col = db.collection(TRANSACTIONS_COLLECTION);
  const [qvec] = await embed(['cash deposit just under the reporting threshold']);

  // Vector probe.
  const vHits = await col.aggregate([
    { $vectorSearch: { index: TRANSACTIONS_VECTOR_INDEX, path: 'embedding', queryVector: qvec, numCandidates: 50, limit: 3 } },
    { $project: { _id: 0, transaction_id: 1 } },
  ]).toArray();
  if (vHits.length === 0) {
    throw new Error('search self-check FAILED: $vectorSearch returned 0 results after seeding');
  }

  // Search probe, with retries for Atlas Search eventual consistency.
  for (let attempt = 0; attempt <= retries; attempt++) {
    const sHits = await col.aggregate([
      { $search: { index: TRANSACTIONS_SEARCH_INDEX, text: { query: 'cash deposit threshold', path: ['text'] } } },
      { $limit: 3 }, { $project: { _id: 0, transaction_id: 1 } },
    ]).toArray().catch(() => []);
    if (sHits.length > 0) { logger.info('search self-check OK', { vector: vHits.length, search: sHits.length }); return; }
    if (attempt < retries) await sleep(delayMs);
  }
  throw new Error('search self-check FAILED: $search returned 0 results after retries (index not ready or unpopulated)');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/data/search-self-check.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite + typecheck + commit**

```bash
pnpm vitest run
pnpm typecheck
git add src/data/search-self-check.ts src/data/search-self-check.test.ts
git commit -m "feat(data): fail-loud post-seed vector+search self-check"
```

- [ ] **Step 6 (integration, requires a cluster): run the real provision+seed**

Run: `MONGODB_URI=... VOYAGE_API_KEY=... pnpm provision`
Expected: logs `server supports $rankFusion`, `transactions vector index ready`, `seeded transactions { written: >=14 }`, `search self-check OK`, `provision-and-seed complete`; process exits 0.

---

## Self-Review

**Spec coverage (§3 Data layer + §5 eval-label seed):**
- `transactions` collection + fields + `status` lifecycle + `lane` label + `model_used` flag → Task 1 ✓
- `transactions_vector_index` (1024-d cosine) + `transactions_search_index` → Task 3 ✓
- Hybrid `$rankFusion` 8.0+ guard → Task 3 (`assertRankFusionSupported`) ✓
- Labeled 6-lane corpus, ring cycle for `$graphLookup`, `expected_disposition` eval labels → Task 2 ✓
- Idempotent provision + seed script → Task 5 ✓
- Post-seed search self-check (regression fence) → Task 6 ✓
- `DECIDED_STATUSES` single source of truth (regression fence) → Task 1, used in Task 4 ✓
- Configurable name / no forbidden terms → Global Constraints (no product name is written in this plan's source; enforced in later UI/config plan) ✓

**Deferred to later plans (correctly out of scope here):** `cases`, `case_decisions`, `verdict_memory`, `policies`, `audit_trail`, `reviews`, `decision_metrics`, `response_cache` collections are provisioned by the plans that own them (retrieval/decision/governance/workflow/UI/eval). Plan 1 delivers only the retrieval+SoR foundation, which is independently testable.

**Placeholder scan:** none — every code step is complete; the only prose-authoring step (Task 2 Step 3, remaining lanes) is bounded by explicit shape + the test that gates it.

**Type consistency:** `EmbedFn` defined in Task 4 and reused in Task 6; `DECIDED_STATUSES`/`LANES`/index-name constants defined in Task 1 and imported everywhere; `seedTransactions(col, embed)` / `runSearchSelfCheck(db, embed, opts?)` signatures match their call sites in Task 5. ✓

**Assumption to verify at execution time:** the package manager is `pnpm` (sibling app uses it) and `getQueryEmbedder(cfg)` / `logger` / `loadConfig` exist in this repo once the base scaffolding is copied from the sibling app. If the base scaffolding is not yet present, a Task 0 (copy `src/config.ts`, `src/observability/logger.ts`, `src/mastra/embed.ts` from the sibling app and adapt) must run first.
