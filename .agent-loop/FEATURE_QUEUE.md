# Agent Loop — FEATURE QUEUE

**Purpose.** Intake and lifecycle ledger for feature work flowing through the loop. Every unit
of work is a task with a stable `task_id` and a status that advances through the pipeline.

**How it's used in the loop.**

- New work is appended to `## Queue` as a YAML task block using the schema below.
- The Supervisors select the highest-priority `queued` task each cycle and advance its `status`:
  `queued → planning → reviewing → implementing → verifying → done` (or `blocked`).
- `owner` / `reviewer` map to the lanes: Claude = UI/UX + main implementation
  (`src/app/(dashboard)/**`, `src/components/**`); Codex = backend/perf/refactor/test review.
- A task only moves to `done` after its `verification[]` commands pass (real commands:
  `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:e2e:audit`).
- `gbrain_memory_used[]` records memory keys/notes consulted.
  STATUS: gbrain connected 2026-06-20 (local postgres; careviax indexed read-write). Populate
  this with the `gbrain search`/`gbrain query` hits a task actually consulted. `mcp__gbrain__*`
  tools require a Claude Code restart; the `gbrain` CLI works now.

## Task schema

```yaml
- task_id: F-YYYYMMDD-NNN # stable id, e.g. F-20260620-001
  status: queued # draft | intake_seen | deduped | owner_decided | queued | planning | plan_ready | peer_plan_review | approved_to_implement | lock_acquired | reviewing | implementing | patch_ready | peer_patch_review | changes_requested | verifying | done | blocked
  owner: claude-lead # claude-lead (UI lane) | codex-lead (backend lane)
  reviewer: codex-lead # the opposite lane reviews
  origin_agent: claude-lead # who submitted this feature request; may differ from owner
  priority: P2 # P0 (now) | P1 | P2 | P3
  feature_name: ''
  background: '' # why this exists; link to docs/spec section if any
  user_value: '' # who benefits and how
  acceptance_criteria: # observable, checkable outcomes
    - ''
  constraints: # compliance / design / lane constraints
    - ''
  verification: # exact commands that must pass before done
    - pnpm lint
    - pnpm typecheck
  gbrain_memory_used: [] # memory keys/queries consulted (gbrain connected — fill from `gbrain search`/`query` hits)
```

**Agent roles.** `origin_agent` = who submitted the request (may differ from `owner`);
`owner` (= owner_agent) = the lane that implements; `reviewer` (= reviewer_agent) = the opposite
lane that reviews. `origin_agent` need not equal `owner` — a request raised in one lane can be
owned by the other.

**Status glossary.** (intake/routing)

- `draft` — captured, not yet routed.
- `intake_seen` — supervisors confirmed receipt/priority.
- `deduped` — gbrain prior-art search performed, confirmed not a duplicate.
- `owner_decided` — owner_agent/reviewer_agent confirmed.
- `queued` — accepted, awaiting selection.

(plan-review loop, distinct from patch-review)

- `planning` — owner is drafting the plan.
- `plan_ready` — owner drafted plan, ready to send.
- `peer_plan_review` — awaiting `PLAN_REVIEW_RESULT` from the reviewer lane.
- `approved_to_implement` — plan approved; may request LOCKs.
- `lock_acquired` — all required paths LOCKed, edit may begin.

(implement/patch-review loop)

- `implementing` — edits in progress under held LOCKs.
- `patch_ready` — change complete, ready to send for review.
- `peer_patch_review` — awaiting patch review from the reviewer lane.
- `changes_requested` — reviewer requested changes; see `PATCH_INBOX.md` for the items.
- Flow: `implementing → patch_ready → peer_patch_review → (changes_requested → implementing) | approved_to_implement`.

(close-out)

- `verifying` — `verification[]` gates running.
- `done` — only after `verification[]` passes.
- `blocked` — parked per `BLOCKED.md`.

## Queue

<!-- No real features yet. Copy the commented template below for each new task.
     Keep highest priority at the top. -->

<!--
- task_id: F-20260620-001
  status: queued
  owner: claude-lead
  reviewer: codex-lead
  priority: P2
  feature_name: ""
  background: ""
  user_value: ""
  acceptance_criteria:
    - ""
  constraints:
    - ""
  verification:
    - pnpm lint
    - pnpm typecheck
  gbrain_memory_used: []
-->

```yaml
- task_id: F-20260620-001
  status: done # commit a1c916ac (codex, AGENTS.md lane); reviewed+verified by claude-lead. Cycle 1.
  owner: claude-lead
  reviewer: codex-lead
  priority: P3
  feature_name: Wire AGENTS.md pointer to the agent-loop operator guide
  background: >
    Spec §4 lists AGENTS.md among the loop's wired docs. The .agent-loop/ scaffold
    (2986725b) added a CLAUDE.md pointer but deferred AGENTS.md because Codex held a
    LOCK on it (committed a2414cdc). This task closes that loose end via cross-lane
    coordination — the first real dogfood cycle of the loop itself.
  user_value: >
    A Codex operator opening AGENTS.md (its primary instructions) is pointed to the
    loop's operator guide, so both supervisors share one entry point.
  acceptance_criteria:
    - AGENTS.md contains a one-line pointer to .agent-loop/README.md.
    - Edit is made/approved in Codex's lane (AGENTS.md = codex-lead), not unilaterally.
    - No behavior/code change; docs only.
  constraints:
    - AGENTS.md is codex-lead's lane — coordinate over agmsg, do not edit unilaterally.
    - Docs only; no auth/billing/security/migration surface.
  verification:
    - pnpm exec prettier --check AGENTS.md
    - git diff --check
  gbrain_memory_used: [] # gbrain not connected; substituted with repo+agmsg history
```

```yaml
- task_id: F-20260620-002
  status: done # commit c6ee1476; plan+patch approved by codex-lead; gates GREEN (vitest 6/6, typecheck, no-unused, eslint, format:check, build 286p). Cycle 3.
  owner: claude-lead
  reviewer: codex-lead
  origin_agent: claude-lead
  priority: P2
  feature_name: Fail-close the two FirstVisitDocument mutations in patient-documents-panel
  background: >
    claude-lead's own checker review of the codex hardening slice (gbrain
    ReviewFinding projects/careviax/reviews/hardening-slice-precommit-clean-20260620)
    flagged src/app/(dashboard)/patients/[id]/patient-documents-panel.tsx (~344-347,
    654-657): the FirstVisitDocument create/update mutations still use raw
    res.json() (fail-open), bypassing ApplyNow §10. This was explicitly OUT of the
    hardening slice scope and is now safely landed in cccb091a, so it is a clean,
    non-overlapping claude-lane follow-up.
  user_value: >
    A malformed 2xx on document create/update fails closed (surfaces an error)
    instead of silently proceeding; consistent with the rest of the readApiJson
    adoption. No PHI in error text.
  acceptance_criteria:
    - Both mutations use readApiJson(res, { schema }) with a schema for the response.
    - fallbackMessage is a static literal (no payload/PHI interpolation).
    - A test asserts fail-closed behavior on a malformed 2xx for each mutation.
    - Existing toast + query-invalidation behavior is preserved (no UX regression).
  constraints:
    - claude lane only — src/app/(dashboard)/patients/[id]/** (+ its test). No API/route change (codex lane).
    - ApplyNow §10 (fail-closed reads) + §9 (no PHI in error/response).
    - Open question for plan review: does the response schema live locally (claude lane)
      or as a shared lib schema (codex lane)? Resolve with codex before implement.
  verification:
    - pnpm lint
    - pnpm typecheck
    - pnpm typecheck:no-unused
    - pnpm format:check
    - pnpm test -- src/app/(dashboard)/patients
    - pnpm build
  gbrain_memory_used:
    - projects/careviax/reviews/hardening-slice-precommit-clean-20260620 (origin of this follow-up)
    - projects/careviax/decisions/readapijson-schema-fail-closed (§10 pattern)
```

```yaml
- task_id: F-20260620-003
  status: done # commit ec241ffe; plan+patch approved by claude-lead (reviewer); gates GREEN (focused 31/31, full 8506, typecheck/no-unused/eslint/format:check/lint). Cycle 3.
  owner: codex-lead
  reviewer: claude-lead
  origin_agent: claude-lead
  priority: P2
  feature_name: Project first-visit-document mutation responses to a safe minimal shape (§9 over-wire minimization)
  background: >
    During F-20260620-002 plan review, codex-lead flagged that
    /api/first-visit-documents POST and /api/first-visit-documents/[id] PATCH
    currently return { data: raw FirstVisitDocument } whose row can carry
    emergency_contacts, delivered_to, document_url. There is no toSafe* projection
    on this route family — not a §9 symmetry violation of an already-redacted GET,
    but also not a safe mutation projection. The client (F-20260620-002) already
    fails closed on a minimal { data: { id } } schema, so closing the over-wire
    surface is a server-side hardening, not a client dependency.
  user_value: >
    The create/update endpoints stop emitting unneeded patient/contact/document
    fields over the wire, minimizing PHI exposure at the API boundary.
  acceptance_criteria:
    - POST/PATCH /api/first-visit-documents project the response to a safe minimal shape, e.g. { data: { id, updated_at } }.
    - A test asserts the mutation response body excludes emergency_contacts, delivered_to, document_url.
    - The F-20260620-002 client schema still parses the trimmed response (id present).
  constraints:
    - codex lane — src/app/api/first-visit-documents/** (+ any src/lib projection). claude does not edit.
    - ApplyNow §9 (PHI redaction symmetry / safe projection on mutations).
  verification:
    - pnpm lint
    - pnpm typecheck
    - pnpm test -- src/app/api/first-visit-documents
  gbrain_memory_used:
    - projects/careviax/failures/mutation-returns-raw-row-phi-leak
    - projects/careviax/fix-patterns/mutation-reuse-get-safe-projection
```

```yaml
- task_id: F-20260620-004
  status: done # commit 377d9e1e; codex APPROVED rev3 (3 review rounds). Cycle 4 Discover top finding.
  owner: claude-lead
  reviewer: codex-lead
  origin_agent: claude-lead
  priority: P1
  feature_name: Fail-close admin metrics & analytics on fetch failure (no false-empty)
  background: >
    Cycle-4 Discover sweep found a false-empty bug class (design SSOT rule 3): admin
    metrics + analytics rendered fabricated zeros (and metrics fired false 未達/超過
    alerts) on fetch failure; analytics billing + resource-map each false-emptied.
  acceptance_criteria:
    - First-load failure → blocking ErrorState; refetch failure with data keeps data + inline warning.
    - Metrics 404 placeholder fires no threshold alerts and uses neutral (not warning) color.
    - Analytics billing/resource errors are section-scoped + independent; loading shows no "…ありません".
  verification:
    [pnpm lint, pnpm typecheck, pnpm typecheck:no-unused, pnpm format:check, pnpm test, pnpm build]
  gbrain_memory_used:
    - projects/careviax/decisions/readapijson-schema-fail-closed
  notes: >
    codex (subagent review) caught a stale-data-on-refetch regression my verify missed:
    plain isError wipes good data on TanStack v5 refetch — gate blocking error on isError && !data.

- task_id: F-20260620-007
  status: done # rev9 APPROVED by codex; committed 2a4780d0 (8 files, +1320). rev7→rev9: KPI envelope bug, contract boundaries, domain validation all closed.
  owner: claude-lead
  reviewer: codex-lead
  origin_agent: claude-lead
  priority: P2
  feature_name: 統計 (statistics) aggregation hub — canonical all-statistics entrypoint
  background: >
    User: 「統計機能にすべてを集約」 + 「PHIに限らず全情報を表示してよい」. New top-level 統計
    nav + /statistics hub aggregating the 64 existing statistics surfaces (recon
    wf_624ac1cd) by 9 categories as deep-link cards + safe live headline KPIs. Reuse-first,
    no duplicate analytics stack.
  constraints:
    - claude lane (src/components/layout/navigation-config.ts + src/app/(dashboard)/statistics/**); no api/lib/server/prisma edits.
    - PHI display human-approved BUT tenant isolation/RLS + endpoint permission + §9 no-PHI-in-error-text + §10 fail-closed remain non-negotiable (403 → locked state, never false-empty).
    - Sequenced AFTER F-004 (landed 377d9e1e).
  verification:
    [pnpm lint, pnpm typecheck, pnpm typecheck:no-unused, pnpm format:check, pnpm test, pnpm build]
  gbrain_memory_used: []
```
