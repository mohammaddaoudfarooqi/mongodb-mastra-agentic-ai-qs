# Marshal — Plan 0: Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the minimal runnable TypeScript/Mastra scaffolding for Marshal in the empty `mongodb-mastra-agentic-ai-qs` repo — package manifest, TS/vitest/tsx config, a config loader with a **configurable app name**, a structured logger, the Voyage embedder, and a one-route Hono server — so Plan 1 (data layer) and every later plan have the base modules they import (`src/config`, `src/observability/logger`, `src/mastra/embed`) and a green `pnpm test` / `pnpm typecheck`.

**Architecture:** Port the proven base modules from the sibling app (`mongodb-mastra-ai-qs`) near-verbatim, trimmed to what Marshal needs now (no storefront/cart/order code). Config is a Zod-validated `loadConfig()` reading env; the app name is a first-class config field (`appName`, default "Marshal", env `APP_NAME`) so it is never hardcoded. The embedder is the direct-Voyage multimodal client (1024-dim cosine) the sibling app uses.

**Tech Stack:** TypeScript 5, Node 22, `pnpm`, `hono` ^4 + `@hono/node-server`, `mongodb` ^6, `@mastra/core` / `@mastra/mongodb` / `@mastra/memory` / `@mastra/voyageai` (latest), `voyageai` 0.3.1, `zod` ^3, `tsx` ^4, `vitest` ^2.

## Global Constraints

- **One Atlas cluster, one connection string.** MongoDB only.
- **Embeddings:** Voyage `voyage-multimodal-3.5`, **1024-dim, cosine**, via the MongoDB-hosted Voyage endpoint (`https://ai.mongodb.com/v1`) by default.
- **Configurable app name:** the product name **Marshal** MUST come from config (`cfg.appName`, env `APP_NAME`, default `"Marshal"`). Never hardcode a product name in source, UI, or metadata.
- **Forbidden copy:** do NOT use the term "Constitutional AI" anywhere. Do NOT name other vendors' products in code, comments, or copy.
- **Package manager is `pnpm`.** All commands use `pnpm`.
- **TDD, DRY, YAGNI, frequent commits.**

---

### Task 1: Package manifest, TS/vitest config, and .gitignore

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `test/ignore-mastra-storage-init-rejection.ts`

**Interfaces:**
- Produces: `pnpm test`, `pnpm test:watch`, `pnpm typecheck`, `pnpm dev` scripts; the vitest include globs Plan 1+ rely on (`src/**/*.test.ts`, `scripts/**/*.test.ts`).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "mongodb-mastra-agentic-ai-qs",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx src/server/app.ts"
  },
  "dependencies": {
    "@ai-sdk/amazon-bedrock": "latest",
    "@ai-sdk/anthropic": "latest",
    "@ai-sdk/openai": "latest",
    "@hono/node-server": "^2.0.8",
    "@mastra/core": "latest",
    "@mastra/memory": "latest",
    "@mastra/mongodb": "latest",
    "@mastra/voyageai": "latest",
    "hono": "^4",
    "mongodb": "^6",
    "voyageai": "0.3.1",
    "zod": "^3"
  },
  "devDependencies": {
    "@types/node": "^22",
    "mastra": "^1.18.0",
    "tsx": "^4",
    "typescript": "^5",
    "vitest": "^2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`** (identical to the sibling app)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "outDir": "dist",
    "lib": ["ES2022"]
  },
  "include": ["src", "tests", "scripts"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    setupFiles: ['./test/ignore-mastra-storage-init-rejection.ts'],
    onConsoleLog(log) {
      if (log.includes('Storage init failed; will retry on next storage call')) return false;
      if (log.includes('MASTRA_STORAGE_MONGODB_CREATE_DEFAULT_INDEXES_FAILED')) return false;
      return undefined;
    },
  },
  resolve: {
    alias: {
      'voyageai/dist/esm/api': 'voyageai/dist/esm/api/index.mjs',
    },
  },
});
```

- [ ] **Step 4: Write the test setup file**

```typescript
// test/ignore-mastra-storage-init-rejection.ts
// Mastra's background createDefaultIndexes() can reject on DNS failure AFTER a test finishes
// when a store is built against a placeholder Atlas URI. Drop ONLY that specific rejection so
// real failures still surface.
process.on('unhandledRejection', (reason: unknown) => {
  const msg = String((reason as { message?: string })?.message ?? reason);
  if (msg.includes('Storage init failed') || msg.includes('MASTRA_STORAGE_MONGODB_CREATE_DEFAULT_INDEXES_FAILED')) return;
  throw reason;
});
```

- [ ] **Step 5: Write `.gitignore`**

```gitignore
node_modules
dist
.mastra
.env
*.log
.DS_Store
```

- [ ] **Step 6: Install deps and verify tooling runs**

Run: `pnpm install`
Then: `pnpm typecheck`
Expected: `pnpm install` succeeds; `pnpm typecheck` passes (no source yet → no errors).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore test/ignore-mastra-storage-init-rejection.ts
git commit -m "chore: bootstrap package manifest, tsconfig, vitest config"
```

---

### Task 2: Structured logger

**Files:**
- Create: `src/observability/logger.ts`
- Test: `src/observability/logger.test.ts`

**Interfaces:**
- Produces: `logger` (`.info/.warn/.error/.counter/.snapshot`), `LogRecord`, `LogSink`, `setLogSink`. Used by every later module.

- [ ] **Step 1: Write the failing test**

```typescript
// src/observability/logger.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger, setLogSink } from './logger';

afterEach(() => setLogSink(null));

describe('logger', () => {
  it('emits single-line JSON to console.log for info', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('hello', { a: 1 });
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ msg: 'hello', level: 'info', a: 1 });
    spy.mockRestore();
  });

  it('mirrors to an attached sink without throwing when the sink throws', () => {
    setLogSink({ write: () => { throw new Error('sink boom'); } });
    expect(() => logger.info('safe')).not.toThrow();
  });

  it('counts and snapshots counters', () => {
    logger.counter('probe', 2);
    logger.counter('probe');
    expect(logger.snapshot().probe).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/observability/logger.test.ts`
Expected: FAIL — `Cannot find module './logger'`.

- [ ] **Step 3: Write the implementation** (verbatim port from the sibling app)

```typescript
// src/observability/logger.ts
type Fields = Record<string, unknown>;
type Level = 'info' | 'warn' | 'error';

const counters = new Map<string, number>();

export interface LogRecord { ts: Date; level: Level; msg: string; fields?: Fields; }
export interface LogSink { write: (rec: LogRecord) => void; }

let sink: LogSink | null = null;
export function setLogSink(next: LogSink | null): void { sink = next; }

function emit(level: Level, msg: string, fields?: Fields) {
  const ts = new Date();
  const line = JSON.stringify({ ...(fields ?? {}), ts: ts.toISOString(), level, msg });
  if (level === 'error') console.error(line);
  else console.log(line);
  if (sink) { try { sink.write({ ts, level, msg, fields }); } catch { /* logging must never throw */ } }
}

export const logger = {
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
  counter: (name: string, delta = 1) => counters.set(name, (counters.get(name) ?? 0) + delta),
  snapshot: (): Record<string, number> => Object.fromEntries(counters),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/observability/logger.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/observability/logger.ts src/observability/logger.test.ts
git commit -m "feat(obs): structured logger with pluggable fail-open sink"
```

---

### Task 3: Config loader with configurable app name

**Files:**
- Create: `src/config.ts`
- Create: `.env.example`
- Test: `src/config.test.ts`

**Interfaces:**
- Produces: `Config` (interface), `loadConfig(env?): Config`. Fields needed by Plans 0–1: `appName`, `mongoUri`, `mongoDb`, `voyageApiKey`, `voyageBaseUrl?`, `llmProvider`, `llmModel`, `port`, `rrfK`. (Later plans extend `Config`; keep this minimal — YAGNI.)

- [ ] **Step 1: Write the failing test**

```typescript
// src/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

const base = { MONGODB_URI: 'mongodb+srv://x', VOYAGE_API_KEY: 'vk' };

describe('loadConfig', () => {
  it('defaults the app name to Marshal', () => {
    expect(loadConfig(base).appName).toBe('Marshal');
  });
  it('overrides the app name from APP_NAME', () => {
    expect(loadConfig({ ...base, APP_NAME: 'Case Zero' }).appName).toBe('Case Zero');
  });
  it('requires MONGODB_URI', () => {
    expect(() => loadConfig({ VOYAGE_API_KEY: 'vk' })).toThrow(/MONGODB_URI/);
  });
  it('defaults db, provider, model, port, rrfK', () => {
    const c = loadConfig(base);
    expect(c.mongoDb).toBe('marshal');
    expect(c.llmProvider).toBe('anthropic');
    expect(c.llmModel).toBe('claude-haiku-4-5');
    expect(c.port).toBe(8000);
    expect(c.rrfK).toBe(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/config.test.ts`
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/config.ts
import { z } from 'zod';

export interface Config {
  appName: string;
  mongoUri: string;
  mongoDb: string;
  voyageApiKey: string;
  voyageBaseUrl?: string;
  llmProvider: 'anthropic' | 'openai' | 'bedrock';
  llmModel: string;
  llmBaseUrl?: string;
  llmGatewayApiKey?: string;
  bedrockRegion?: string;
  port: number;
  rrfK: number;
}

const EnvSchema = z.object({
  APP_NAME: z.string().min(1).default('Marshal'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB: z.string().min(1).default('marshal'),
  VOYAGE_API_KEY: z.string().min(1, 'VOYAGE_API_KEY is required'),
  VOYAGE_BASE_URL: z.string().optional(),
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'bedrock']).default('anthropic'),
  LLM_MODEL: z.string().min(1).default('claude-haiku-4-5'),
  LLM_BASE_URL: z.string().optional(),
  LLM_GATEWAY_API_KEY: z.string().optional(),
  BEDROCK_REGION: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(8000),
  RRF_K: z.coerce.number().int().positive().default(60),
});

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Config {
  const e = EnvSchema.parse(env);
  return {
    appName: e.APP_NAME,
    mongoUri: e.MONGODB_URI,
    mongoDb: e.MONGODB_DB,
    voyageApiKey: e.VOYAGE_API_KEY,
    voyageBaseUrl: e.VOYAGE_BASE_URL,
    llmProvider: e.LLM_PROVIDER,
    llmModel: e.LLM_MODEL,
    llmBaseUrl: e.LLM_BASE_URL,
    llmGatewayApiKey: e.LLM_GATEWAY_API_KEY,
    bedrockRegion: e.BEDROCK_REGION,
    port: e.PORT,
    rrfK: e.RRF_K,
  };
}
```

- [ ] **Step 4: Write `.env.example`**

```bash
# Marshal — environment
APP_NAME=Marshal
MONGODB_URI=mongodb+srv://USER:PASS@CLUSTER/?retryWrites=true&w=majority
MONGODB_DB=marshal
VOYAGE_API_KEY=
# Optional: leave unset to use the MongoDB-hosted Voyage endpoint (https://ai.mongodb.com/v1)
VOYAGE_BASE_URL=
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5
PORT=8000
RRF_K=60
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck & commit**

```bash
pnpm typecheck
git add src/config.ts src/config.test.ts .env.example
git commit -m "feat(config): env-validated config loader with configurable app name"
```

---

### Task 4: Voyage embedder

**Files:**
- Create: `src/mastra/embed.ts`
- Test: `src/mastra/embed.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 3).
- Produces: `VoyageEmbedder` (`embedQuery(q): Promise<number[]>`), `createVoyageEmbedder(deps)`, `getQueryEmbedder(cfg)`, `buildMultimodalInputs`, `resolveVoyageBaseUrl`, `MULTIMODAL_MODEL`, `MONGODB_VOYAGE_BASE_URL`. (Plan 1 uses `getQueryEmbedder(cfg).embedQuery`.)

- [ ] **Step 1: Write the failing test** (hermetic — a fake client, no live Voyage)

```typescript
// src/mastra/embed.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildMultimodalInputs, createVoyageEmbedder, resolveVoyageBaseUrl,
  MONGODB_VOYAGE_BASE_URL, type MultimodalEmbedClient,
} from './embed';

describe('embed', () => {
  it('wraps text into object-shaped multimodal inputs', () => {
    expect(buildMultimodalInputs(['hi'])).toEqual([{ content: [{ type: 'text', text: 'hi' }] }]);
  });

  it('embedQuery returns the vector for index 0', async () => {
    const client: MultimodalEmbedClient = {
      async multimodalEmbed() { return { data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }; },
    };
    const emb = createVoyageEmbedder({ client });
    expect(await emb.embedQuery('q')).toEqual([0.1, 0.2, 0.3]);
  });

  it('defaults to the MongoDB-hosted Voyage endpoint', () => {
    expect(resolveVoyageBaseUrl({ voyageBaseUrl: undefined } as any)).toBe(MONGODB_VOYAGE_BASE_URL);
    expect(resolveVoyageBaseUrl({ voyageBaseUrl: 'https://custom' } as any)).toBe('https://custom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/mastra/embed.test.ts`
Expected: FAIL — `Cannot find module './embed'`.

- [ ] **Step 3: Write the implementation** (port the query-embedder subset from the sibling app; omit the doc-embedder/reranker until a later plan needs them — YAGNI)

```typescript
// src/mastra/embed.ts
import { VoyageAIClient } from 'voyageai';
import type { Config } from '../config';

export const MULTIMODAL_MODEL = 'voyage-multimodal-3.5';
export const MONGODB_VOYAGE_BASE_URL = 'https://ai.mongodb.com/v1';

export interface MultimodalInput { content: { type: 'text'; text: string }[]; }

export function buildMultimodalInputs(texts: string[]): MultimodalInput[] {
  return texts.map(text => ({ content: [{ type: 'text', text }] }));
}

export interface MultimodalEmbedClient {
  multimodalEmbed(request: {
    inputs: MultimodalInput[]; model: string; inputType?: 'query' | 'document';
  }): Promise<{ data?: { index?: number; embedding?: number[] }[] }>;
}

export interface VoyageEmbedder { embedQuery(query: string): Promise<number[]>; }

export function createVoyageEmbedder(deps: { client: MultimodalEmbedClient; model?: string }): VoyageEmbedder {
  const model = deps.model ?? MULTIMODAL_MODEL;
  return {
    async embedQuery(query: string): Promise<number[]> {
      const res = await deps.client.multimodalEmbed({
        inputs: buildMultimodalInputs([query]), model, inputType: 'query',
      });
      const rows = res.data ?? [];
      const first = rows.find(r => (r.index ?? 0) === 0) ?? rows[0];
      return first?.embedding ?? [];
    },
  };
}

export function resolveVoyageBaseUrl(cfg: Config): string {
  return cfg.voyageBaseUrl ?? MONGODB_VOYAGE_BASE_URL;
}

function voyageClient(cfg: Config): VoyageAIClient {
  return new VoyageAIClient({ apiKey: cfg.voyageApiKey, baseUrl: resolveVoyageBaseUrl(cfg) } as any);
}

export function getQueryEmbedder(cfg: Config): VoyageEmbedder {
  return createVoyageEmbedder({ client: voyageClient(cfg) as unknown as MultimodalEmbedClient, model: MULTIMODAL_MODEL });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/mastra/embed.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck & commit**

```bash
pnpm typecheck
git add src/mastra/embed.ts src/mastra/embed.test.ts
git commit -m "feat(embed): Voyage multimodal query embedder (1024-dim cosine)"
```

---

### Task 5: Minimal Hono server with a health route that reports the app name

**Files:**
- Create: `src/server/app.ts`
- Test: `src/server/app.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 3), `logger` (Task 2).
- Produces: `createApp(cfg): Hono` — an app with `GET /api/health` returning `{ status: 'ok', app: cfg.appName }`. Later plans mount routes on this app.

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/app.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from './app';

const cfg = { appName: 'Marshal', port: 8000 } as any;

describe('health route', () => {
  it('returns ok and the configured app name', async () => {
    const app = createApp(cfg);
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', app: 'Marshal' });
  });

  it('reflects a custom app name', async () => {
    const app = createApp({ ...cfg, appName: 'Case Zero' });
    const res = await app.request('/api/health');
    expect((await res.json()).app).toBe('Case Zero');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/app.test.ts`
Expected: FAIL — `Cannot find module './app'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/app.ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Config } from '../config';
import { loadConfig } from '../config';
import { logger } from '../observability/logger';

export function createApp(cfg: Config): Hono {
  const app = new Hono();
  app.get('/api/health', c => c.json({ status: 'ok', app: cfg.appName }));
  return app;
}

// Entry point: `pnpm dev`. Guarded so importing this module in tests does not start a server.
if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.loadEnvFile(); } catch { /* .env optional */ }
  const cfg = loadConfig();
  const app = createApp(cfg);
  serve({ fetch: app.fetch, port: cfg.port }, info => {
    logger.info('server listening', { app: cfg.appName, port: info.port });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/server/app.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `pnpm vitest run && pnpm typecheck`
Expected: all tests pass (logger 3 + config 4 + embed 3 + app 2 = 12), typecheck clean.

- [ ] **Step 6: Smoke-test the server boots**

Run: `MONGODB_URI=mongodb+srv://x VOYAGE_API_KEY=x PORT=8001 pnpm dev` (Ctrl-C after the "server listening" log)
Expected: logs `{"app":"Marshal","port":8001,...,"msg":"server listening"}`.

- [ ] **Step 7: Commit**

```bash
git add src/server/app.ts src/server/app.test.ts
git commit -m "feat(server): minimal Hono app with app-name-aware health route"
```

---

### Task 6: README stub

**Files:**
- Create: `README.md`

**Interfaces:** none (docs only). Folded into Plan 0 because the repo needs a top-level entry point and the setup commands are now real.

- [ ] **Step 1: Write `README.md`**

```markdown
# Marshal — Fraud Investigation Console (MongoDB + Mastra)

A fraud/claims investigation console for banks and insurers, built on **MongoDB Atlas + Mastra**.
It collapses the agent stack — vector search, full-text, hybrid, graph, durable workflow state,
long-term memory, time-series metrics, system-of-record, and audit — onto **one Atlas cluster,
one connection string**.

> The product name is configurable via `APP_NAME` (default "Marshal").

## Quick start

```bash
pnpm install
cp .env.example .env    # set MONGODB_URI and VOYAGE_API_KEY
pnpm dev                # starts the API on http://localhost:8000
curl localhost:8000/api/health   # { "status": "ok", "app": "Marshal" }
```

## Tests

```bash
pnpm test        # vitest run
pnpm typecheck   # tsc --noEmit
```

See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for the build plans.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with quick start and app-name note"
```

---

## Self-Review

**Goal coverage:** base modules Plan 1 imports — `src/config` (Task 3), `src/observability/logger` (Task 2), `src/mastra/embed` with `getQueryEmbedder` (Task 4) — all delivered; runnable server (Task 5); green `pnpm test`/`pnpm typecheck` (Task 5 Step 5). ✓

**Configurable app name:** `cfg.appName` from `APP_NAME` (default "Marshal"), surfaced via `/api/health`, asserted in Task 3 and Task 5 tests; README notes it. No product name is hardcoded in logic. ✓

**Placeholder scan:** none — every code step is complete and copied from the verified sibling-app source or written in full.

**Type consistency:** `getQueryEmbedder(cfg).embedQuery` (Task 4) matches Plan 1 Task 5's usage; `Config` fields (`appName`, `mongoUri`, `mongoDb`, `voyageApiKey`, `voyageBaseUrl`, `port`, `rrfK`) cover Plan 1's `loadConfig` consumers. `MongoDBVector` construction Plan 1 uses is from `@mastra/mongodb` (declared in Task 1 deps). ✓

**Note for later plans:** `Config` is intentionally minimal here; Plans 2–7 extend it (e.g. `memory`, `responseCache`, governance thresholds, `authMode`) as each feature needs them, each with its own default + test — do NOT front-load unused fields (YAGNI).
