# LOOP_POLICY.md

**Purpose.** Per-run operating policy for the claude-lead / codex-lead agent loop. It tells each
Supervisor what to apply unconditionally, what to weigh, and what to leave alone for the current
run. This is the distilled, _enforceable_ slice of long-term memory (gbrain) plus the lane/LOCK
discipline that the two sessions have already proven in practice. Only `ApplyNow` memories from
`MEMORY_REVIEW.md` are copied here; the gbrain memory model and classification rule are defined in
`GBRAIN_SCHEMA.md` (§14).

**How it is used in the loop.**

- Read at the **start of every cycle** before any work is planned or dispatched.
- `## ApplyNow` items are non-negotiable for this run; violating one is a stop-the-line event.
- `## Consider` items are weighed against the current objective; record the decision in the run log.
- `## Ignore` items are explicitly out of scope this run (avoids re-litigating settled questions).
- `## BlockedContext` records external dependencies that gate otherwise-ready work.
- `## Peer approval` tracks the proposed_by / reviewed_by / status of each policy line so no single
  Supervisor can unilaterally promote a rule.

- **Run:** RUN-20260620-001
- **Cycle:** 4 (Discover sweep; bootstrap re-run — no new ApplyNow, gbrain memory set unchanged since Cycle 2; §1–10 stand)
- **Date:** 2026-06-20
- **Supervisors:** claude-lead (UI/UX + main impl), codex-lead (backend/perf/refactor/test review)

> **STATUS: gbrain connected 2026-06-20** — careviax indexed (read-write, local postgres).
> ApplyNow below is seeded from already-proven lane/LOCK/drain discipline; from the next cycle,
> populate the remainder from a real Memory Bootstrap (`gbrain search`/`query`). gbrain recall
> stays subordinate to live repo state. (`mcp__gbrain__*` tools need a Claude Code restart; the
> `gbrain` CLI works now.)

---

## ApplyNow

Proven, in-effect-now discipline. Apply on every cycle without re-deciding.

1. **Lane discipline.** Claude owns `src/app/(dashboard)/**` and `src/components/**` (UI/UX + main
   implementation). Codex owns backend / perf / refactor / test-review. Do not edit across lanes
   without an explicit handoff.
2. **LOCK before edit.** Announce a path LOCK over agmsg (team `phos`, supervisor-to-supervisor
   only) before editing any shared file. Release the LOCK when the edit lands.
3. **Drain inbox before commit.** Run `inbox.sh phos <name>` and resolve every pending message
   before staging or committing. Never commit over an unread LOCK or objection.
4. **Stage only your own files.** `git add` only paths in your lane. Never blanket `git add -A`.
5. **Supervisors-only on agmsg.** Only claude-lead and codex-lead write to agmsg. Subagents and
   workers never message directly — they report up to their Supervisor.
6. **Verify before claiming done.** Use the real commands: `pnpm lint`, `pnpm typecheck`,
   `pnpm typecheck:no-unused`, `pnpm format:check`, `pnpm test`, `pnpm build`,
   `pnpm test:e2e` / `pnpm test:e2e:audit`. No "done" without passing evidence.
7. **UI/UX changes consult the SSOT first.** Read `docs/ui-ux-design-guidelines.md` and the
   State Color token system before any visual/state-color change. CLAUDE.md's older color prose
   is superseded by the 6-axis StateBadge/StatusDot tokens.
8. **Compliance by Design.** Treat 3省2ガイドライン (MHLW v6.0 + METI/MIC v1.1) + APPI as a
   design precondition, not a later audit. Tenant isolation goes through Prisma + PostgreSQL RLS
   (`SET LOCAL app.current_org_id`); never weaken it for convenience.
9. **PHI redaction symmetry on mutations.** A resource whose GET redacts patient data through a
   `toSafe*()` projection MUST apply the **same** projection on its POST/PUT/PATCH/mutation
   response — never return the raw Prisma row (it still carries `reason`, `proposed_value`,
   name/address, etc.). Add a test asserting the mutation response **body** excludes sensitive
   fields; GET-only tests miss this. Evidence: gbrain FailurePattern
   `mutation-returns-raw-row-phi-leak` (high, peer-reviewed) + FixPattern
   `mutation-reuse-get-safe-projection`. Strengthens §8 (Compliance by Design).
10. **Fail-closed client API reads.** Validate client-side API reads with
    `readApiJson(res, { schema })` so a malformed 2xx fails closed; keep `fallbackMessage` a static
    literal (no payload interpolation, so no PHI leaks into error text). Evidence: gbrain
    ImplementationDecision `readapijson-schema-fail-closed` (peer-reviewed).
11. **Workload-balancing handoff.** If one Supervisor is saturated and the other has spare
    capacity, the current owner may hand off a task or narrow subtask even when it would normally
    sit in the other lane. This requires an explicit AGLOOP `HANDOFF` or owner-decision envelope,
    a stable `idempotency_key` for retries, ACK before work starts, updated
    `owner_agent`/`reviewer_agent`, and declared `locked_paths`/`forbidden_paths`. Handoff does
    **not** widen scope: the receiver edits only the granted `locked_paths`, runs the same
    objective gate before `PATCH_REVIEW_REQUEST`, and never self-reviews. Existing hard-stops
    (auth, billing/payments, security policy, destructive migration, production deploy) remain
    human-gated and cannot be bypassed by load balancing.
12. **Idle-capacity useful work.** When the queue has no actionable review, plan, VERIFY, LOCK, or
    user-priority task, a Supervisor may spend idle capacity on bounded work that improves the next
    cycle: small behavior-preserving refactors, duplicate/dead-code discovery, targeted test
    strengthening, validation/ledger cleanup, gbrain dedupe/classification/stale-memory review,
    and coherent commits of already-reviewed owned slices. Idle work still requires inbox drain,
    gbrain/repo dedupe, explicit LOCK for any edit, peer review before done, objective validation,
    and explicit-path staging. Do not use idle time to start broad rewrites, unreviewed product
    features, cross-lane edits, auth/billing/payments/security/destructive migration/deploy work, or
    speculative gbrain writes.
13. **Loop-engineering PDCA track.** In parallel with coding, run a bounded improvement loop for the
    agent loop itself: mine past implementations, reviews, gate results, and changes-requested items
    for reusable methods and anti-patterns; store only redacted, evidence-backed reusable knowledge
    in gbrain; check whether the method improves metrics; then either adopt, revise, or reject it.
    Useful methods are captured as `ImplementationDecision` / `FixPattern` / `CandidateLesson`;
    improvable methods as `FailurePattern` / `RejectedApproach` / `ReviewFinding`, linked to the
    relevant `LoopRun` and `GateResult`. This track may run during idle time or cycle close, but it
    must not block active user-priority work, bypass maker/checker separation, auto-promote
    CandidateLessons, or store raw logs, PHI, secrets, `.env` values, or unverified speculation.
14. **Idle-time productivity playbook (standing rule, both Supervisors).** Operationalizes §12/§13:
    whenever blocked or waiting (peer review / implementation / lock / build, or external state) with
    **no higher-priority inbound task**, do not idle — pick the highest-value non-conflicting work, in
    roughly this priority order:
    - **a. Ground the peer's in-flight review.** When you are reviewer on a pending PLAN/PATCH, run
      **independent read-only recon** (component APIs, callers, existing shared assets, contracts) to
      verify the peer's claims and surface what green gates / audit ledgers miss. Evidence (2026-06-21):
      independent DataTable recon found the component already implemented the loading/error/empty/retry
      triad, shrinking F-20260621-002 to caller-only wiring and removing a ~32-caller core-component
      regression risk.
    - **b. Pre-execute upcoming tasks (read-only prep).** Recon/scope/plan-ground the next queued or
      roadmap task (e.g., the next `UI_AUDIT_MATRIX` stage) and write a durable scope ledger so the next
      PLAN_REVIEW is grounded and fast. No implementation without plan approval + LOCK.
    - **c. Take over / unblock peer work.** If the peer is saturated or a slice is stuck, pick up a
      non-conflicting subtask via the §11 HANDOFF envelope (ACK, idempotency_key, updated
      owner/reviewer, declared locks). Stay in lock discipline.
    - **d. gbrain organization & writeback (§13).** Capture this cycle's evidence-backed reusable
      learnings; dedupe / quality / stale-review existing memories; fill recall gaps. Redact PHI/secrets.
    - **e. Loop improvement.** Capture cycle friction (wasted rounds, tooling pitfalls, stale ledgers)
      and propose concrete `LOOP_POLICY`/prompt refinements via `POLICY_UPDATE` (peer ACK; human gate for
      permanent promotion to AGENTS.md/CLAUDE.md).
    - **f. Hygiene / coverage.** Run full objective gates on the dirty tree to surface pre-existing
      issues (flag, do not fix peer-locked files); identify untested contracts in recently-landed code
      and propose targeted tests; reconcile `UI_AUDIT_MATRIX`/`FEATURE_QUEUE`/`STATE` with the actual
      landed state and note stale entries.
    - **g. No-passive-wait fallback.** If none of the above is safe to edit, still create value before
      backing off: send `REQUEST_DELEGATE` for a non-conflicting subtask, write a read-only recon/scope
      note, flag a stale ledger, or record `BlockedContext`. Increment `zero_actionable_count` only
      after this exploration is done and recorded.
      Constraints (so idle work stays safe): read-only by default; writes only to your own lane, gbrain, or
      jointly-owned ledgers under explicit LOCK; never edit peer-locked paths or start implementation
      without plan approval; **yield immediately when a higher-priority inbound message arrives** (review
      request, URGENT, user-priority); all hard-stops (auth/billing/payments/security/destructive
      migration/production deploy) stay human-gated; no new external sends/deploys. This is a **standing**
      expectation, not a one-off — both Supervisors default to it instead of going idle.
15. **No passive-wait turns (hard per-turn trigger; both Supervisors).** §14 is a _standing_ rule; this
    makes it _enforced every turn_. After any send that blocks on the peer or external state
    (`PATCH_REVIEW_REQUEST` / `PLAN_REVIEW_REQUEST`, `LOCK` request, `HANDOFF`, or a kicked-off
    build/test), you MUST NOT end the turn in passive wait (e.g. "待機します / awaiting review"). In the
    **same turn**, immediately begin the highest-value non-conflicting §14-ladder item and report what you
    started — not that you are waiting. A turn whose only action is announcing a wait is a policy
    violation. Each blocked turn, in order:
    - **1. Yield first.** Drain inbox; handle any inbound review/lock/URGENT/user-priority before new work.
    - **2. Auto-discover + start.** If nothing inbound needs you, run the §14 ladder (a→g) and START the
      first safe item this turn: independent read-only recon, next-task scoping/plan-ground, SSOT/docs
      drafting, gbrain writeback, hygiene/coverage, or an **independent-file** slice under a fresh LOCK
      that touches neither peer-locked nor under-review paths.
    - **3. Account.** Only after that work is recorded may `zero_actionable_count` increment; record the
      chosen item in `STATE.next_action`.
      Peer-review latency is **overlap time, not stop time**: the file under review stays untouched while the
      next non-conflicting slice/plan/doc proceeds. Same safety envelope as §14 (read-only default;
      own-lane/gbrain/ledger writes only under LOCK; hard-stops human-gated; yield immediately on inbound).

## Consider

Weigh against the current objective; log the decision in the run log. (Seed list — extend from
gbrain once connected.)

- Choosing the lightest verification subset that still covers the change (e.g. skipping full
  `pnpm build` for a docs-only cycle) — justify in the run log.
- Whether a change spanning both lanes should be split into two LOCKed, separately-reviewed PRs.
- Whether to wire the currently-unconfigured gates (secret scan, dependency audit / `pnpm audit`,
  SAST) for the touched surface this run.
- **Schema consolidation at 3+.** When 3+ screens converge on the same API response shape, promote
  the schema to a shared `src/lib/.../api-contracts.ts` (`success(row)` → bare schema, `{data}` →
  `apiDataSchema`). Below that threshold keep it local — premature consolidation couples unrelated
  screens. Evidence: gbrain DuplicateMap `pharmacy-cooperation-api-contracts`.

## Ignore

Explicitly out of scope for this run; do not re-litigate.

- Re-deriving the lane split or the LOCK/drain protocol — already settled (see ApplyNow).
- Re-opening the State Color decision — tokens are the SSOT
  (`docs/state-color-migration-map.md`).

## BlockedContext

External dependencies gating otherwise-ready work. Mark blocked items `cc:blocked` (lowercase).

- **gbrain long-term memory** — ~~MCP not connected~~ **UNBLOCKED 2026-06-20**: connected
  (local postgres; careviax indexed read-write). `mcp__gbrain__*` tools available after a Claude
  Code restart; `gbrain` CLI works now. Memory Bootstrap can issue real queries from next cycle.
- **Security gates (secret scan / dependency audit / SAST)** — recommended, not yet configured —
  TODO. Cannot be enforced as ApplyNow until wired. `cc:blocked`

## Peer approval

Each policy line needs proposed_by + reviewed_by + status before it graduates to ApplyNow.
Status values: `proposed` → `peer-approved` → `applied` (or `rejected`).

| Policy line                                       | proposed_by | reviewed_by | status                                 |
| ------------------------------------------------- | ----------- | ----------- | -------------------------------------- |
| ApplyNow §1–6 (lane/LOCK/drain/verify discipline) | claude-lead | codex-lead  | applied (proven seed)                  |
| ApplyNow §7 (UI/UX SSOT + State Color tokens)     | claude-lead | _pending_   | proposed                               |
| ApplyNow §8 (Compliance by Design + RLS)          | codex-lead  | _pending_   | proposed                               |
| ApplyNow §9 (PHI redaction symmetry on mutations) | claude-lead | codex-lead  | applied                                |
| ApplyNow §10 (fail-closed client reads)           | claude-lead | codex-lead  | applied                                |
| ApplyNow §11 (workload-balancing handoff)         | codex-lead  | claude-lead | applied                                |
| ApplyNow §12 (idle-capacity useful work)          | human       | claude-lead | applied                                |
| ApplyNow §13 (loop-engineering PDCA track)        | human       | codex-lead  | applied                                |
| ApplyNow §14 (idle-time productivity playbook)    | claude-lead | codex-lead  | applied                                |
| ApplyNow §15 (no passive-wait per-turn trigger)   | human       | codex-lead  | peer-approved (human gate for applied) |
| _next candidate_                                  | _name_      | _name_      | proposed                               |
