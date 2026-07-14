# Marshal: Fraud Investigation Console (MongoDB + Mastra)

A fraud/claims investigation console for banks and insurers, built on **MongoDB Atlas + Mastra**.
It collapses the agent stack (vector search, full-text, hybrid, graph, durable workflow state,
long-term memory, time-series metrics, system-of-record, and audit) onto **one Atlas cluster,
one connection string**.

> The product name is configurable via `APP_NAME` (default "Marshal").

## Quick start

```bash
pnpm install
cp .env.example .env    # set MONGODB_URI and VOYAGE_API_KEY
pnpm provision          # indexes + seed cases + the synthetic precedent corpus (SEED_SCALE_COUNT, default 1200)
pnpm bake               # record one real agent run into the immutable replay_* collections (demo mode)
pnpm dev                # starts the API on http://localhost:8000
curl localhost:8000/api/health   # { "status": "ok", "app": "Marshal" }
```

`pnpm bake` is required only for demo mode, but running it as part of every deploy is safe and
recommended so the booth build is always ready.

**Fresh cluster with no LLM access?** The committed recording restores demo mode without baking:

```bash
pnpm provision          # transactions + policies + the synthetic corpus (deterministic, no LLM output)
pnpm restore:replay     # load the committed demo recording from data/replay/ into replay_* (no LLM)
DEMO_MODE=1 pnpm dev
```

## Data safety: the demo recording

`pnpm bake` records a run of the **real** LLM agent, so it is not byte-reproducible. The recording
is therefore committed to `data/replay/*.json` (Extended JSON, preserving `_id` order for the audit
hash chain). After a bake you're happy with, snapshot it into git:

```bash
pnpm export:replay      # replay_* collections -> data/replay/*.json   (commit these)
pnpm restore:replay     # data/replay/*.json -> replay_* collections   (recover / seed a new cluster)
```

The synthetic corpus and policies are regenerated deterministically by `pnpm provision`, so only the
LLM-produced recording needs version control.

## Modes

- **Live** (default): ▶ Launch runs the real Mastra agent over every pending case; the UI,
  including the center-stage investigation theater, is a pure projection of MongoDB change streams.
  Writes land in the working collections (`agent_events`, `case_analysis`, `reviews`, `audit_trail`).
- **Demo** (`DEMO_MODE=1`): ▶ Replay animates a pre-baked recording of a real run: no runtime LLM,
  no per-viewer writes, safe for hundreds of concurrent viewers. The UI labels itself as a replay
  everywhere it appears.

### Why demo and live never collide

`pnpm bake` snapshots the recorded run into dedicated **`replay_*`** collections
(`replay_events`, `replay_analysis`, `replay_reviews`, `replay_audit`). Demo mode reads *only*
those; live runs and resets touch *only* the working collections. So a presenter can switch modes,
run live investigations, and reset, all without ever corrupting the demo recording. Re-baking is
the only thing that rewrites the replay copies. (Isolation lives in `src/data/replay-store.ts`;
`recordingSource(demoMode)` picks the read source per mode.) Run `pnpm beat:*` with the **same
`DEMO_MODE`** as the server so the audit beats target the chain the console is verifying.

## Stage beats (presenter)

Each is a real database write; every connected console reacts through the change stream:

```bash
pnpm beat:policy    # touch a policy doc      -> "POLICY UPDATED LIVE" banner
pnpm beat:tamper    # corrupt one audit field -> "AUDIT CHAIN BROKEN" alarm
pnpm beat:restore   # undo the tampering      -> "AUDIT CHAIN RESTORED"
```

## Deploy to AWS + Atlas (one command)

```bash
cp deploy/terraform/terraform.tfvars.example deploy/terraform/terraform.tfvars
export TF_VAR_atlas_public_key=...  TF_VAR_atlas_private_key=...  TF_VAR_atlas_org_id=...
export TF_VAR_voyage_api_key=...
deploy/scripts/deploy.sh
```

Stands up EC2 (Docker + nginx) + a MongoDB Atlas M10 (replica set, needed for change streams)
over AWS↔Atlas VPC peering, deploys **demo mode** by default (replays the committed recording, no
LLM at runtime), and loads the corpus + recording into Atlas. Full guide: [`deploy/README.md`](deploy/README.md).
Presenter walkthrough for the Ai4 demo: [`story.md`](story.md).

## Tests

```bash
pnpm test        # vitest run
pnpm typecheck   # tsc --noEmit
pnpm eval        # decision-quality scorecard over the labeled lanes (live agent required)
```

See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for the build plans.
