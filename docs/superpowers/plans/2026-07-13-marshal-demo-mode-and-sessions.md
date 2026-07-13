# Marshal — Branding, DEMO_MODE Replay & Session Isolation

**Goal:** Make one codebase serve two purposes — a **prod-ready quickstart** (live agent + real LLM) and a **deterministic, free, instant, unbreakable stage/booth demo** (replays a pre-baked investigation, no runtime LLM) — plus MongoDB × Mastra branding and lightweight per-user session isolation so 100+ concurrent attendees don't collide.

**Why:** All transactions are pre-existing seed data; the LLM only re-derives the same verdicts at temp 0 every run. Replaying a recorded real run is instant, costs nothing, can't fail on stage, and is indistinguishable in the UI. Tokens should be spent by attendees running the shared quickstart on their own keys.

## Global Constraints
- One codebase. `DEMO_MODE` (env `DEMO_MODE`, default `false`).
  - `false` = quickstart: live Mastra agent + real LLM (current behavior).
  - `true` = stage/booth: Launch replays baked `case_analysis` + `agent_events`; NO runtime LLM.
- The baked replay is a **real recorded run** (run the actual engine once at seed time, freeze output). Honest — "recorded live", not faked.
- Branding: MongoDB green `#00ED64`, evergreen `#001E2B`; Mastra mark monochrome (#f0f4f8); hairline divider (not "+") between marks; copy "Powered by MongoDB Atlas + Mastra".
- Session isolation mirrors MongodbUnpacked: stateless HMAC token (`sid.exp.mac`), sid from token never body, `sessionId` on per-user writes, per-session reset, 24h TTL. In replay mode the only per-user state is HITL resolutions.
- TDD where there's logic; every step ends green + committed.

---

## Phase 1 — Branding
- Create `public/brand.js` exporting `mongoLeafSVG()`, `mastraMarkSVG()` (verbatim paths from sibling `brand.tsx`).
- Header: replace text brand with MongoLeaf + hairline divider + MastraMark + "MARSHAL" + tagline "MongoDB Atlas + Mastra · fraud investigation".
- Footer: keep "● MongoDB Atlas" live bar; add "Powered by MongoDB Atlas + Mastra".
- Palette: align `--mongo` to `#00ED64`; add favicon (leaf + mastra tile).
- Verify: screenshot shows both marks.

## Phase 2 — DEMO_MODE replay
- `config.ts`: add `demoMode: boolean` (env `DEMO_MODE`).
- Seed: `scripts/bake-replay.ts` runs the real engine once over all live cases, leaving `case_analysis` + an ordered `agent_events` timeline persisted (the "recording"). Idempotent.
- Runtime:
  - `POST /api/investigate/run` in demo mode → does NOT call the agent; instead marks cases for replay and returns immediately.
  - Replay driver: re-emit the baked `agent_events` for each case on a timer (server-side re-insert into a session feed, OR client-side animation over `GET /api/replay`). Choose client-side animation over stored data (no writes, scales best): `GET /api/replay` returns the ordered baked events; the client animates them into the feed + lights the rail, then loads the case_analysis for detail/gate.
  - Reset in demo mode: clears only per-session resolutions (see Phase 3), never the baked replay.
- `GET /api/mode` exposes `{ demoMode }` so the UI adapts labels.
- Verify: with DEMO_MODE=1, Launch fills feed + rail instantly, cases resolve, ZERO LLM calls (assert no agent invocation).

## Phase 3 — Session isolation
- `lib/session.ts`: `sign(sid)`, `verify(token)` (HMAC `sid.exp.mac`, 30-min TTL) — unit-tested.
- `POST /api/token` → `{ token, sessionId }`. Client mints once, caches in sessionStorage, sends `Authorization: Bearer`.
- Scope per-user writes by `sessionId`: HITL resolutions (`reviews` resolve, `case_decisions` from human) and the per-session view of which cases are resolved. Baked replay data (`case_analysis`, `agent_events`, `transactions`, `policies`) stays global read-only.
- Per-session reset: `deleteMany({ sessionId })` on session-scoped collections only.
- TTL indexes (24h) on session-scoped collections.
- Verify: two sessions resolve independently; one reset doesn't affect the other.

## Self-review
- Covers: branding (P1), deterministic replay + prod/demo split (P2), 100+ concurrency (P3).
- Prod path unchanged when DEMO_MODE=false.
