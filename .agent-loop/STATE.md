# Agent Loop — STATE

**Purpose.** Single source of truth for the current loop's runtime state. The two Supervisors
(`claude-lead`, `codex-lead`) read this at the start of every cycle and write it back at the
end. It is the first file consulted on resume and the last file written on a hard-stop.

**How it's used in the loop.**

- At cycle start: read the YAML, confirm `current_run_id` / `current_cycle`, pick up `next_action`.
- During a cycle: update `active_task_id`, `claude_status`, `codex_status` as work proceeds.
- At the gate: write `last_gate_result` (pass | fail | unknown).
- On hard-stop: write the **Resume point** section below so the next session continues cleanly.
- `zero_actionable_count` increments each cycle the queue yields no actionable task; the loop
  idles/backs off when it climbs (see FEATURE_QUEUE.md for intake).
- **Time-elapsed (§14 90-min hard-stop).** `cycle_start_time` is a durable ISO8601 Asia/Tokyo
  timestamp set at run start. At each cycle boundary the Supervisors compute
  `elapsed = now − cycle_start_time`; if `elapsed ≥ 90 min`, trigger a hard-stop (write the
  **Resume point** section, then exit). Because it is persisted here, the budget survives resume —
  do **not** reset it on a mid-run resume; only a fresh run resets it.
- **Files-touched (§14 >20-file hard-stop).** `files_changed_count` is the count of distinct paths
  from `git diff --name-only` measured from the cycle-start tree/commit. Refresh it at each cycle
  boundary; if it exceeds 20, trigger a hard-stop with resume-point persistence (capture
  `active_task_id`, locked paths, and the next command in **Resume point** before exiting).

```yaml
current_run_id: RUN-20260621-001
current_cycle: 1 # User-priority loop-control update: idle-capacity auto-discovery/execution wiring.
cycle_start_time: 2026-06-21T12:28:00+09:00 # ISO8601 Asia/Tokyo; reset at each run start. elapsed = now − cycle_start_time, checked at every cycle boundary vs §14 90-min hard-stop
active_task_id: F-011-S2e-patients-id
current_cycle_note: 'F-011 S2e 進行中: S1(cycle status SSOT role) landed 8996abde; S2-S4(prescription-history 状態色) rev2 peer review 中。並行して LOOP_POLICY に §15(no passive-wait per-turn trigger)を追加し、応答待ち=overlap time として §14 ladder を毎ターン自動実行する運用へ更新。'
files_changed_count: 2 # 本サイクルの loop-control 編集(LOOP_POLICY.md/STATE.md)。prescription-history 等は別 LOCK/別コミット。
claude_status: implementing # S2-S4 patch rev2 を peer review に出しつつ、§15 に従い非衝突タスク(loop-update/SSOT 草案)を並行実行。
codex_status: reviewing # F-011-S2e rev2 と loop POLICY_UPDATE をレビュー予定。
last_memory_bootstrap: 2026-06-21 # 既存 .agent-loop policy/config/state と design-analyst grounding を参照。
zero_actionable_count: 0 # §15 により、応答待ちでも §14 ladder を実行してから初めて increment。
last_gate_result: pass # focused vitest 5/5 + typecheck/eslint/prettier(prescription-history rev2)。
next_action: §15 適用 — S2-S4 rev2 承認待ちは overlap time とし、非衝突タスク(SSOT migration-map 追記草案の Codex 提案 / 次 UI_AUDIT_MATRIX stage の read-only scope)を進める。inbound review/lock は最優先で yield。
```

## gbrain memory (this run)

<!-- Per GBRAIN_SCHEMA.md §15: after each `gbrain put`, append the memory_id (= slug) here so the
     run's durable writeback is auditable. Format: `- <type>: <slug> (<commit>)`. -->

- ImplementationDecision: projects/careviax/decisions/state-color-token-unification (smoke-seed 2026-06-20)
- FailurePattern: projects/careviax/failures/mutation-returns-raw-row-phi-leak (2026-06-20, slice7 PHI)
- FixPattern: projects/careviax/fix-patterns/mutation-reuse-get-safe-projection (2026-06-20)
- DuplicateMap: projects/careviax/duplicates/pharmacy-cooperation-api-contracts (2026-06-20, slice8)
- ImplementationDecision: projects/careviax/decisions/readapijson-schema-fail-closed (2026-06-20)
- GateResult: projects/careviax/gates/pharmacy-cooperation-hardening-green-20260620 (full suite 8465 passed)
- LoopRun: projects/careviax/loop-runs/2026-06-20/codex-response-schema-hardening (2026-06-20)
- CandidateLesson: projects/careviax/lessons/candidates/api-response-validation-and-consolidation (→ PROMOTION_QUEUE)
- ReviewFinding: projects/careviax/reviews/hardening-slice-precommit-clean-20260620 (Cycle 2; 0-blocker pre-commit review, links FailurePattern/FixPattern/Decision)
- FailurePattern: projects/careviax/failures/false-empty-and-stale-wipe-on-fetch-failure (Cycle 4; F-004 377d9e1e — false-empty + stale-wipe-on-refetch + fix)
- ReviewFinding: projects/careviax/reviews/statistics-hub-registry-contract-coverage-20260620 (F-007; registry self-consistency tests missed approved manifest coverage)
- ReviewFinding: projects/careviax/reviews/statistics-hub-contract-reconciliation-and-permission-gating-20260620 (F-007 rev6; raw recon reconciliation + page/per-surface permission gating)
- ReviewFinding: projects/careviax/reviews/statistics-hub-rev7-contract-permission-api-mismatch-20260620 (F-007 rev7; green gates missed KPI response contract + destination permission mismatches)
- CandidateLesson: projects/careviax/lessons/candidates/api-response-validation-and-consolidation (F-007 2a4780d0 confirmation; times_confirmed=2, promotion_status=candidate)
- FixPattern: projects/careviax/fix-patterns/route-wire-shape-schema-parity-tests (F-007 2a4780d0; align client schema/test mocks to real route wire shape)
- ImplementationDecision: projects/careviax/decisions/2026-06-20/control-plane-mvp-advisory-and-date-partitioned-gbrain (F-008 ebeacee6; advisory Control Plane MVP + dated new-memory slug layout)
- ImplementationDecision: projects/careviax/decisions/2026-06-21/bounded-search-minimal-projections (F-010A 721ce32d; bounded backend search + minimal projections)
- GateResult: projects/careviax/gates/2026-06-21/f-20260620-010-721ce32d (F-010A 721ce32d; focused tests/typecheck/no-unused/eslint/prettier/diff-check/build GREEN)
- PerformanceFinding: projects/careviax/performance-findings/2026-06-21/contact-summary-sequential-bounded-scan (F-010A 721ce32d; avoid redundant per-kind contact scans)

## Resume point

<!-- Written only on hard-stop. Capture: active_task_id, the exact step in progress,
     any locked paths to release, and the single next command/action to take.
     Empty at bootstrap. -->

**active_task_id**: なし（F-011 Stage1 完了）。次は FEATURE_QUEUE / F-011 Stage2+ を別 PLAN_REVIEW で。

**完了済（このサイクル, landed+verified）**:

- F-20260620-009 グローバル検索パレット — commit 18e2a29e。
- F-20260620-012 最小投影 backend（reviewer=claude, Medium 検出）— commit cc8209fc。
- F-011 Stage1a（workbench module.css chrome 配色トークン化, dark AA）— commit 5c5048d9。
- F-011 Stage1b-1（view 色生成 SSOT を theme 安定 --wb-\* token 化, A-prime, dark AA + contrast contract test）— commit 9c295163。
- F-011 Stage1b-2（消費側 inline + logic.ts form 色 + LEGEND 同 source + semantic 分離 compare/packet/outside-med≠tonyo）— commit 393541c7。**F-011 Stage1(P-B 調剤系4画面配色揃え)完了・lock release 済**。

**確立した token 体系（module.css .root, theme 安定）**: --wb-state-{done,blocked,confirm,readonly}/--wb-info/--wb-hazard（dark solid=fill兼ink）、--wb-_-bg/-border（固定 light tint）、--wb-phase-_（dot/strong=白ラベルAA/border）、--wb-tag-\*/avatar/chip（category）、--wb-surface/-alt/-muted/-selected/--wb-accent/--wb-ink/-ink-muted/--wb-line（data-plane 安定 light）。外殻 chrome=Stage1a adaptive --wb-primary/confirm。contract test=workbench-color-tokens.test.ts（raw hex/未定義token/change-type/数値contrast）。

**中断点: なし（F-011 Stage1 完了, lock release 済）。**

- 次の着手候補: F-011 Stage2+（UI_AUDIT_MATRIX §4: T1 DataTable state 標準化 → T4 状態色6軸集約 → T3/T5 MasterEditor/responsive → T6/T7 a11y → P-A 個別 → T2 typo）は**別 PLAN_REVIEW_REQUEST**で開始（Stage1 と混ぜない／codex 既出 note）。または FEATURE_QUEUE の次タスク。
- 着手時: lock 取得 → 実装 → maker/checker → objective gate → commit。frontend-implementer は worktree 隔離で共有ブランチ不適（main tree で実装 or isolation 無し agent）。

> Note: a hard-stop writes the **Resume point** here before exiting so the next session can resume without re-deriving context.
