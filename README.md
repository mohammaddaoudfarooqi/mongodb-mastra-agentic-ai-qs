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
