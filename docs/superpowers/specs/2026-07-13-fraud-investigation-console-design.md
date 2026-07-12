# Fraud Investigation Console — Design

**Status:** Approved design (pre-implementation)
**Date:** 2026-07-13
**Repo:** `mongodb-mastra-agentic-ai-qs`
**Purpose:** Hero app for the joint MongoDB + Mastra session at Ai4 2026 —
*"For Agents: Deployment at Scale — Collapsing the Agent Stack with MongoDB + Mastra."*

---

## 1. Concept & stage narrative

A **fraud / claims investigation console** for banks and insurers, built on **MongoDB Atlas +
Mastra (TypeScript)** with a live control-room UI.

The session thesis: a production agent needs retrieval, durable state, and long-term memory, and
most teams buy four systems to get them — a vector database, a keyword engine, a graph store, a
system of record. Every seam is another credential, another integration, another place the
agent's view of the world drifts. This app collapses all of it onto **one Atlas cluster, one
connection string**.

**On-stage framing rules:**
- The story is **MongoDB + Mastra only**. Do **not** name other partner products or platforms on
  stage or in the repo narrative (no free advertising).
- Do **not** use the term "Constitutional AI" anywhere. The governance layer is called the
  **Policy Governance Layer** (see §2, §3).
- "Collapse the stack" is claimed honestly: vector (`$vectorSearch`) + full-text (`$search`) +
  hybrid (`$rankFusion`) + graph (`$graphLookup`) + durable workflow state + long-term memory +
  time-series metrics + system-of-record + audit + semantic cache — all natively on one cluster.
  A **separate workflow engine is also collapsed away**: Mastra's durable suspend/resume backed by
  MongoDB replaces it.

**Payoff line (the session's own):** *vector search, full-text, graph, memory, and conversational
state — one operational data layer, one cluster, one connection string.*

### Audience (drives every priority)
Ai4 2026, ~12,000 attendees, 50:50 business/tech, **96% budget influence, 54% director-level+**.
Largest segments: **Financial Services, Insurance, Healthcare, Manufacturing**. This is an
enterprise-buyer room in regulated industries — so the app must make a **TCO/ops + governance**
argument land, not just look clever. Governance and a real evaluation story are the differentiators
this audience cares about most.

### Format & timing
Finished app, **live walkthrough** (not live-coded). Session is ~20 min → **~12 min of live demo**.
Rich app, but the on-stage narrative lands 2–3 flows; every flow visibly hits multiple pillars.

---

## 2. Architecture & agent flow

**One Mastra agent, a deterministic decision core, a Policy Governance Layer on every action, one
Atlas cluster.** The agent *proposes and narrates*; TypeScript *decides* (the consistent lesson
from the strongest reference apps and the author's own Temporal app: never let the LLM be the
final judge).

Durable investigation workflow (Mastra durable workflow with `suspend`/`resume`):

1. **Triage** — deterministic rules + a compliance gate run first (structuring $4,900–4,999,
   velocity, sanctions). A hard compliance hit → deterministic reject; the LLM is never called.
2. **Retrieve** (agent tools, all one cluster):
   - `search_precedent` — `$vectorSearch`, filtered to *decided* cases.
   - `search_text` — Atlas `$search` (BM25) over narrative + names.
   - `hybrid_search` — `$rankFusion` (native RRF, MongoDB 8.0+), no client-side merge.
   - `trace_funds` — `$graphLookup` over `sender.account_number → recipient.account_number`
     for fraud-ring / circular-flow / layering signals.
   - `recall_verdicts` — long-term memory: retrieves & **cites** prior closed cases.
3. **Reason** — the agent emits a typed `{recommendation, confidence, risk_factors, rationale}`.
   Code reconciles: low confidence, high value, or ring-detected → must escalate.
4. **Govern** — the **Policy Governance Layer**: `$vectorSearch` retrieves the policies relevant
   to *this exact action*; an automated policy reviewer (LLM, structured output) returns cited
   violations; any citation that is not a real retrieved policy is dropped (anti-hallucination
   filter); a **deterministic severity score** decides the outcome. Below threshold → **hold +
   auto-escalate** to the review queue.
5. **Gate** — the workflow `suspend()`s at `PENDING_REVIEW`, persisting the case bound to an
   **evidence hash** = `sha256(canonicalize({snapshot, proposed_action}))`.
6. **Resume** — the analyst's approve/reject `resume()`s **the same durable run**; the server
   re-derives the hash from current DB state and refuses to resume if the evidence drifted (stale).
7. **Commit** — a **multi-document ACID transaction** flips case status + writes the immutable
   decision + appends a hash-chained audit event (payload **shape only**, never raw PII).
8. **Change streams** surface every write live to the UI, *and* make policy edits take effect
   instantly (cache invalidation).

**Optional stretch:** an independent **Challenger** agent (sees raw evidence only, never the
primary's rationale) that argues the opposite before the human gate; reconciled in code by
`abs(Δconfidence) ≤ T` → `CONFIRMED`/`DISPUTED`.

### Decision integrity (why this is defensible)
- Deterministic rules + compliance gate **bracket** the LLM (carried from the author's Temporal
  app): the LLM cannot override a hard reject, and a low-confidence LLM defers to the rules.
- The governance verdict is retrieval-grounded and citation-checked, not "an LLM says yes/no."
- Every irreversible action is gated behind a durable human approval bound to an evidence hash.

---

## 3. Data model & MongoDB roles (one cluster, every role)

All collections live on **one Atlas cluster, one connection string**. Field shapes are drawn from
the author's existing apps (CMA fraud-review cookbook, Temporal fraud app, governance engine) so
they are already proven.

### Retrieval + system-of-record
**`transactions`** — operational record *and* retrieval corpus (the "same documents" story).
- Fields: `transaction_id`, `text` (narrative), `amount`, `sender{name, account_number}`,
  `recipient{name, account_number}`, `status` (`pending`→`approved`/`rejected`/`escalated`),
  `lane` (ground-truth scenario tag, doubles as eval label), `embedding` (1024-d),
  `model_used` (`"historical"` flag separates seed corpus from live cases).
- `transactions_vector_index`: `type: vectorSearch`, path `embedding`, **numDimensions 1024,
  similarity cosine** (voyage-4, finance-tuned), filter fields `status`, `transaction_type`.
- `transactions_search_index`: Atlas `$search`, paths `text`, `sender.name`, `recipient.name`.
- Hybrid: `$rankFusion` over both (native, MongoDB 8.0+).
- Graph: `$graphLookup` `sender.account_number → recipient.account_number`, `maxDepth 3`.

### Durable state + decisions + memory
**`cases`** — investigation state machine (`OPEN→TRIAGED→INVESTIGATING→PENDING_REVIEW→
CLEARED/ESCALATED`); holds the Mastra workflow snapshot, `evidence_hash`, `proposed_action`.
**`case_decisions`** — immutable verdicts: `decision`, `confidence_score`, `risk_score`,
`reasoning{primary_reasoning, risk_factors, compliance_notes}`, `rules_triggered`, `similar_cases`,
`reviewed_by`, `model_version`.
**`verdict_memory`** — long-term memory: closed-case verdicts embedded; `recall_verdicts`
retrieves and cites priors. This is the "memory" pillar.

### Governance + audit + metrics
**`policies`** — `policy_code`, `policy_text`, `category`, `source` (regulation cite),
`ruleVersion`, `isCurrentVersion`, `embedding`; `policy_vector_index` + `policy_text_search_index`;
**partial-unique index** on `policy_code` where `isCurrentVersion:true` (immutable-append
versioning).
**`audit_trail`** — HMAC hash-chained, append-only: `previousHash`/`currentHash`, `eventType`,
`actor`, **payload shape only** (`sensitiveFieldNames` touched, not raw values). Tamper-evident via
a `verify_chain` recompute.
**`reviews`** — HITL queue: `flagReason`, `rulesTriggered`, `status`, `reviewDecision`,
`falsePositive` (feeds rule-effectiveness tuning).
**`decision_metrics`** — **time-series collection** (`timeField: timestamp`, `metaField: model`)
feeding the live latency / cost / score readout.

### Reactivity + cache
**Change streams** over the DB → SSE → UI; also policy-edit cache invalidation.
**`response_cache`** — semantic cache with TTL (the optional extra collapsed box).

### "Four+ systems" → one cluster
| Industry buys separately | Here it is |
| --- | --- |
| Vector DB | `$vectorSearch` |
| Keyword engine | `$search` |
| Graph store | `$graphLookup` |
| Cache | TTL `response_cache` |
| Workflow engine | Mastra durable state in `cases` |
| Metrics store | time-series `decision_metrics` |
| System of record + audit | `transactions` / `case_decisions` / `audit_trail` |

**Honest caveat for stage:** hybrid `$rankFusion` needs **MongoDB 8.0+** (every current Atlas
tier, including free M0 — so it holds by default).

---

## 4. Control-room UI

**Core principle (why the reference control-room won on design):** the UI is a *pure projection of
MongoDB writes*. Agents write to Atlas → one change stream → SSE → React renders. Nothing is
fabricated client-side; the audience literally watches DB writes land.

**Stack:** the existing Vite/React frontend. One SSE hook subscribes to a change-stream→SSE route
and runs a `switch(collection)` reducer. Keep the reference design system (dark glass panels,
**JetBrains Mono numerics**, semantic color + glow escalation, letter-spaced status pills).

**Layout** — full-viewport HUD grid (`64px / 1fr / 56px` rows; left/center/right columns):
- **Top bar** — brand, active case id + status chip, live latency.
- **Left: Case queue** — status cards, one per open case: risk-utilization bar, mono stats
  (amount, age, score), severity border/glow (reuse `.surge`/`.critical` escalation classes).
- **Center: Investigation timeline** — vertical append-only step stream surfaced by the change
  stream (triage → retrieval → graph ring → memory citation). Includes the **Governance card**
  (cited policy text + compliance score + HELD badge) — the dramatic beat.
- **Center action: the human gate** — Approve/Reject buttons POST the analyst verdict to a real
  inbound action API, which `resume()`s the same durable Mastra run. (This is the piece the
  reference app lacked and the author's Temporal app got wrong — see §7.)
- **Right: Agent operations feed** — prepend-capped cards `{tool/agent, headline, reasoning,
  action badge}`; each card *is* a DB insert.
- **Bottom bar: "MongoDB Atlas ● LIVE"** — ops ticker + per-collection write counters, extended
  with the latency / cost / eval-score readout from `decision_metrics`.

**Two signature live beats (both are just DB writes surfacing through the change stream):**
1. **Policy edit, live** — edit a `policies` doc in the DB → change stream flushes cache → the next
   identical case behaves differently, no redeploy. Fires a "POLICY UPDATED LIVE" banner.
2. **Audit integrity** — a `verify_chain` indicator glows green; tamper with one `audit_trail` doc
   and it flips red.

**Deliberately rebuilt (not copied from the reference):** React components + escaping (no
`innerHTML`/XSS with LLM strings), a real inbound action channel, React Router for case drill-down,
virtualized lists for the queue/feed.

---

## 5. Evaluation harness (the differentiator none of the reference apps had)

The credibility moat for a budget-holding, director-level audience: *"how do you know the agent is
right?"* None of the 100 corpus entries — nor either of the author's prior fraud apps — answered
this quantitatively.

**Labeled dataset** — the seed `transactions` corpus is the eval set: each case carries a `lane`
(ground truth: `clean_approve`, `clear_reject`, `structuring`, `high_value`, `ring`, `sanctions`)
and an `expected_disposition`. Doubles as demo fixtures and eval labels.

**Two scored layers (both stored in `decision_metrics`, both shown on stage):**
1. **Decision quality** — run the agent over the labeled set; compute **precision / recall / F1**
   per lane + a confusion matrix. Gate: `recall ≥ 0.95` on fraud lanes (a miss is the costly
   error); bounded false-positive rate.
2. **Governance quality** — does the reviewer cite a *real retrieved* policy (hallucination-filter
   drop rate = 0), does it flag the seeded violations, and does the audit chain verify?

**Regression fences** (the one genuinely rigorous piece of the author's Temporal app, carried over):
named tests fencing the `_DECIDED_STATUSES` single-source allowlist, the hybrid-score
renormalization, and a **post-seed search self-check** (probe a known-good query; fail loudly if
`$vectorSearch`/`$search` returns 0 — Atlas Search is eventually consistent; this catches the
classic "empty results on a fresh cluster" demo-killer).

**Tooling** — the repo's `evaluation` + `advanced-evaluation` skills run the harness in CI and emit
a scorecard. On stage it is one line: *"F1 0.94 on the fraud lanes, zero hallucinated policy
citations, audit chain verified."*

---

## 6. Demo script & scope

**~12-min live arc:**
| min | Beat | What the room sees | Pillar |
| --- | --- | --- | --- |
| 0–2 | The problem | "Four systems, four seams" → the console | framing |
| 2–4 | Launch a case | Queue → #4471 → timeline: triage, hybrid retrieval + graph ring, memory cites a prior case | vector · full-text · hybrid · graph · memory |
| 4–6 | Governance | Reviewer cites a policy verbatim, score 0.45, action HELD; audit row appends with visible hash | policy · guardrail · audit |
| 6–8 | Human gate | Analyst approves/rejects → same durable run resumes → ACID commit; status flips live | durable state · SoR · HITL |
| 8–10 | Policy edit, live | Edit `policies` in DB → change stream → next case behaves differently, no redeploy | change streams · reactivity |
| 10–12 | Payoff | Bottom bar: every write on one cluster, p50 latency, cost, F1 | collapse-the-stack + eval |

**In scope (v1):** single Mastra agent + deterministic core; 5 retrieval/graph/memory tools;
Policy Governance Layer; durable suspend/resume gate bound to an evidence hash; ACID commit;
hash-chained audit; control-room UI via change-stream→SSE; labeled eval harness; ~20–40 seed cases
across 6 lanes.

**Stretch (only if time):** the adversarial Challenger agent; the `verify_chain` tamper demo; the
semantic-cache panel.

**Out of v1:** multi-agent committee; auth/SSO; multi-tenancy beyond existing user-scoping; real
bank integrations (seeded data only — stated honestly).

**Reuse posture:** harvest proven primitives from the author's current Mastra app (hybrid search +
rerank, memory, suspend/resume, safe data-query tool, cache, AWS/Terraform deploy); port the
governance + audit MongoDB layer near-verbatim from the governance engine; carry the vector index
config + layered-decision pattern + regression-fence discipline from the Temporal app.

**Name:** **Marshal** (working name). Names the operator's core act — to *marshal* evidence
(gather and order the retrieval/graph/memory signals into a case) and a *marshal* who adjudicates
the verdict; centers the human-gated decision, not surveillance. Reads cleanly in the control-room
top bar: `MARSHAL ● INVESTIGATING`. Keep it **configurable** regardless (a single config/env value,
surfaced in the UI top bar and package metadata) so it can be changed later without code changes —
do **not** hardcode the product name anywhere.

---

## 7. Prior art & sources (what informed this design)

Grounded in code analysis of the author's own apps plus the top-scoring entries of the 100-entry
Google Cloud Rapid Agent Hackathon (MongoDB track) corpus.

**Author's apps (the spine):**
- **CMA fraud-review cookbook** — the published fraud-review data model, four retrieval patterns
  (vector/text/hybrid/graph), the human gate, decision + audit + receipt collections on one
  cluster. This app is its production Mastra/TypeScript counterpart.
- **Temporal fraud app** — carried over: the 1024-dim voyage-4 cosine vector index, the layered
  rules→LLM→graph decision pattern, decision/audit document shapes, and the `.specs`
  regression-fence discipline. **Improved on:** its human-in-the-loop was broken — the UI resolved
  reviews by writing to MongoDB out-of-band and never resumed the durable workflow, so the run and
  the human verdict were disconnected. This app makes *suspend → verdict → resume the same run* the
  centerpiece. It also had no change streams and no quantitative eval harness — both added here.
- **Governance engine** — the Policy Governance Layer: retrieval-grounded policy reviewer with a
  deterministic scoring gate and a citation/hallucination filter, immutable-append policy
  versioning (partial-unique on current version), HMAC hash-chained append-only audit,
  change-stream cache invalidation, time-series metrics. Ported near-verbatim at the MongoDB layer;
  service logic re-expressed as Mastra tools/steps. **Neutral naming only** (no "Constitutional
  AI").

**Corpus patterns adopted:**
- **Deterministic decision core** — the LLM proposes/narrates; code decides (drift logged, not
  obeyed).
- **Evidence-hash approval token** — bind the human gate to `sha256({snapshot, proposed_action})`;
  refuse resume on drift.
- **Independent Challenger** (stretch) — raw evidence only; reconcile by confidence delta in code.
- **Verdict vector-memory** — embed each closed case; recall and cite priors next time.
- **Shape-only audit** — log which sensitive fields were touched, never raw PII.
- **Change-stream → SSE → UI** — the UI as a pure projection of DB writes (control-room design).

**Corpus anti-patterns avoided:**
- Bolting on a separate search engine (the exact stack sprawl this talk argues against).
- Faking multi-agent as a sequential prompt loop.
- Split-brain persistence (two data layers against one cluster).
- Silent truncation / no eval (claiming coverage without measuring it).
