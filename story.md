# Marshal — Ai4 presentation walkthrough

> Your script for driving the demo live. Theme of the conference: **Deployment at scale**.
> The whole point you are landing: **one MongoDB Atlas cluster, one connection string, does the
> eight jobs the industry usually buys as eight separate systems — and it holds up under load.**

This is a talk track, not a slide deck. Read the **Say** column out loud in your own words; use the
**Do** column as your click cues. Two timings are marked: a tight **5-min** path (beats ⭐) and the
full **~10-min** path.

---

## Before you walk on

- [ ] Server running in **demo mode**: `DEMO_MODE=1 pnpm dev` → open `http://localhost:8000/?tour=0`
      (the `?tour=0` suppresses the auto-tour so nothing pops up mid-sentence).
- [ ] Startup log says `demo replay loaded {events: 38}`. If it says *no baked replay*, run
      `pnpm restore:replay` and refresh.
- [ ] Theme set the way you want (◐ toggles light/dark). Dark reads better on a big projector.
- [ ] Zoom the browser to ~110–125% so the back row can read the feed.
- [ ] A terminal open on a second workspace for the two live "beats" (`pnpm beat:policy`,
      `pnpm beat:tamper`, `pnpm beat:restore`).
- [ ] Press **Reset** once so you start from a clean, all-pending queue.
- [ ] Know your escape hatch: if anything looks off, **Reset** returns you to the opening frame.

Demo mode is a client-side replay of a **recorded run of the real agent** — deterministic, no LLM
calls, nothing to rate-limit or bill, safe if 300 people open it on their phones at once. Say that
out loud if anyone asks "is this live?" — it's honest and it's the scale story.

---

## The arc

1. **The problem** — an agent stack is normally a pile of databases.
2. **The reveal** — here it's one cluster; watch it work.
3. **The proof** — scale, quality, governance, audit — the things that decide a real deployment.
4. **The close** — one connection string, deployed at scale.

---

## Beat by beat

### 1 ⭐ Open cold — the thesis (0:00–1:00)

**Do:** Land on the welcome screen. Don't click anything yet. Gesture at the capability rail
across the top, then the queue on the left.

**Say:**
> "This is Marshal — a fraud-investigation console. An AI agent picks up flagged transactions and
> works each one like an analyst would. But that's not what I'm here to show you.
>
> Look at the top row. Vector search. Full-text. Hybrid. Graph. Memory. Governance. Durable
> workflow state. A tamper-evident audit log. Eight capabilities. In most architectures that's a
> vector DB, *plus* a search engine, *plus* a graph database, *plus* a cache, *plus* an audit
> store — eight systems, eight SLAs, eight things to secure and keep in sync.
>
> Every one of these runs on **one MongoDB Atlas cluster. One connection string.** Let me show you."

**Point to land:** the queue header — "50 active · 1,215 corpus." You already have thousands of
decided cases behind the scenes. Foreshadow the scale beat.

---

### 2 ⭐ Launch — the investigation theater (1:00–3:00)

**Do:** Click **▶ Replay Investigation**. Let the center panel take over. Don't narrate every line —
let it breathe for a few seconds, then talk over it.

**Say:**
> "I've asked the agent to work the whole queue. Watch the middle of the screen — this is the agent
> thinking, in real time.
>
> For each case it triages, retrieves similar past cases, reasons over them, traces the money,
> checks it against policy, and decides. See the pipeline fill in, stage by stage. And watch the
> top row light up — every tile is a MongoDB capability being exercised, and the counter ticks each
> time the agent uses it.
>
> None of this is choreographed on the front end. Each step you see is a database write surfacing
> through a MongoDB **change stream**. The UI is just a projection of what's happening in the data."

**Do:** As cases finish, point at the **verdict stamps** landing (APPROVE / REJECT / HELD) and the
outcome chips appearing at the top of the theater.

**Say:**
> "Some it clears. Some it rejects outright. And some — like this one — it refuses to decide alone."

---

### 3 ⭐ The graph — following the money (3:00–4:00)

**Do:** Click the **ring** case in the queue (Quartz Trading → Vertex Holdings, `txn-review-ring`).
Scroll to the **Fund-tracing network**.

**Say:**
> "This one the agent flagged as a laundering ring. This graph isn't a picture I drew — it's a
> `$graphLookup` traversal, following sender-to-recipient links across accounts. See the money
> leave here and come back around? That's a circular flow — classic layering. The agent found the
> loop, matched it against three prior rejected cases, and rejected it under the ring policy.
>
> Graph traversal, vector recall of precedent, and the transactions themselves — same cluster, same
> query engine."

---

### 4 ⭐ The human gate — durable state (4:00–5:30)

**Do:** Click the held structuring case (`txn-review-struct`, $4,950 Cash Corner → Cash Corner).
The **verdict + Approve/Reject gate is right at the top**. Read the rationale aloud — it's the best
copy in the app.

**Say:**
> "Here's where it gets serious. $4,950 — fifty dollars under the $5,000 reporting threshold. Third
> deposit from the same account this week. The agent won't auto-approve this; it recognizes
> structuring and it **holds the case for a human**.
>
> That gate is a *durable workflow*. The agent suspended this investigation and wrote its state to
> Atlas. It can sit here for a second or a week; when I decide, it resumes exactly where it left
> off. No orchestration server, no separate state store — the workflow state lives in the database."

**Do:** Scroll to the **CTR threshold gauge** (the little meter showing $4,950 sitting just under
the $5,000 line) and the cited policy `AML-STRUCT-001`.

**Say:**
> "And the compliance layer isn't the model free-associating. It retrieved the actual policy by
> vector search and cited it — chapter and verse. Grounded governance."

**Do:** Click **✓ Approve** (or Reject — your call). The card flips to your decision, the banner
turns committed.

**Say:**
> "I make the call. It commits, and — watch the bottom-right — it lands in the audit trail."

---

### 5 ⭐ Scale — the Ai4 point (5:30–6:30)

**Do:** Point at the **bottom bar** (the payoff readout) and the **queue header**.

**Say:**
> "Now the part that matters for putting this in production. Bottom of the screen, all real numbers
> from the cluster: the corpus the agent is retrieving against isn't a handful of demo rows — it's
> over **twelve hundred** decided cases, every one embedded and indexed. Hybrid search, vector
> recall, and graph traversal all run across that whole corpus.
>
> Median time per case. Fraud recall — **100%**, meaning it caught every case that should not have
> been auto-approved. F1 against the labeled ground truth. This is the scorecard you'd actually take
> to a risk committee, and it's measured, not asserted."

**Point to land:**
> "Same cluster. One connection string. Scales from these fifteen live cases to those twelve hundred
> to millions — that's the deployment story."

---

### 6 Live governance — policy without a redeploy (6:30–7:30) *(full path)*

**Do:** On your terminal, run `pnpm beat:policy`. A **green banner** slides across every open
console: *POLICY UPDATED LIVE*.

**Say:**
> "Compliance changes a rule. In a normal stack that's a ticket, a redeploy, a maintenance window.
> Here I just updated a policy document in the collection —" *(gesture at the banner)* "— and the
> governance layer reads the new version on the very next case. No redeploy. The policy is data,
> and the agent reads data."

---

### 7 Tamper-evident audit — the compliance closer (7:30–8:45) *(full path)*

**Do:** Point at the green **audit chain verified** chip (bottom-right). Then run
`pnpm beat:tamper` on your terminal.

**Say:**
> "Every decision the agent or a human makes is written to an append-only, HMAC hash-chained audit
> log. That chip re-verifies the entire chain continuously. Watch what happens if I reach into the
> database and quietly alter one committed record —"

**Do:** The chip flips to **red** and a pulsing red alarm banner names the broken record.

**Say:**
> "— it can't hide. The chain breaks, the console raises the alarm, and it tells me exactly which
> record was touched. That's tamper-evidence a regulator will accept."

**Do:** Run `pnpm beat:restore`. The chip returns to green; a restored banner appears.

**Say:**
> "Undo the tampering and the chain heals. All of it — the decisions, the hash chain, the
> verification — on the same cluster."

---

### 8 ⭐ Close (8:45–9:30)

**Do:** Press **Reset** to return to the opening frame. Let the clean thesis screen sit behind you.

**Say:**
> "So: retrieval, hybrid search, graph, memory, durable agent state, grounded governance, and a
> tamper-evident ledger. Eight systems' worth of capability — one Atlas cluster, one connection
> string, one thing to deploy, secure, and scale.
>
> That's the difference between a demo and something you can actually ship. Thank you."

---

## If you only have 5 minutes

Beats **1 → 2 → 4 → 5 → 8**. Skip the graph deep-dive (3), the policy beat (6), and the audit beat
(7). You still open with the thesis, show the agent working, land the human gate, hit the scale
numbers, and close.

## Soundbites (drop these when you need one)

- "Eight systems' worth of capability, one connection string."
- "The UI isn't calling the agent — it's a projection of the database. Change streams do the wiring."
- "The policy is data. The agent reads data. Change the rule, no redeploy."
- "Fraud recall is measured, not asserted."
- "It can sit at the human gate for a week and resume exactly where it left off."
- "A tampered ledger can't hide."

## Likely questions

- **"Is this live or canned?"** — "Demo mode is a deterministic replay of a *recorded run of the
  real agent*, so it's identical for everyone and costs nothing to run at scale. Flip one env var
  and the exact same UI runs the live agent — same code, same cluster." *(You can show live mode
  off-stage if pressed.)*
- **"What's the model?"** — "Claude Haiku through a gateway for the agent's reasoning; Voyage
  multimodal embeddings for retrieval, hosted by MongoDB. Both swappable in config."
- **"Does this need a special MongoDB?"** — "No. Vector, full-text, hybrid, graph, change streams,
  transactions — all standard Atlas. That's the point."
- **"How does it scale to real volume?"** — "The corpus you saw is 1,200+ decided cases, embedded
  and indexed; retrieval is server-side (`$rankFusion`, `$vectorSearch`, `$graphLookup`), so it's
  the cluster doing the work, not the app. Add nodes, not systems."

## Recovery

- Something looks stuck → **Reset**, refresh the page, re-launch.
- Banner stuck on screen → it auto-hides in a few seconds; Reset clears it.
- Audit chip stuck red → run `pnpm beat:restore` (or `pnpm bake && pnpm export:replay` for a clean
  reset of the recording).
- Whole thing wedged → `DEMO_MODE=1 pnpm dev` again; the recording is safe in `data/replay/`.
