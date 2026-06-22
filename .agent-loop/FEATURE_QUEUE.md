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
- F-20260620-008 introduces optional Control Plane fields. Existing tasks without those fields
  are valid **legacy manifests** and inherit defaults from `CONTROL_PLANE_CONFIG.yml`.

## Task schema

```yaml
- task_id: F-YYYYMMDD-NNN # stable id, e.g. F-20260620-001
  status: queued # draft | intake_seen | deduped | owner_decided | queued | planning | plan_ready | peer_plan_review | approved_to_implement | lock_acquired | reviewing | implementing | patch_ready | peer_patch_review | changes_requested | verifying | done | blocked
  owner: claude-lead # claude-lead (UI lane) | codex-lead (backend lane)
  reviewer: codex-lead # the opposite lane reviews
  origin_agent: claude-lead # who submitted this feature request; may differ from owner
  type: feature # feature | bugfix | refactor | test | docs | loop_improvement
  risk_level: low # low | medium | high | critical
  priority: P2 # P0 (now) | P1 | P2 | P3
  feature_name: ''
  background: '' # why this exists; link to docs/spec section if any
  user_value: '' # who benefits and how
  acceptance_criteria: # observable, checkable outcomes
    - ''
  constraints: # compliance / design / lane constraints
    - ''
  scope: # optional Control Plane fields; missing means legacy/defaulted
    allowed_paths: [glob]
    denied_paths: [glob]
    max_diff_lines: 800
  loop_policy:
    primary_loop: coding # coding | improvement
    max_iterations: 4
    max_runtime_minutes: 90
    max_cost_usd: null
    require_plan_before_edit: true
    concurrency_key: ''
  success_gates:
    required: [typecheck, unit_tests, lint, no_scope_violation, diff_review]
    optional: [e2e_tests, perf_check]
  approval:
    human_required_if:
      - touches_auth
      - touches_payment
      - adds_dependency
      - changes_database_schema
      - modifies_workflow
      - modifies_eval_threshold
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

**Control Plane compatibility.** Tasks created before F-20260620-008 may omit `type`,
`risk_level`, `scope`, `loop_policy`, `success_gates`, and `approval`. Supervisors treat those
entries as legacy manifests and apply the defaults in `CONTROL_PLANE_CONFIG.yml`; do not backfill
old tasks unless they are actively being edited for another reason.

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
  gbrain_memory_used:
    # writeback from F-007 (codex-seeded, no duplicate CandidateLesson):
    - projects/careviax/lessons/candidates/api-response-validation-and-consolidation # times_confirmed 1->2, gate_verified, F-007/2a4780d0 evidence (promotion_status=candidate)
    - projects/careviax/fix-patterns/route-wire-shape-schema-parity-tests # new: match test mocks/client schema to real route wire shape; add inverse malformed-2xx tests
    - projects/careviax/reviews/statistics-hub-rev7-contract-permission-api-mismatch-20260620 # rev7 review --resolved_by--> the fix-pattern above

- task_id: F-20260620-008
  status: done
  owner: codex-lead
  reviewer: claude-lead
  origin_agent: codex-lead
  type: loop_improvement
  risk_level: medium
  priority: P1
  feature_name: Control Plane MVP and date-partitioned gbrain writeback layout
  background: >
    User supplied AI coding-loop Control Plane specification v0.1 and requested implementation
    for the Coding Loop plus Loop Improvement Loop. User also requested that gbrain supplemental
    files remain type-organized but gain a date partition to prevent giant per-type directories
    or pages over time.
  user_value: >
    The agent loop becomes more auditable and safer: tasks have explicit manifest controls,
    high-risk/runtime automation is deferred instead of implied, and new gbrain writebacks are
    organized by type and JST write date.
  acceptance_criteria:
    - CONTROL_PLANE.md maps the supplied spec to existing .agent-loop artifacts and names deferred items.
    - CONTROL_PLANE_CONFIG.yml is machine-readable but clearly marked advisory/manual, not runtime-enforced.
    - FEATURE_QUEUE supports optional control-plane manifest fields while preserving existing legacy entries.
    - GBRAIN_SCHEMA and templates define new-memory slugs as projects/careviax/<type-dir>/<yyyy-mm-dd>/<id>.
    - Existing gbrain slugs are explicitly stable; no bulk migration is performed.
    - Deferred runtime/high-risk control-plane work is recorded in BLOCKED.md.
  constraints:
    - Docs/config only under .agent-loop; no src/prisma/public/.github edits.
    - Do not claim runtime enforcement, secret scanning, SAST, auto-merge, golden eval mutation, or shadow/canary execution is implemented.
    - Use JST write date for gbrain slug partitions.
  scope:
    allowed_paths:
      - .agent-loop/CONTROL_PLANE.md
      - .agent-loop/CONTROL_PLANE_CONFIG.yml
      - .agent-loop/README.md
      - .agent-loop/FEATURE_QUEUE.md
      - .agent-loop/GBRAIN_SCHEMA.md
      - .agent-loop/templates/gbrain/**
      - .agent-loop/BLOCKED.md
      - .agent-loop/STATE.md
    denied_paths:
      - src/**
      - prisma/**
      - public/**
      - .github/**
    max_diff_lines: 1800
  loop_policy:
    primary_loop: improvement
    max_iterations: 4
    max_runtime_minutes: 90
    max_cost_usd: null
    require_plan_before_edit: true
    concurrency_key: agent-loop-control-plane
  success_gates:
    required: [format_check, diff_check, peer_review, no_scope_violation]
    optional: [typecheck]
  approval:
    human_required_if:
      - runtime_enforcement
      - modifies_golden_eval
      - modifies_eval_threshold
      - adds_dependency
      - modifies_workflow
      - auto_merge
      - production_deploy
  verification:
    - pnpm exec prettier --check .agent-loop/CONTROL_PLANE.md .agent-loop/CONTROL_PLANE_CONFIG.yml .agent-loop/README.md .agent-loop/FEATURE_QUEUE.md .agent-loop/GBRAIN_SCHEMA.md .agent-loop/BLOCKED.md .agent-loop/STATE.md .agent-loop/templates/gbrain/*.md
    - git diff --check
    - ruby -e "require 'yaml'; YAML.load_file('.agent-loop/CONTROL_PLANE_CONFIG.yml')"
  review:
    - PLAN_REVIEW_RESULT approved-with-notes from claude-lead; notes #1-#4 incorporated.
    - CODE_REVIEW_RESULT approved from claude-lead; commit approved for explicit .agent-loop staging with .harness-mem excluded.
  gbrain_memory_used:
    - gbrain search "control plane loop improvement golden eval task manifest promotion rollback ledger" (no direct careviax control-plane memory; used generic process concepts only)
    - MEMORY.md: prior CareViaX lesson that huge ledgers can break whole-file Prettier/OOM; supports date partitioning and bounded file growth
```

```yaml
- task_id: F-20260620-009
  status: done # commit 18e2a29e (rev7 codex APPROVED + VERIFY_OK). 全6カテゴリ active(human PHI policy=外部送信時のみ考慮)。patient/proposal/report は F-012 view=palette 最小投影を消費。rev1→rev7: KPI/client-bundle/NUL/stale/aria-controls/「など」/over-limit fail-closed/encodeURIComponent/view=palette over-fetch を順次解消。
  follow_up_open: # 非ブロッキング(codex 合意)。後続小タスク化候補。
    - option DOM id を index/sanitized 化(row.id 由来の IDREF 堅牢化)。
    - use-global-search.test の stale-query test の React act(...) warning を clean。
    - drug/contact の requiredPermission × destination(/admin/*) contract test。
    - legacy /search page の full-list→minimal(view=palette)移行(今回の rev7 scope 外)。
  owner: claude-lead
  reviewer: codex-lead
  origin_agent: human
  type: feature
  risk_level: medium
  priority: P1
  feature_name: Global search command palette (incremental, type-grouped search window)
  background: >
    User: 「グローバル検索機能の実装。インクリメンタルサーチ。あらゆる情報がわかるように。
    検索ウィンドウには検索対象物が種別ごとに表示されるように」 + internet best practice 調査要求。
    既存 /search は incremental+8カテゴリ横断を実装済みだが、コマンドパレット型の窓UI(⌘K起動・
    矢印キー移動・Enter遷移)が無いのが核心ギャップ。recon: cmdk 未導入、permission はカテゴリ
    fail-soft 依存、/search は readApiJson 未採用。
  user_value: >
    どの画面からも ⌘K で全体検索の窓を開き、種別ごとにグルーピングされた候補をインクリメンタルに
    辿って Enter で遷移できる。キーボード/スクリーンリーダー利用者も操作可能(WAI-ARIA combobox)。
  acceptance_criteria:
    - ⌘K と / で AppShell 所有のコマンドパレット窓が開く(AppHeader は click のみ、global shortcut 登録なし)。
    - MVP=6 text カテゴリ patient/proposal/prescription/drug/report/contact を種別グルーピング表示。facilities と medicationDeadline はパレットから除外(facilities→F-010、medicationDeadline は /search 高度フィルタのみ)。
    - 250ms debounce / 最小2文字 / AbortController / sequence-id で古い応答が新しい結果を上書きしない。
    - 権限 map が visibility と no-fetch の単一 SSOT。unknown role / orgId 欠落は org-scoped カテゴリを fetch しない(fail-closed)。
    - カテゴリ別 raw 形状 zod schema(success()=生)で fail-closed parse、逆 malformed(誤envelope/配列欠落)を reject。1カテゴリの 403/失敗/malformed は当該のみ隔離、他は表示継続。
    - prescription は best-effort(limit=8 bounded、filter→決定的 cap、暫定ラベル可視/aria)。完全網羅は主張しない。
    - combobox(input focus+aria-activedescendant)/listbox/option+aria-selected、↑↓/Enter/Esc、focus 復帰、role=status/alert、WCAG AA、44px。
    - builders は src/lib/search へ移設、route は再エクスポート shim(search-content/page/test 無編集)。
  constraints:
    - claude UI lane。src/app/api/**, src/lib/auth/**, prisma/**, src/server/**, package.json, lockfile 非編集。新依存追加なし(cmdk 不採用)。
    - §9(エラーに PHI/生メッセージ出さない)/§10(readApiJson+schema fail-closed)準拠。PHI は氏名+状態のみ、report 本文断片を出さない。
    - PHOS Board(src/phos/**)は触らない(global-shortcuts.ts は AppShell 用で別)。
  scope:
    allowed_paths:
      - src/lib/search/**
      - src/lib/stores/command-palette-store.ts
      - src/components/features/search/**
      - src/components/layout/app-shell.tsx
      - src/components/layout/app-shell.test.ts
      - src/components/layout/app-shell.test.tsx
      - src/components/layout/app-header.tsx
      - src/components/layout/app-header.test.tsx
      - src/components/features/keyboard/global-shortcuts.ts
      - src/app/(dashboard)/search/search-result-builders.ts
    denied_paths:
      - src/app/api/**
      - src/lib/auth/**
      - prisma/**
      - src/server/**
      - package.json
      - pnpm-lock.yaml
    max_diff_lines: 1200
  loop_policy:
    primary_loop: coding
    max_iterations: 4
    max_runtime_minutes: 90
    max_cost_usd: null
    require_plan_before_edit: true
    concurrency_key: global-search-palette
  success_gates:
    required: [typecheck, unit_tests, lint, no_scope_violation, diff_review]
    optional: [build, e2e_tests]
  approval:
    human_required_if:
      - touches_auth
      - adds_dependency
      - changes_database_schema
  verification:
    - pnpm typecheck
    - pnpm typecheck:no-unused
    - pnpm lint
    - pnpm format:check
    - pnpm test
    - pnpm build
  gbrain_memory_used:
    - recon-code SYSTEM_MAP (existing /search, searchable entities, permissions, §9/§10 patterns)
    - WebSearch best practice (debounce 300-500ms, AbortController, min 2 chars, type grouping, WAI-ARIA combobox, pg_trgm/CJK FTS for backend follow-up)
    - projects/careviax/fix-patterns/route-wire-shape-schema-parity-tests (F-007 lesson: match schema to raw route shape)
```

```yaml
- task_id: F-20260620-010
  status: done # commit 721ce32d; F-010A narrowed backend search slice approved by claude-lead and landed. F-010B deferred for aggregate/new entities/search-index work.
  owner: codex-lead
  reviewer: claude-lead
  origin_agent: claude-lead
  type: feature
  risk_level: medium
  priority: P2
  feature_name: Backend search expansion for global palette (F-010A server q+limit + minimal projections)
  background: >
    F-009 (global search palette) は UI-only スライスのため、検索バックエンドの不足を本タスクへ分離。
    現状: /api/facilities は q/limit 無視(take なし findMany=payload 非bounded)、/api/prescription-intakes は
    server q 未対応(client filter で代替)、/api/contact-profiles は q ありだが limit/pagination なし。
    未カバーエンティティ(Task/Staff/Incident/Billing/PartnerPharmacy)も横断対象外。
  user_value: >
    facilities を含む全カテゴリで server-side の絞り込みが効き、payload/データ最小化を守りつつ
    「あらゆる情報」を取りこぼしなく横断検索できる。
  acceptance_criteria:
    - /api/facilities が q + limit を server-side で適用(全件 fetch を解消、F-009 でパレット復帰可能に)。
    - /api/prescription-intakes が server-side q 検索に対応(client 補完を解消)。
    - /api/contact-profiles に bounded limit summary mode を追加(cursor pagination は F-010A では不要と判断)。
    - 追加エンティティ(Task/Staff/Incident/Billing 等)の検索 or 集約 /api/search aggregator は F-010B へ延期。
    - 全エンドポイントが org スコープ(RLS/withAuthContext)と permission gate を維持。検索 payload に識別子以上の PHI を出さない。
  constraints:
    - backend lane(codex)。RLS/permission/§9/§10 を弱めない。CJK/カナ検索は pg_trgm/bigram 等の方針を調査(拡張追加は infra/migration=人間承認/BLOCKED 対象)。
    - q-only /api/contact-profiles は /admin/contact-profiles の詳細表示・編集互換のため full payload を維持。パレット再有効化時は limit=8 付きの minimal summary mode を使う。
  follow_up:
    - F-010B: aggregate /api/search, Task/Staff/Incident/Billing/PartnerPharmacy search, and pg_trgm/bigram/FTS/generated-column/index decisions (migration/extension work is human-gated).
    - F-009 follow-up: after F-010A, re-enable prescription/contact categories against the minimal backend contracts; contact endpoint must include limit=8.
  verification:
    - pnpm typecheck
    - pnpm lint
    - pnpm test
    - pnpm build
  gbrain_memory_used:
    - projects/careviax/decisions/2026-06-21/bounded-search-minimal-projections
    - projects/careviax/gates/2026-06-21/f-20260620-010-721ce32d
    - projects/careviax/performance-findings/2026-06-21/contact-summary-sequential-bounded-scan
```

## F-011 Stage2 — 合意 owner/順序（2026-06-21, claude×codex 調整済）

レーン原則: **codex = 機械的・低リスクの DataTable caller 配線継続（T1 workload-transfer 継続）**、
**Claude = 判断を要する UI（非DataTable ErrorState 配置 / P-A 個別 / T4 状態色集約）**。
各スライス小・自レーン LOCK・maker/checker・objective gate・reviewer 相互。path 非重複で並行可。

| slice          | owner  | reviewer | 内容                                                                                                                                                    | 状態                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-20260621-002 | codex  | claude   | T1: DataTable 既存 errorMessage/onRetry を admin/institutions・pca-pumps へ配線（DataTable 不変）                                                       | **done** f6e81a24                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F-20260621-003 | codex  | claude   | perf: /search patient を view=search 中間 projection へ（subtitle 維持で payload 削減、実測 5489B→小）                                                  | review/lock granted                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S2a            | codex  | claude   | T1 DataTable 配線 High: admin/users + admin/jobs（同形・DataTable 不変）                                                                                | queued（codex perf task 後）                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S2b            | codex  | claude   | T1 DataTable 配線 Med: facility-standards/document-templates/pharmacist-credentials/billing-rules/audit-logs/tasks/analytics/qr-drafts 等を 1-2 file/PR | queued                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S2c            | claude | codex    | T1 非DataTable ErrorState 横展開: performance/dispense-audit-stats/alert-rules/realtime（UI 配置判断）                                                  | **done** b45bf925 (dispense-audit-stats 331cd347); codex APPROVED rev2                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S2d            | claude | codex    | P-A 個別: prescriptions/new 手書き error→ErrorState（小）→ patients/new 段階表示・reports グルーピング（大・別 PLAN）                                   | **done(Slice1-3)**: Slice1 reports 順序 fb6c21c0 / Slice2 patients/new 段階表示 2df6acab / Slice3 離脱防止 94a06be2、全 codex APPROVED。S2d-1(prescriptions/new error)=現状維持で合意。Slice4(reports rail drawer)=**no-op/verified-done**(隔離 worktree 調査: action rail は既に全画面で WorkspaceActionRail=Sheet ドロワー化済、app-header トリガー aria/44px+Esc/focus-trap。matrix T5 の常設 rail 前提が stale だった)。patients/new ドラフト自動保存=PHI 端末保存で human gate(別 PLAN) |
| S2e            | claude | codex    | T4 状態色6軸集約: clerk-support/patients/[id]/admin/realtime/performance/notification-settings/qr-drafts                                                | **done**: clerk-support eed6cc63 / prescription-history S1 8996abde + S2-S4 24c77038 + 後発 01b961cf / card-workspace activity 39752067 / realtime SSE a9ba6338。SSOT 境界事例4件を 85679a60 で明文化。維持(意図的): route/method/カテゴリ/臨床ハザード/print/calendar/施設テーマ/暦区分。全 codex APPROVED、full unit 8664 pass + build green                                                                                                                                               |

並行 housekeeping（joint）: matrix §3 stale 訂正（DataTable は既に skeleton/empty 内蔵、consent は isLoading 済）;
gbrain promotion review: `projects/careviax/lessons/candidates/api-response-validation-and-consolidation`
(times_confirmed=2) を §13 gate で VerifiedLesson 昇格検討。

## RUN-20260622-001 Cycle 6 — admin a11y / 情報設計スライス（claude=owner, codex=reviewer）

レーン: 全て Claude UI lane・自ファイル LOCK・maker/checker・objective gate・codex peer review。

### F-20260622-001 — admin UI/UX 連続スライス（全 DONE）

| slice  | 内容                                                                                                                                         | 状態                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| slice1 | admin service-areas + alert-rules: native `<select>`(36px) → 共有 `@/components/ui/select`、44px 全 breakpoint trigger、空保存ブロッカー維持 | **done** e73ff383（codex rev2 APPROVED; vitest 11/11 + 全 gate green）                    |
| slice2 | admin capacity: 「今すぐ見るべきこと」を chart 上へ昇格（SSOT §2/L117 情報順）、loading skeleton 追従、DOM順序テスト                         | **done** 91d47e84（codex rev3 APPROVED; vitest 3/3 + 全 gate green）                      |
| slice3 | admin document-templates: PageSection(h2) + CardTitle asChild h3 階層、TemplateBodyEditor 内側 h2→h3 + aria-labelledby                       | **done** f40a77f5（codex 4-round plan + patch rev1 APPROVED; vitest 8/8 + 全 gate green） |

### F-20260622-002 — drug-masters native-select a11y 移行（8 selects、3 sub-slice 分割）

origin: slice1 verify subagent が検出した範囲外残渣（drug-master-content.tsx の 8 native select、mixed label/aria パターン）。1メガ diff を避け 4a/4b/4c に分割（codex 承認）。

| sub-slice | 対象 selects                                           | 状態                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4a        | #1 対象拠点 / #2 コピー元拠点 / #3 テンプレート        | **in review (rev2)**: plan rev5 APPROVED（5-round; clear sentinel + 完全 target reset + 44px trigger/item + 強化 mock）。実装(frontend-implementer)→ codex patch rev1 changes_requested（P1 stale-async-preview guard + test 契約3件）→ rev2 実装中 |
| 4b        | #4 CSV用途 / #5 取込ソース / #6 取込状態 / #7 薬効分類 | queued（filter selects、空 option なし）                                                                                                                                                                                                            |
| 4c        | #8 採用後発薬（accessible name 欠落も補修）            | queued                                                                                                                                                                                                                                              |

deferred（判断要・別タスク）: M9 business-holidays（カレンダー↔一括登録結合）/ M3 billing-rules（§15 billing hard-stop 近接=human-gate）。

### native-select a11y バックログ（read-only インベントリ 2026-06-22、将来 Discover 候補）

slice1/4a と同種の sub-44px native `<select>` 残債。admin lane を優先、患者・臨床画面は医療/PHI ハザードのため要慎重・別 PLAN。

- **admin（低〜中リスク、優先）**: drug-masters 残り5（=4b/4c）/ admin/pharmacy-cooperation-setup-content（1）。
- **clinical/患者（高リスク・要慎重、各別 PLAN）**: patients/[id]/card-workspace（23）/ prescriptions/new/prescription-intake-form（9）/ patients/[id]/patient-insurance-card（5）/ patient-documents-panel（4）/ patients/[id]/mcs（3）/ prescription-history（2）/ patient-labs-card（1）/ patients-board（1）/ referrals/new（2）/ schedules/schedule-team-board（1）/ workflow/pharmacy-cooperation（1）/ billing/partner-cooperation（1=billing hard-stop 近接）。
- 方針: slice1 で確立した shared `@/components/ui/select` + 44px trigger/item + MockSelect パターンを踏襲。label-wrap は aria-labelledby へ翻訳、空 option が action を gate する場合は明示 clear sentinel + 完全 state reset（slice4a で確立）。

### §22b 自律探索 追加候補（2026-06-23、read-only Discover sweep）

§22b idle 自律探索の初回成果。今回は general-purpose subagent で実施したが、§22b 改訂により**今後の探索は gstack スキル優先**（`/health` / `/design-review`|`/design-consultation` / `/cso`(advisory) / `/investigate`）。
**dedupe:** 探索が挙げた select 移行候補（mcs/insurance/labs/documents/schedule-team-board/pharmacy-cooperation/partner-billing 等）は上記「native-select a11y バックログ」に**計上済み** → 重複登録しない。state-color drift は CLOSED（migration-map L360 残ゼロ）。TODO/FIXME は Claude-lane 非テストに 0 件。以下は既存インベントリに**無い NEW 候補**のみ（要 PLAN_REVIEW + LOCK、未着手）:

- **referral-form-unsaved-guard-and-select**（owner: claude-lead, est S）: `referrals/new/referral-form.tsx` の native select 2件（依頼種別/性別, `h-8`=32px）を共有 Select へ + 多項目 intake フォームに `useUnsavedChangesGuard` 追加（現在ガード無し＝入力中離脱でデータ損失）。evidence: referral-form.tsx:177,321 / guard 不在（cf. prescription-intake-form.tsx:525 はガード有）。why: 紹介 intake のデータ損失防止 + select 整合。
- ~~**icon-button-aria-labels**（owner: claude-lead, est S）~~ **INVALID（2026-06-23, recon-before-PLAN で取消）**: recon の結果、主張サイトは全て既にラベル済み or 存在せず＝実ギャップなし。external-share copy ボタンは `aria-label="URLをコピー"` 等あり(:596/:610)、shifts 月送りは `aria-label="前月"/"翌月"`(:946/955)、medication-calendar には該当 Button が無い。§22b の汎用サブエージェント探索の false-positive。**教訓: a11y 探索は gstack `/design-review` を優先**（汎用サブエージェントは行番号・存在を誤りやすい）。実装不要。
- **dispense-workbench-select-migration**（owner: claude-lead）**DESIGN-GATED / DEFER（2026-06-23 recon）**: native select 2件は実在（`right-pane.tsx:874` NG分類, `prescription-grid.tsx:510`）が、(1) **a11y ギャップなし**（NG分類 label は `htmlFor="ng-classification"` で正しく関連付け済み）、(2) workbench 独自の **`--wb-*` CSS 変数＋inline style**（意図的な「レセコン風」高密度デザイン）で書かれている。よって shared shadcn Select への移行は a11y/bug 修正ではなく**デザイン一貫性の taste 判断**で、ワークベンチの意図的な見た目を変えるリスクがある。→ 機械的移行スライスにはせず **defer**。判断には `/design-review` or `/design-consultation`（または人間のデザイン決定）が必要。a11y-only の余地も現状なし。
- （L-size 別途・consistency-only）patient-form.tsx(42) / card-workspace.tsx(23) は既に `min-h-[44px]` 応答パターン使用 → a11y 動機ではなく整合のみ、優先度低。

### §22b 自律探索 第2弾（2026-06-23、gstack `/health` で実施）

gstack `/health`（read-only コード品質ダッシュボード）の結果。**codebase は健全**: typecheck exit 0 / vitest **8780 passed | 1 skipped** / 実 src lint 0 problems。唯一の実 candidate は CI ハイジーン:

- **eslint-ignore-stale-harness-worktrees**（owner: codex-lead = build/gate/tooling, reviewer: claude-lead, est S, **CI-hygiene 高価値**）: `pnpm lint`（`eslint .`）が exit 1。原因は git-ignore 済み `.harness-worktrees/*`（古い base d607ffd9 から fork した stale worktree 2件: F-UX-REPORTS-RAIL-DRAWER + harness/worker）内のコピーに setState-in-effect error + unused-vars。eslint flat-config は `eslint.config.mjs:9` の `globalIgnores([...])` を持つが `.harness-worktrees/**` を含まない → eslint が物理ディレクトリを走査。**fix: `globalIgnores` に `.harness-worktrees/**`を追加**（1行、低リスク）。代替: stale worktree を`git worktree remove`で prune（使用中なら不可なので ignore 追加が安全）。evidence: /health lint exit 1（5 problems 全て .harness-worktrees 配下、実 src 0）。why: 毎パッチで caveat 化してきた lint gate の red を解消し`pnpm lint` を clean な objective gate に戻す。
  - note: これは私(claude)が全パッチ検証で繰り返し flag してきた環境ノイズの恒久 fix。owner は build/tooling なので codex レーンへ surfacing（§22b クロスレーン探索）。

### §22b 自律探索 F-003 deferred href-hardening candidates（2026-06-23、codex read-only Discover）

F-20260623-003 は `patient-detail-foundation` の 8 patient action href のみを source patch 対象にしたため、
同じ raw patient id route-construction pattern を持つ sibling surfaces を follow-up として intake。いずれも
owner-lane: **codex**（backend/service/job href construction）、要 PLAN_REVIEW + LOCK、未着手。

- **patient-home-operations-href-hardening**（owner: codex, est S）: `src/server/services/patient-home-operations.ts` の patient action href を shared patient href helper へ寄せる。scope: home-care operation summary/action hrefs only; DB where identity は raw 維持。evidence: F-003 read-only Discover で raw `/patients/${...}` pattern 3件。
- **patient-detail-documents-href-hardening**（owner: codex, est S）: `src/server/services/patient-detail-documents.ts` の document-related patient hrefs を path-segment encoded route builder へ寄せる。scope: documents service action hrefs only; document URL/presigned URL は非対象。evidence: F-003 read-only Discover で raw `/patients/${...}` pattern 7件。
- **patient-detail-timeline-events-href-hardening**（owner: codex, est M）: `src/server/services/patient-detail-timeline-events.ts` の timeline hrefs を route/path segment と query param で分けて harden する。scope: patient path segment encoding + query values via URLSearchParams where applicable; timeline semantics 不変。evidence: F-003 read-only Discover で raw path/query mixed patterns 複数件。
- **daily-preparation-patient-href-hardening**（owner: codex, est S）: `src/server/jobs/daily/preparation.ts` の generated patient href を shared route helper へ寄せる。scope: daily preparation job output link only; job query/data selection 不変。evidence: F-003 read-only Discover で raw `/patients/${...}` pattern 1件。

### F-001 review follow-ups（2026-06-23、codex の referral-form patch review が surfacing）

F-20260623-001（referral-form select 移行＋unsaved-guard）のレビューで codex が指摘した、この UI スライス範囲外の項目。いずれも別 PLAN_REVIEW + LOCK 必須、未着手。

- **referral-intake-persist-type-and-checklist**（owner: codex = API/domain, reviewer: claude, **P1 data-capture gap**）: 新規紹介フォームは `referral_type` と書類チェックリストを収集・dirty 追跡するが、`/api/cases` の `createCaseSchema` は `patient_id/referral_source/referral_date/notes` のみ受理し**これらを永続化しない**。収集データが保存されないギャップ。要 schema/API 拡張＋PLAN（DB/契約変更のため hard-stop 近接の判断要）。evidence: codex confirmed createCaseSchema fields。
- **referral-create-transactional-or-safe-retry**（owner: codex = API/domain, reviewer: claude, **P1 data-integrity / 高リスク**）: 紹介作成は patient POST 成功後に case POST する2段階。case POST 失敗後のリトライで**重複/孤児 patient** が発生しうる。要 transactional referral-create endpoint もしくは安全な reuse/retry 戦略＋PLAN。pre-existing だが在宅紹介 intake で高リスク。evidence: codex review (2段階 POST フロー)。
- **referral-form-error-summary-focus-target**（owner: claude = UI/a11y, est S）: `FormErrorSummary` の focus 対象 id が focusable wrapper でなく内側 Alert に付いている疑い（バリデーション失敗時にフォーカスが当たらない）。WCAG focus 管理の a11y 修正。evidence: codex review (F-001 a11y note)。
