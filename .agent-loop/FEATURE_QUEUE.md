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

### RUN-20260702-FEUX フロントエンド改善キャンペーン（design-analyst 監査 + 台帳、Codex maker / Claude checker）

ユーザー指示（2026-07-02）: **全項目 Codex 実装、goal モードで全完了までループ**。maker=Codex 一貫 / checker=Claude（reviewer-audit 独立クロスチェック + objective gate + land）。進捗はユーザーに逐次確認せず Claude↔Codex 直接調整で自走、hard-stop / 根本変更のみ相談。CE14/N25（Codex 現行）完了後に着手。各スライス小・自レーン LOCK・相互レビュー・objective gate 必須。

**運用変更（2026-07-03）: Claude 単独運用へ移行**。Codex/agmsg ループは停止。maker=Claude（メイン or frontend-implementer）/ checker=`reviewer-audit` サブエージェント（独立コンテキストで承認パス、同一コンテキストでの自己承認禁止）/ 最終判定=objective gate（typecheck / typecheck:no-unused / lint / test / build）。各スライス小・独立レビュー・gate green で land。

| id     | 優先 | 内容                                                                                                                                                                                                                 | owner  | reviewer | 状態                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FEUX-1 | T1   | ローディング aria drift: 裸 `animate-pulse` スケルトンを `Skeleton`/`SkeletonRows`（`role="status"`+`sr-only`）へ寄せる。最悪例 `admin/analytics/analytics-content.tsx` L328/351/445/497/571 ほか ~18箇所/11ファイル | codex  | claude   | **done** 11b431e9（analytics 5裸→LoadingRegion+Skeleton、Claude APPROVE 二重検証・9/9 teeth green）。※他ファイルの残 animate-pulse は後続スライスへ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| FEUX-2 | T1   | `MetricCard`/`KpiCard`/`SummaryCard` 11重複を `StatCard` へ統合。`tabular-nums`/状態アクセント/44px を SSOT 準拠に。reports/billing/external/workflow/admin 配下                                                     | claude | subagent | **in-progress**（Codex 分: reports 16158be4 / billing f7dbac15 / capacity 65a4c795）。Claude 単独運用分: business-holidays 8651015f / staff-kpi e50a1f27 / workflow(24箇所 forwarder) 88746f18。残: analytics(isLoading) / performance(HelpPopover+tone) / schedule-metric-card(gradient意匠) / offline-sync(tone全面塗り=非互換) / admin-metrics(target/alert=非互換)。checker=reviewer-audit 独立レビュー                                                                                                                                                                                                                             |
| FEUX-3 | T2   | 患者カード homeOperations false-empty: `patients/[id]/card-workspace.tsx:3861` の useQuery が isError 未読→500 で「主要項目 確認済み」誤バッジ。isError 伝播+degraded バナー+retry。ホットパス                       | codex  | claude   | **done**（先行実装 61552be60 で landed 済み・queue 記載が stale だった）。error 時バッジ「サーバー集計 取得失敗」・degraded 近似バナー+再試行を実装、テスト card-workspace.test.tsx L1521-1540 が誤「確認済み」非表示/retry→refetch/回復を検証。2026-07-03 Claude 単独運用で再検証（focused 9 tests green）                                                                                                                                                                                                                                                                                                                             |
| FEUX-4 | T2   | SOAP セクション色の生 Tailwind 直書き `visit-record-detail.tsx:999/1005/1013/1019`。**先に SSOT 追補（`--soap-s/o/a/p` 識別色トークン、AA 検証）→ コード置換**。`text-purple-500` パレット外                         | codex  | claude   | **done**（landed 済み・queue stale）。`text-soap-s/o/a/p` へ移行、globals.css `--soap-*`＋`@theme`、SSOT §7.7 SOAP 識別色トークン契約(AA)追補、visit-record-form 見出しも 03d49349。2026-07-03 監査で確認                                                                                                                                                                                                                                                                                                                                                                                                                               |
| FEUX-5 | T2   | 44px 未満フィルタチップ `search/advanced-filter-modal.tsx:208`（`min-h-[36px]`→44px）。WCAG 2.2 target-size                                                                                                          | codex  | claude   | **done**（landed 済み・queue stale）。`search/advanced-filter-modal.tsx` L209 フィルタチップ `min-h-11` で 44px 達成、`min-h-[36px]` 消滅。2026-07-03 監査で確認                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| FEUX-6 | T3   | 生 Tailwind 状態色 ~102箇所/56ファイル。**lint ガード追加 + 漸進 sweep**（単発 PR でなく）。正当 identity と drift を切り分け                                                                                        | claude | subagent | **実質 done**（厳格方針）。lint ガード追加 `pnpm colors:check`（check-raw-state-colors.mjs＋file-scoped allowlist、ratchet、950 含む、teeth 検証済）4510ee7f。drift sweep cc24047c（document-delivery amber→state-confirm / settings scope 中立 / revision 追加=tag-info・変更/解除=中立）。警告系生色は identity 4ファイル(soap-options/status-icon/presence-contract/result-builders)のみ＝0 drift。**done**。status-icon(患者状態 12値 enum)は identity 据え置きでユーザーラティファイ済（固有アイコン+ラベルで色は冗長=WCAG適合、多値を 5+2 トークンへ潰すと患者ボードの一目判別が退行）。sky/cyan テーマ等の非警告色はガード対象外 |
| FEUX-7 | T3   | Gantt travel バンド生 hex `schedule-team-board.tsx:225` をトークン化（map route hex は要判定）                                                                                                                       | codex  | claude   | **done**（landed 済み・queue stale）。schedule-team-board.tsx から生 hex 消滅、travel バンドは `BLOCK_KIND_CLASSES.travel` の `repeating-linear-gradient` テーマトークンハッチ化。map route hex も無し。2026-07-03 監査で確認                                                                                                                                                                                                                                                                                                                                                                                                           |
| FEUX-8 | T3   | 非RHF controlled-state フォームの離脱ガード欠落を `use-unsaved-changes-guard` へ結線（voice-memo / schedule-create-edit-drawer 等、残ギャップのみ）                                                                  | codex  | claude   | **done**（landed 済み・queue stale）。`use-unsaved-changes-guard` 結線 consumer 5件(visit-record-form/referral-form/schedule-create-edit-drawer/prescription-intake-form/patient-form)。voice-memo は SSOT §5.8 で自動保存優先＝離脱ガード不要が正。欠落フォーム無し。2026-07-03 監査で確認                                                                                                                                                                                                                                                                                                                                             |

除外・保留: 破壊的確認 sweep（adoption 済み・不要）/ 密度リワーク（SSOT 準拠済み）/ EPIC7 no-store（MFA secret・PHI = security hard-stop、ユーザー在席必須）/ offline CE14・N25（Codex 現行、Claude review 待ち）。
SSOT 追補（FEUX-4 前提）: `docs/ui-ux-design-guidelines.md` の「識別目的の固定色」に S/O/A/P トークン定義（AA 検証）+「ローディングスケルトンは `Skeleton`/`SkeletonRows` 必須、裸 `animate-pulse` 禁止」拘束規則。doc 変更も Codex 起案→Claude review。

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

```yaml
- task_id: F-20260702-001
  status: queued
  owner: codex-lead
  reviewer: claude-lead
  origin_agent: claude-lead
  type: bugfix
  risk_level: medium
  priority: P2
  feature_name: Normalize renal safety date labels to JST-safe clinical display
  background: >
    The patient detail workspace and the visit hot-path header-summary backend
    both format renal safety labels as `eGFR x(M/d)` from `measured_at` with
    date-fns `format()`. This is consistent across the two screens today, but
    it depends on the server-local timezone and uses numeric `M/d` formatting
    in a clinical display. Fixing only one path would make the two patient
    safety surfaces disagree.
  user_value: >
    Pharmacists should see the same renal observation date on patient detail
    and visit hot-path patient headers, independent of runtime timezone, with a
    date label that matches the PH-OS clinical date-display rules.
  acceptance_criteria:
    - Renal safety labels in patient detail workspace and header-summary use one shared formatter.
    - The shared formatter is Asia/Tokyo calendar-date safe and covered by a non-JST runtime regression.
    - The clinical date label avoids bare ambiguous MM/DD where PH-OS requires safer clinical date display.
    - Patient detail and visit header-summary renal labels remain visually/semantically consistent.
  constraints:
    - Update both renal label producers in the same slice; do not create cross-screen date drift.
    - Preserve patient/org scoping, existing safety payload shape, and no-store/fail-close route behavior.
    - No DB migration, external fetch, destructive DB operation, push, or deploy.
  verification:
    - pnpm exec vitest run src/server/services/patient-detail.test.ts --reporter=dot --testTimeout=60000
    - pnpm exec eslint --max-warnings=0 src/server/services/patient-detail.ts src/server/services/patient-detail.test.ts
    - pnpm exec prettier --check src/server/services/patient-detail.ts src/server/services/patient-detail.test.ts
    - git diff --check -- src/server/services/patient-detail.ts src/server/services/patient-detail.test.ts
    - pnpm typecheck
```

```yaml
- task_id: F-20260629-006
  status: done
  owner: codex-lead
  reviewer: claude-lead
  origin_agent: codex-lead
  type: bugfix
  risk_level: high
  priority: P1
  feature_name: Harden inventory forecast drug identity to DrugMaster/code-first matching
  background: >
    Admin inventory forecast estimates next-week medication demand from recent
    prescription lines and pharmacy stock. The forecast path must not join by
    display drug names because same-name/different-code products can differ by
    strength, package, or master identity. Medical safety review also found that
    unresolved demand could be hidden if code-less/code-not-found/ambiguous rows
    were separated from automatic matching but not shown to users.
  user_value: >
    Pharmacists should see automatic shortage forecasts only when a prescription
    line can be resolved to DrugMaster/code identity, while unresolved coded
    demand remains visible as a review item instead of being silently dropped or
    name-joined to the wrong stock.
  acceptance_criteria:
    - Automatic forecast matching uses DrugMaster id first and canonical code second; drug base names are not used to join prescription demand to stock.
    - Prescription line YJ, receipt, and HOT codes resolve through DrugMaster before forecast aggregation.
    - DrugMaster code-not-found lines and missing-code lines are returned as unresolved demand, not automatic shortage matches.
    - Duplicate receipt/HOT candidates are not resolved by DB row order; they are surfaced as ambiguous unresolved demand.
    - The admin UI visibly surfaces unresolved demand with reason/code, required quantity, affected patient count, and 要確認 status.
    - Focused pure, route, and UI tests cover the code-first behavior and unresolved-demand visibility.
  constraints:
    - No DB migration, no external fetch, no name-based DrugMaster matching, no destructive DB operation.
    - Preserve route auth, no-store behavior, next-week visit cohort semantics, and existing automatic shortage DTO shape.
    - Follow PH-OS UI/UX guidance: no false empty, clear state, and separate unresolved review demand from automatic shortage rows.
  verification:
    - pnpm exec vitest run src/lib/analytics/inventory-forecast.test.ts src/app/api/admin/inventory-forecast/route.test.ts 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.test.tsx' --reporter=dot --testTimeout=30000
    - pnpm exec eslint --max-warnings=0 src/lib/analytics/inventory-forecast.ts src/lib/analytics/inventory-forecast.test.ts src/app/api/admin/inventory-forecast/route.ts src/app/api/admin/inventory-forecast/route.test.ts 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.tsx' 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.test.tsx'
    - pnpm exec prettier --check src/lib/analytics/inventory-forecast.ts src/lib/analytics/inventory-forecast.test.ts src/app/api/admin/inventory-forecast/route.ts src/app/api/admin/inventory-forecast/route.test.ts 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.tsx' 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.test.tsx'
    - git diff --check -- src/lib/analytics/inventory-forecast.ts src/lib/analytics/inventory-forecast.test.ts src/app/api/admin/inventory-forecast/route.ts src/app/api/admin/inventory-forecast/route.test.ts 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.tsx' 'src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.test.tsx'
    - pnpm typecheck
    - pnpm typecheck:no-unused
  gbrain_memory_used:
    - gbrain search "CareViaX PrescriptionLine drug_master_id drug_code code-first" (no directly relevant CareViaX hit; returned unrelated careroute-rx snippets)
  completion:
    commit: 51edfa10
    review: Claude APPROVED 2026-06-29T04:34:04Z
    validation: focused vitest 3 files/38 tests, scoped eslint, scoped prettier --check, git diff --check, pnpm typecheck, pnpm typecheck:no-unused
```

```yaml
- task_id: F-20260629-005
  status: done
  owner: codex-lead
  reviewer: claude-lead
  origin_agent: codex-lead
  type: bugfix
  risk_level: medium
  priority: P1
  feature_name: Resolve pharmacy stock usage mismatch by YJ, receipt, and HOT codes
  background: >
    GET /api/pharmacy-drug-stocks/usage-mismatch summarizes recent QR draft
    medication usage against adopted pharmacy stock. The route already stopped
    matching name-only rows to DrugMaster, but coded rows were normalized by
    slicing drugCode to 12 characters and matching DrugMaster.yj_code only.
    That could leave 9-digit receipt codes and 13-digit HOT codes unmatched, or
    truncate HOT codes before lookup.
  user_value: >
    Adoption gap checks should classify QR usage by the same public medication
    code families used by the drug master: YJ, receipt, and HOT. Pharmacists
    should not see a coded medicine as unrecognized merely because the source
    QR carried a receipt or HOT code instead of YJ.
  acceptance_criteria:
    - QR usage code normalization preserves the full source code and does not truncate 13-digit HOT codes.
    - DrugMaster lookup resolves usage by yj_code, receipt_code, or hot_code.
    - If the same source code appears in multiple DrugMaster code families, lookup resolves deterministically by YJ, then receipt code, then HOT code.
    - Name-only QR medication rows remain unresolved; no drug_name lookup is reintroduced.
    - The matched_drug response shape remains limited to the previous safe display projection.
    - Focused route tests cover receipt-code and HOT-code resolution, code-family priority, plus response projection.
  constraints:
    - No DB migration, no external fetch, no name-based DrugMaster matching.
    - Preserve route auth, RLS context, no-store/fixed-error behavior, query validation, and response totals.
    - Do not touch Claude FE locked medications files.
  verification:
    - pnpm exec vitest run src/app/api/pharmacy-drug-stocks/usage-mismatch/route.test.ts --reporter=dot --testTimeout=30000
    - pnpm exec eslint --max-warnings=0 src/app/api/pharmacy-drug-stocks/usage-mismatch/route.ts src/app/api/pharmacy-drug-stocks/usage-mismatch/route.test.ts
    - pnpm exec prettier --check src/app/api/pharmacy-drug-stocks/usage-mismatch/route.ts src/app/api/pharmacy-drug-stocks/usage-mismatch/route.test.ts
    - git diff --check -- src/app/api/pharmacy-drug-stocks/usage-mismatch/route.ts src/app/api/pharmacy-drug-stocks/usage-mismatch/route.test.ts
    - pnpm typecheck
    - pnpm typecheck:no-unused
  gbrain_memory_used:
    - gbrain search "CareViaX PrescriptionLine drug_master_id drug_code code-first" (no directly relevant CareViaX hit; returned unrelated careroute-rx snippets)
```

```yaml
- task_id: F-20260629-004
  status: done
  owner: codex-lead
  reviewer: claude-lead
  origin_agent: codex-lead
  type: hardening
  risk_level: medium
  priority: P1
  feature_name: Harden electronic prescription intake POST response boundary
  background: >
    POST /api/patients/[id]/prescriptions/e-prescription accepts external
    electronic-prescription identifiers and creates PrescriptionIntake rows.
    The route already forwards drugCode into the code-first intake service, but
    it did not yet use the standard sensitive no-store/fixed-error wrapper used
    by adjacent prescription intake routes.
  user_value: >
    Electronic prescription intake responses should not be cached and unexpected
    external/intake failures should not leak prescription identifiers, patient
    context, or raw upstream details.
  acceptance_criteria:
    - Existing auth, validation, idempotency, adapter error, case selection, and code-forwarding semantics remain unchanged.
    - All POST responses pass through sensitive no-store headers.
    - Unexpected throws return a fixed INTERNAL_ERROR body and metadata-only log context.
    - Focused route tests cover sanitized no-store 500 behavior without leaking raw prescription identifiers.
  constraints:
    - Do not change electronic prescription adapter behavior or external provider configuration.
    - Do not change createPrescriptionIntake drug-code validation/profile-sync semantics.
    - No DB migration, no external API fetch in tests, no commit/push.
  verification:
    - pnpm exec vitest run src/app/api/patients/[id]/prescriptions/e-prescription/route.test.ts --reporter=dot --testTimeout=30000
    - pnpm exec eslint --max-warnings=0 src/app/api/patients/[id]/prescriptions/e-prescription/route.ts src/app/api/patients/[id]/prescriptions/e-prescription/route.test.ts
    - pnpm typecheck
    - pnpm typecheck:no-unused
  gbrain_memory_used: []
```

```yaml
- task_id: F-20260629-003
  status: done
  owner: codex-lead
  reviewer: claude-lead
  origin_agent: codex-lead
  type: bugfix
  risk_level: high
  priority: P1
  feature_name: Remove MHLW generic mapping drug-name includes write identity
  background: >
    MHLW generic-name mapping import grouped brand candidates by exception YJ
    code, DrugMaster.generic_name, and a fallback `drug_name.includes(generic_name)`.
    The includes fallback could write GenericDrugMapping.brand_drug_ids for a
    product whose display name merely contains the generic-name text.
  user_value: >
    Generic substitution mapping should be based on official MHLW code/generic
    identity, not display-name substring matching that can attach unrelated
    same-text products.
  acceptance_criteria:
    - GenericDrugMapping brand candidates are matched only by official exception YJ codes or exact DrugMaster.generic_name.
    - DrugMaster.drug_name substring matching is not used as a write identity.
    - Existing exception-code and exact generic-name mapping behavior remains intact.
    - Focused MHLW import tests cover name-only false-positive exclusion.
  constraints:
    - No DB migration or external MHLW fetch during tests.
    - Do not change MHLW price-list import semantics.
    - Preserve import log and GenericDrugMapping response shape.
  verification:
    - pnpm exec vitest run src/server/services/drug-master-import/mhlw.test.ts --reporter=dot --testTimeout=30000
    - pnpm exec eslint --max-warnings=0 src/server/services/drug-master-import/mhlw.ts src/server/services/drug-master-import/mhlw.test.ts
    - pnpm typecheck
    - pnpm typecheck:no-unused
  gbrain_memory_used: []
```

```yaml
- task_id: F-20260629-002
  status: done
  owner: codex-lead
  reviewer: claude-lead
  origin_agent: codex-lead
  type: bugfix
  risk_level: medium
  priority: P1
  feature_name: Link QR OTC MedicationProfile promotions by JAN code
  background: >
    QR supplemental record type 3 can carry OTC/general-drug JAN identity, while
    DrugMaster already has jan_code. The promotion path previously discarded the
    JAN and always created otc_qr MedicationProfile rows with drug_master_id null.
  user_value: >
    OTC medication profiles confirmed from QR data should preserve coded product
    identity when JAN matches DrugMaster, reducing name-only medication ambiguity.
  acceptance_criteria:
    - QR OTC candidate extraction preserves labeled and raw-line JAN codes without mistaking date fields for JAN.
    - OTC promotion resolves DrugMaster by JAN when available and writes drug_master_id.
    - Duplicate-current checks prefer resolved drug_master_id while preserving legacy name-only duplicate protection.
    - Existing name-only OTC promotion remains supported when no JAN/DrugMaster match is available.
  constraints:
    - No DB migration; use existing DrugMaster.jan_code and MedicationProfile.drug_master_id.
    - Do not auto-resolve by OTC drug_name.
    - Keep promotion explicit; do not change QR draft confirmation behavior.
  verification:
    - pnpm exec vitest run src/server/services/qr-otc-promotion.test.ts --reporter=dot --testTimeout=30000
    - pnpm exec eslint --max-warnings=0 src/server/services/qr-otc-promotion.ts src/server/services/qr-otc-promotion.test.ts
    - pnpm typecheck
    - pnpm typecheck:no-unused
  gbrain_memory_used: []
```

```yaml
- task_id: F-20260629-001
  status: done
  owner: codex-lead
  reviewer: claude-lead
  origin_agent: claude-lead
  type: bugfix
  risk_level: high
  priority: P1
  feature_name: Remove PMDA package-insert name-only fallback write identity
  background: >
    During the 2026-06-29 PMDA route-hardening review, Claude confirmed the route
    wrapper was clean and identified the service-level name fallback in
    src/server/services/drug-master-import/pmda.ts as a separate code-first follow-up.
    The current import can choose a DrugMaster by drug_name contains matching when a
    PMDA record lacks yj_code.
  user_value: >
    PMDA package insert and interaction metadata should attach to the intended
    coded medicine, not to a same-name or fuzzy-matched different-code product.
  acceptance_criteria:
    - PMDA package insert primary DrugMaster selection no longer writes by fuzzy name-only identity.
    - Interaction counterpart matching prefers coded YJ identity and does not create unsafe fuzzy name-only links.
    - Existing route hardening behavior, URL policy validation, and response shape remain intact.
    - Focused PMDA service and route tests cover YJ-coded matching and rejected or skipped unsafe name-only records.
  constraints:
    - Do not mix this with route wrapper hardening; treat it as a behavior-changing code-first slice.
    - Preserve true-global table handling unless the data model changes.
    - No DB migration or external PMDA fetch during tests.
  verification:
    - pnpm exec vitest run src/server/services/drug-master-import/pmda.test.ts src/app/api/drug-master-imports/pmda/route.test.ts --reporter=dot --testTimeout=30000
    - pnpm exec eslint --max-warnings=0 src/server/services/drug-master-import/pmda.ts src/server/services/drug-master-import/pmda.test.ts src/app/api/drug-master-imports/pmda/route.ts src/app/api/drug-master-imports/pmda/route.test.ts
    - pnpm typecheck
    - pnpm typecheck:no-unused
  gbrain_memory_used: []
```

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

- ~~**referral-form-unsaved-guard-and-select**（owner: claude-lead, est S）~~ **DONE/STALE（2026-06-27, claude×codex 双方独立確認で取消）**: 既に land 済み — `referrals/new/referral-form.tsx` は共有 Select(referral_type ~353 / gender ~513) + `useUnsavedChangesGuard`(import:11, hook ~159, allowNavigation で router.push/back ガード)を実装、`referral-form.test.tsx` に Select 移行 + unsaved-guard テスト有。原 evidence(行177/321 native select)は古い。prior commits fdaa13e0(shared Select+guard) / 0ecf580b(field error assoc)。再実装しない(churn 回避)。
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

- ~~**patient-home-operations-href-hardening**（owner: codex, est S）~~ **DONE `75aa7972`**: `src/server/services/patient-home-operations.ts` は patient path href で既存 `buildPatientHref` を維持しつつ、billing/conference の query href を `buildPatientBillingCandidatesHref` / `buildPatientConferencesHref` に集約。query values は `URLSearchParams` として分離し、既存 query 順序（billing: `patient_id`→`billing_month`, conference: `patient_id`→`case_id`→`focus`→`context`）、DB where identity、response shape、UI/API/schema/data を維持。focused home-operations Vitest `1` file / `25` tests、verifier rerun、scoped ESLint/Prettier/diff-check、full `tsc`、`typecheck:no-unused` green。
- **patient-detail-documents-href-hardening**（owner: codex, est S）: `src/server/services/patient-detail-documents.ts` の document-related patient hrefs を path-segment encoded route builder へ寄せる。scope: documents service action hrefs only; document URL/presigned URL は非対象。evidence: F-003 read-only Discover で raw `/patients/${...}` pattern 7件。
- ~~**patient-detail-timeline-events-href-hardening**（owner: codex, est M）~~ **DONE `bf036b5c`**: `src/server/services/patient-detail-timeline-events.ts` / `patient-detail-timeline-registry.ts` の billing/conference timeline href を `buildPatientBillingCandidatesHref` / `buildPatientConferencesHref` へ集約。patient path segment は既存 `buildPatientHref`、query values は `URLSearchParams` として分離し、`billing_month`→`patient_id` の既存 query 順序・timeline semantics・response shape を維持。DB/schema/data/UI 変更なし。focused timeline Vitest `2` files / `71` tests、verifier rerun `2` files / `106` tests、scoped ESLint/Prettier/diff-check、full `tsc`、`typecheck:no-unused` green。
- **daily-preparation-patient-href-hardening**（owner: codex, est S）: `src/server/jobs/daily/preparation.ts` の generated patient href を shared route helper へ寄せる。scope: daily preparation job output link only; job query/data selection 不変。evidence: F-003 read-only Discover で raw `/patients/${...}` pattern 1件。

### F-001 review follow-ups（2026-06-23、codex の referral-form patch review が surfacing）

F-20260623-001（referral-form select 移行＋unsaved-guard）のレビューで codex が指摘した、この UI スライス範囲外の項目。いずれも別 PLAN_REVIEW + LOCK 必須、未着手。

- **referral-intake-persist-type-and-checklist**（owner: codex = API/domain, reviewer: claude, **P1 data-capture gap**）: 新規紹介フォームは `referral_type` と書類チェックリストを収集・dirty 追跡するが、`/api/cases` の `createCaseSchema` は `patient_id/referral_source/referral_date/notes` のみ受理し**これらを永続化しない**。収集データが保存されないギャップ。要 schema/API 拡張＋PLAN（DB/契約変更のため hard-stop 近接の判断要）。evidence: codex confirmed createCaseSchema fields。
- **referral-create-transactional-or-safe-retry**（owner: codex = API/domain, reviewer: claude, **P1 data-integrity / 高リスク**）: 紹介作成は patient POST 成功後に case POST する2段階。case POST 失敗後のリトライで**重複/孤児 patient** が発生しうる。要 transactional referral-create endpoint もしくは安全な reuse/retry 戦略＋PLAN。pre-existing だが在宅紹介 intake で高リスク。evidence: codex review (2段階 POST フロー)。
- ~~**referral-form-error-summary-focus-target**（owner: claude = UI/a11y, est S）~~ **INVALID/STALE（2026-06-27, claude×codex 双方確認で取消）**: 疑いは誤り — `src/components/ui/form-error-summary.tsx` は id+`tabIndex={-1}` を **outer focusable wrapper div**（内側 Alert ではない）に付与し、`referral-form.tsx` の `scrollToErrorSummary` は `getElementById(errorSummaryId)?.focus()` で正しく当該 wrapper にフォーカスする。focus 管理は既に WCAG 準拠。実装不要。

### ROUND-ORG-HEADERS-2 admin convergence sweep（2026-06-24, claude×codex 並列 dual-maker）

手法: `buildOrgHeaders`/`buildOrgJsonHeaders`（x-org-id 統一）+ `encodePathSegment`（動的 path segment、dot fail-closed）への収束。test teeth bar=sentinel-mocked org-headers + real encodePathSegment + GET/POST/PATCH-hostile/PATCH-dot/DELETE-hostile/DELETE-dot。共有ワークツリー並列の build は **source-stable 確認 → combined build**、コミットは **`git commit -- <自パス>` の partial commit**（相手の uncommitted 変更を温存）。

**LANDED（本ラウンド、全 maker/checker'd・gate GREEN）:**

- F-20260624-009 admin/packaging-methods `b4bcff8d`（claude / codex）
- F-20260624-011 admin/alert-rules page.tsx `ac7c1ba2`（claude / codex; rev2 で PATCH/testMutation teeth 補強）
- F-20260624-013 admin/alert-rules signal-tuning-panel `745268e5`（claude / codex; NEW test file）→ **admin/alert-rules dir 完全収束**
- F-20260624-015 admin/service-areas `3148efd3`（claude / codex; multi-callsite + dot fail-closed）
- F-20260624-016 admin/institutions `359c38bc`（codex / claude; GET=query-param so no encode）
- F-20260624-017 admin/business-holidays（codex maker, in-flight）

**残バックログ（recon 2026-06-24、未着手・将来 Discover; いずれも要 LOCK + maker/checker）:**

Pattern A+B（path segment + header、coherent スライス優先）:

- [ ] **admin/drug-masters/drug-master-content.tsx**（6 path + 21 header, ~1900行）— **BIG: card-workspace 同様に sub-slice 分割必須**、単一スライス禁止
- [ ] admin/shifts/shifts-content.tsx（5 path + 6 header; business-holidays と関連）
- [ ] admin/pca-pumps/pca-pumps-content.tsx
- [ ] admin/notification-settings/notification-settings-content.tsx（/api/admin/escalation-rules/${id}）
- [ ] admin/pharmacy-cooperation/pharmacy-cooperation-setup-content.tsx
- [ ] admin/pharmacy-sites/pharmacy-sites-content.tsx（**multi-segment**: /api/pharmacy-sites/${siteId}/insurance-configs/${configId} — 各 segment encode）
- [ ] admin/users/users-content.tsx
- [ ] admin/document-templates/{document-delivery-rule-manager,template-content}.tsx
- [ ] admin/incidents/incidents-content.tsx
- [ ] admin/pharmacist-credentials/pharmacist-credentials-content.tsx

Pattern B only（header swap のみ、小・低価値だが安全）:

- [ ] capacity, contact-profiles, inventory-forecast, jobs, metrics, realtime, performance, admin/settings, dispense-audit-stats, audit-logs
- [ ] facility-standards, operations-insights, staff-kpi-panel（**no co-located test** → 新規 test file 要）

知見（本ラウンド）: (1) GET の dynamic 部が URLSearchParams query なら encodePathSegment 不要（path segment のみ encode）。(2) jest-dom matcher（toBeEnabled/toHaveTextContent）は未登録 → plain DOM assertion 規約（`.disabled`/`.textContent.toContain`）。(3) zsh は `${PIPESTATUS[0]}` が空 → gate exit は直接 `$?`。(4) 並列 build は原タスク実行中の重複起動で Next.js ロック衝突（"wait for the build to complete"）→ 単一実行厳守。

### backend hardening follow-ups（2026-06-26, claude checker audit of d1c8b52b..c184c6ee 由来、いずれも non-blocking）

監査で land 済み6コミットは全 PASS（差戻し理由なし）。以下は本セットの**回帰ではない**既存ギャップ/防御的補強。要 LOCK + maker/checker（implementation-only モード時は disjoint LOCK のみ）。

- [x] **harden-day-board-explicit-500**（owner: Codex, **Low/defensive**, est S）: done `52eda9a4`。`GET /api/visit-schedules/day-board` は既に明示 try/catch と 500 no-store 専用テストを持っていたため、残差として catch 先頭に `unstable_rethrow(err)` を追加し、Next.js control-flow error を飲まずに既存の sanitized no-store 500 fallback へ戻る標準形へ揃えた。focused day-board + protected GET matrix `2` files / `380` tests、scoped ESLint/Prettier/diff-check、full `tsc`、`typecheck:no-unused` green。evidence: claude audit, `src/app/api/visit-schedules/day-board/route.ts`, `src/app/api/visit-schedules/day-board/route.test.ts`。
- [x] **harden-rls-session-unification-list-reads**（owner: Codex, **Info/consistency**, est M）: done `ed71df9c`。`GET /api/management-plans` の list read と `GET /api/staff-workload` の membership/task/raw SQL/visit/dispense list reads を `withOrgContext(ctx.orgId, ..., { requestContext: ctx })` に統一し、既存 app 層 `org_id` フィルタ、assignment scope、case_id/date validation、raw SQL parameterization、response shape を維持した。exported `GET` catch は `unstable_rethrow(err)` + fixed no-store `INTERNAL_ERROR` fallback へ揃えた。DB/schema/data/migration/UI 変更なし。focused route+protected matrix `3` files / `387` tests、DB steward rerun `2` files / `21` tests、scoped ESLint/Prettier/diff-check、full `tsc`、`typecheck:no-unused` green。Privacy reviewer の non-blocking P3 として `management-plans` list が full `content` を返す点を確認したが、現 FE edit/preview が `content` を使用しているため response-shape 変更は別 slice とした。evidence: claude audit, DB steward/privacy reviews。
- [x] **external-viewer-false-empty-on-fetch-error**（owner: Claude FE, reviewer: Codex, est M, **correctness/medical-safety**）: done（Codex APPROVED 2026-06-28T22:39Z、no-commit posture により実 commit はユーザー明示要求まで保留）。`src/app/(dashboard)/external/external-viewer-content.tsx` の 3 react-query（grants/selfReports/activities）が取得失敗（isError）を空状態に潰し、fetch 失敗時に「有効な共有リンクはありません」等の **false-empty** と上部サマリーの誤った「0」を表示していた correctness バグを修正。`PanelBody` ヘルパーに集約し優先順 loading→`Skeleton` shell / error→`ErrorState`(variant=server, size=inline, live=polite, action=再試行→query.refetch()) / empty→空文言 / data、3パネルは独立クエリゆえ独立エラー処理（1失敗でも他2つは通常表示）。`SummaryCard` を error-aware 化（誤った 0 でなく「—」+「取得に失敗しました」、正当な空は引き続き 0）。付随: ローディング text→Skeleton 化(guideline L460)、内側カード rounded-xl→rounded-lg(commit 42f738a2 の radius 正規化に追随)。focused Vitest 6/6（既存4＋新規2: 共有クエリ失敗時の ErrorState+再試行+refetch+サマリー「—」、単一クエリ失敗時の独立性）、scoped ESLint/Prettier/diff-check、full `tsc`/`typecheck:no-unused` green。Codex も独立に vitest 6/6・eslint・diff-check 再実行で APPROVED。evidence: recon(design-analyst high-confidence)、既存 fail-close 先例 clerk-support/statistics/admin F-004。
- [x] **consent-records-false-empty-on-fetch-error**（owner: Claude FE, reviewer: Codex, est S, **correctness/医療コンプライアンス**）: done（Codex APPROVED 2026-06-28T22:57Z、no-commit posture により実 commit 保留）。`src/app/(dashboard)/patients/[id]/consent/consent-records-content.tsx` の useQuery が isError を destructure せず、取得失敗時 `data?.data ?? []` で空配列 → DataTable が emptyMessage を表示し **取得失敗が「同意記録ゼロ件」に化ける** false-empty。consent は要配慮データで害大。修正は最小（useQuery に isError/refetch 追加 → DataTable に `errorMessage={isError ? '同意記録を取得できませんでした' : undefined}` + `onRetry={() => void refetch()}` を配線、DataTable 既存の role=alert error 表示機構を使うだけ）。既存 T1 caller(admin/institutions, admin/pca-pumps)と同一 fail-close パターン。focused Vitest 7/7（既存6＋新規1: 500時にエラー文言+「再読み込み」提示・空テーブルに化けない）、scoped ESLint/Prettier/diff-check、full `tsc`/`typecheck:no-unused` green。evidence: recon(design-analyst high)、FEATURE_QUEUE:504「consent は isLoading 済=isError 未対応 open」。
- [x] **external-share-overview-false-empty-on-fetch-error**（owner: Claude FE, reviewer: Codex, est S/M, **correctness/監査文脈**）: done（Codex APPROVED 2026-06-28T23:02Z、no-commit posture により実 commit 保留）。`src/app/(dashboard)/patients/[id]/share/external-share-content.tsx` の overviewQuery(ページ主データ源)が isLoading のみガードし isError 分岐欠如 → 取得失敗後も 3カラム UI 全体を描画、中央プレビュー全空・右「共有済みリンクはまだありません。」等で **通信/権限エラーが「共有実績ゼロ」に化ける** false-empty。external_shares は外部共有アクセス痕跡=監査文脈で誤判断の害大。修正は loading ガード直後に `overviewQuery.isError` ガードを追加し ErrorState(variant=server, detail=error.message, action=再試行→refetch, live=polite)を border カードで返す。同画面群 collaboration-content.tsx の overviewQuery+ErrorState と完全同型。focused Vitest 4/4（既存3＋新規1: 失敗時にエラー+再試行提示・「共有設定」見出し非表示=false-empty に化けない・refetch 呼出）、scoped ESLint/Prettier/diff-check、full `tsc`/`typecheck:no-unused` green。副次クエリ(careTeam/contacts/requests)の error degrade は別 slice 余地として残す。evidence: recon(design-analyst high)。
- [x] **minimize-management-plans-list-payload**（owner: Codex backend/privacy, reviewer: Claude, **P3/privacy**, est S/M）: done（Claude APPROVED 2026-06-29 09:46 JST、no-commit posture により実 commit はユーザー明示要求まで保留）。`GET /api/management-plans` list は `content` / `summary` / creator/reviewer/approver IDs / `source_plan_id` を返さない metadata-only `select` + allowlist mapper へ縮小済み。現 canonical の `card-workspace.tsx` は管理計画 list を共有ケース作成のドロップダウン用に `plan.id` / `plan.version` / `status` 等のメタデータのみ消費し、`management-plan/print/page.tsx` は detail エンドポイント `/api/management-plans/{id}` から full `content` を取得するため FE 契約変更なし。focused management-plans route tests `1` file / `15` tests、combined route/detail/card-workspace/print validation `4` files / `103` tests、protected GET targeted matrix `6` tests / `363` skipped、scoped ESLint/Prettier/diff-check、`pnpm typecheck`、`pnpm typecheck:no-unused` green。evidence: `CODEX_GOAL_PROGRESS.md` 2026-06-29 09:43 JST, `.codex/ralph-state.md` 20260629-0943 JST, Claude approval 2026-06-29 09:46 JST。

### FE false-empty 追加発見（2026-06-29, Explore スキャン由来）

高頻度表示画面の react-query で「isError 未処理 → fetch 失敗が空状態/0 に化ける fail-open」を再スキャン。確証ある実バグのみ採用（card-workspace partnershipsQuery は L1262 に既存 ErrorState 分岐ありで**誤検出→除外**、patient-labs/patients-board/dashboard-cockpit/my-day 等は対処済み）。

- [x] **medications-content-false-empty-on-fetch-error**（owner: Claude FE, reviewer: Codex, est M, **correctness/医療安全**）: done（Codex APPROVED rev3 2026-06-29 03:59Z、no-commit posture により実 commit はユーザー明示要求まで保留）。`src/app/(dashboard)/patients/[id]/medications/medications-content.tsx` で fetch 失敗（queryFn の throw→isError）が「正常な空/0」へ化ける fail-open を修正。**rev1**: 3 クエリ（issuesQuery=薬学的課題 / inquiryQuery=疑義照会 / residualQuery=残薬提案）の直接リストに isLoading→isError→empty→list 順で ErrorState(variant=server, size=inline)+再読み込み(refetch) を挿入。**rev2**（Codex High catch）: 主データ query **medication-profiles**（現在服薬リスト=最重要）も同じ false-empty だったため isError/refetch を destructure し同パターン適用。**rev3**（Codex High catch）: 同一失敗源の**別 consumer** — カウントバッジ（未解決課題/回答待ち照会/副作用歴）の false-zero を owning query isError 時「—」表示へ、副作用履歴セクション（sideEffectHistory=medication-issues 由来）に ErrorState+retry を追加。patientSummaryQuery は識別フィールドの fallback 専用で false-empty バグクラス外と確認（対象外で正しい）。focused Vitest 20/20（既存14＋error 4: profiles/issues/inquiry/residual＋rev3 2: バッジ false-zero/副作用 false-empty 非表示・refetch 呼出）、scoped ESLint/Prettier/diff-check、full `tsc`/`typecheck:no-unused` green。**学び**: 直接リストだけ見て派生 consumer（バッジ/別セクション）を見落とす盲点 → 同一クエリを読む全 render consumer を grep 確認すべし。evidence: Explore false-empty スキャン、既存先例 external-viewer/consent/external-share、Codex 2連続 CHANGES_REQUESTED の teeth。
- [x] **handoff-recent-comments-false-empty-on-fetch-error**（owner: Claude FE, reviewer: Codex, est S, **correctness/連携記録**）: done（Codex APPROVED 2026-06-29 04:12Z、no-commit posture により実 commit はユーザー明示要求まで保留）。`src/app/(dashboard)/handoff/handoff-workspace.tsx` の `HandoffCommentFeed`（L522 インライン定義）が `!isLoading && comments.length === 0` で section ごと null 返し → commentsQuery（/api/comments/recent、fetchRecentComments は !res.ok で throw）失敗時も `data ?? []` 空配列で「やり取り」section が無言消失（薬剤師⇔事務の連携記録 [[careviax-handoff-comms-hub]] が「あなた宛コメント無し」と区別不能に化ける）MEDIUM false-empty。修正: props に `isError`/`onRetry` 追加、null 早期 return を `!isLoading && !isError && comments.length === 0` に（正当な空のみ隠す）、isLoading→isError→list 順で error 時 ErrorState(server,inline)+再読み込み(refetch)。call site 配線。learned lesson 適用で commentsQuery 消費を grep 確認＝単一 consumer（二次 false-zero 無し）。**test harness 知見**: 実 QueryClient+fetch スタブで従来 /api/comments/recent 未ハンドル=throw→isError で**バグが既存テスト中ずっと黙って発火**していた（feed を誰も assert せず露見せず）。stubFetch に `/api/comments/recent` ハンドラ（option recentCommentsStatus 既定200 / recentComments 既定[]）を追加し既存テストを正当空=hidden に保持＋500 注入の新テスト。focused Vitest 18/18（既存16＋2: error 時 section 可視・再読み込み・refetch teeth／success 非空で error affordance 非表示）、scoped ESLint/Prettier/diff-check、full `tsc`/`typecheck:no-unused` green。evidence: Explore false-empty スキャン（独立検証で実在確認、card-workspace 誤検出は除外済み）。

**backlog（2026-06-29 Explore 第2弾スキャン、未着手・要個別検証）:** 高頻度ワークフロー画面で Explore が 8 件の false-empty 候補を報告。Explore は過剰報告するため**着手前に必ず実コードで独立検証**（前回 card-workspace は誤検出で除外済み）。各画面は二次 consumer（バッジ/カウント/別セクション/dropdown）も含め remediation に nuance あり。優先順（Explore 評価＋一部 Claude 検証）:

- [x] **visit-record-detail-care-reports-billing-false-empty**（CRITICAL, Claude maker / Codex reviewer）: done（Codex APPROVED rev2 2026-06-29 05:07Z、commit `7c889f15`）。careReports/billingCandidates/residuals の3クエリが fetch 失敗を「報告書/請求候補/残薬ゼロ」に化けさせる false-empty。**rev1 で警告バナーのみ→Codex CHANGES_REQUESTED「警告はアクション抑制と対でないと危険」**（careReports error 時も report 生成メニューが actionable=重複生成余地、billing 0 前提で generate）。**rev2**: pure `buildPostVisitWorkflowActions` に `reportsError`/`billingCandidatesError` 入力を足し、error 時は report/billing アクションを generate 系でなく安全な非破壊 affordance(edit_visit_record / open_billing_candidates)へ切替。component で `handleGenerateReport` 早期 return＋`showAutomaticReportGeneration = !careReportsError && ...` guard。residuals queryFn を throw 化＋統合警告バナー+3refetch。teeth: pure 14(+2 error 抑制)、新規 component test harness 3(banner/refetch/residuals単独)。**教訓: workflow-action 文脈の false-empty は警告だけでなく派生アクションの抑制が必須**（[[careviax-fe-false-empty-fail-close]] に追記）。非ブロッキング follow-up: residuals error 時 readiness 残薬項目 done=false（許容）。
- [x] **prescription-intake-secondary-lookups-false-empty**（CRITICAL, Claude maker / Codex reviewer）: done（Codex APPROVED 2026-06-29 05:22Z、commit `1ed993ce`）。`prescription-intake-form.tsx` の二次 lookup 3クエリが fetch 失敗を「該当なし/ケースなし/過去処方なし」に化けさせる false-empty。**独立検証で確証3件採用・2件除外**: casesData(HIGH, ケースselector全消失→submit検証はケース要求のトラップ)/patientsData(MEDIUM, 検索失敗が no-match と区別不能)/previousPrescriptionsData(MEDIUM-LOW, 引用導線消失→過去処方なしに化け) に `isError`/`refetch` を配線し inline ErrorState+再読み込み。除外: prescriberInstitutions(手入力 free-text fallback あり graceful)/selectedPatientData(識別 enrichment 専用 prop fallback で benign)。teeth: 新規 component test harness 4（props 無し→searchParams seed、useDebouncedValue identity mock、heavy child stub）。gate: vitest 4/4・eslint・prettier・diff-check・typecheck exit0・typecheck:no-unused exit0。Codex 非ブロッキング指摘#2(patient-search refetch assertion)は commit 前反映。
- [x] **shifts-admin-sites-holidays-templates-false-empty**（HIGH, Claude maker / Codex reviewer）: done（Codex APPROVED 2026-06-29 05:36Z、commit `bcbb3ec3`）。`admin/shifts/shifts-content.tsx` の sitesData/holidaysData/templatesData が isError 未配線→補助マスター取得失敗が空 dropdown・休日マーカー欠落に化ける（既存 ErrorState L934 は pharmacists/shifts のみ判定）。**統合警告バナー**（visit-record 同型、ページ最上部、失敗データ名列挙＋失敗分のみ refetch、sites は「店舗未登録ではなく取得エラー」明示）。**honest scoping**: site_id 空での silent fail-open 保存は既に塞がれている（シフト保存 L442-445 throw／template 保存 L1527-1529 disable）ことをコードで確認し submit 抑制は不要と判断、Codex も明示承認。teeth: 既存 test harness を error 注入可能に refactor（既存5不変）＋3追加、vitest 8/8。gate 全 green。
- [x] **drug-masters-admin-status-logs-false-empty**（HIGH/監査, Claude maker / Codex reviewer）: done（Codex APPROVED rev2 2026-06-29 05:59Z、commit `c03cae2b`）。sitesData/masterStatusData/importLogsData の isError 未配線→fetch 失敗が「拠点未登録/ステータス未取得/取込履歴なし」に化ける。importLogs(監査) は empty 分岐＋FilterSummaryBar「表示: 0件」の二重 false-zero、masterStatus は section 消失、sites は dropdown 空。ErrorState 配線＋importLogs 失敗時は「表示: 取得失敗」。**rev1 で FilterSummaryBar の false-zero を Codex CHANGES_REQUESTED（全 render consumer 網羅の盲点再発）→rev2 で修正**。sites は全 mutation が site_id 空で throw 済＝warning-only（Codex 承認）。teeth: 既存 harness を error 注入可能に refactor（既存61不変）＋3、vitest 64/64。gate 全 green。
- [ ] **visit-record-residuals-false-empty**（HIGH, candidate #1 に内包）: 上記 visit-record-detail の残薬 query。care-reports/billing と同一ファイルゆえ 1 スライスで対応推奨。
- [x] **schedules-calendar/proposals-preview-map-false-empty**（MEDIUM, Claude maker / Codex reviewer）: done（Codex APPROVED 2026-06-29 06:20Z、commit `135cf1f6`）。calendar-view/proposals の billing-preview-batch query（同一API）が isError 未配線→失敗時に請求サイクル警告（hasCadenceWarning / proposalWarningMessages）が無言で「警告なし」に化ける false-negative。preview は補助情報なので warning-only（グリッド/リスト直上に ErrorState 通知+retry、主データと core action は非抑制）。teeth: calendar=実QueryClient＋global.fetch を preview のみ !ok にする async、proposals=useQueryMock で preview queryKey に isError 注入。vitest 6/6・33/33。
- [x] **qr-drafts-edit-cases-false-empty**（MEDIUM, Codex maker / Claude reviewer）: done（Claude APPROVED 2026-06-29 06:2xZ、Codex commit 予定）。`prescriptions/qr-drafts/[id]/page.tsx` casesData の isError 未配線→/api/cases 失敗が「アクティブケース無し」に化ける（確定フロー）。**fail-closed**（補助 preview と違い患者/処方確定フローなので warning-only でなく effectiveCaseId で confirm/deep-link を全 gate）＋stale case の membership check＋URLSearchParams で patient_id/case_id injection 対策。teeth: false-empty/stale-case(case_2 消失で確定 disabled＋deep-link から除去)/hostile-id(case_id 注入阻止を実証) 3本。Claude 独立検証 7/7。

着手方針（合意済）: CRITICAL 2件（visit-record-detail / prescription-intake）を優先し maker/checker で順次。各着手前に実コード独立検証で誤検出除外。

**進捗（2026-06-29 campaign = 全完了）**: CRITICAL#1 visit-record-detail=7c889f15 / CRITICAL#2 prescription-intake=1ed993ce / HIGH shifts-content=bcbb3ec3 / HIGH drug-master-content=c03cae2b(rev2) / MEDIUM schedules-preview-map=135cf1f6 / MEDIUM qr-drafts(Codex maker, Claude APPROVED)。+ Codex inventory-forecast F-006=2503917a(Claude APPROVED)。Explore 第2弾 8候補すべて maker/checker 相互レビューで処理済み。

### false-empty 第3ラウンド（2026-06-29 Explore 第3弾、Claude 独立検証 triage 済）

Explore が6候補報告→検証で整理。FE なので Claude 順次担当（Codex は backend/data-integrity 並行）。

- [ ] **residual-medication-chart-false-empty**（HIGH 患者残薬, Claude 着手中→PATCH 済）: `src/components/features/patients/residual-medication-chart.tsx` の `useQuery` が isError 無し→fetch 失敗が「残薬データがありません」に化ける。medications-content の**子コンポで独立クエリ**（前回の親修正とは別物）。isError→ErrorState+retry、test +1。Codex review 待ち。
- [ ] **data-explorer-false-empty**（MEDIUM-HIGH 監査, 確証）: `admin/data-explorer/data-explorer-content.tsx` modelsQuery(L120)/rowsQuery(L150) が isError 無し→DB アクセス失敗が「モデル/レコードなし」に化ける。監査・検証ツールの目的を損なう。
- [ ] **drug-suggest-false-empty**（MEDIUM, 要追加検証）: `components/features/pharmacy/drug-suggest.tsx` suggestions が isError 無し→マスター検索失敗が「提案0件」に化ける。
- [ ] **patient-care-team-panel-false-empty**（MEDIUM, 要追加検証）: `patients/[id]/patient-care-team-panel.tsx` 他職種マスター query が isError 無し→失敗が選択肢空に化ける。
- [ ] **business-holidays-false-empty**（MEDIUM, 要追加検証）: `admin/business-holidays/business-holidays-content.tsx` holidays/sites が isError 無し→失敗が「休日/店舗なし」に化ける（shifts と同型）。
- 除外: `visits/[id]/capture/capture-content.tsx`（Explore CRITICAL 主張だが既に「患者情報を取得できませんでした」分岐あり＝真の false-empty でない。retry 無しの軽微改善のみ）。

### inventory-forecast 患者別 run-out/緊急度（2026-06-27, /admin/inventory-forecast P2 #2 の honest follow-up）

- [x] **inventory-forecast-patient-runout-urgency**（owner: Codex backend `ed4a11f4` + Claude FE `c8131d97`, est M, backend+analytics+FE）: done end-to-end。backend/API は `ed4a11f4` で `patientId`、`shortageDrugKeys`、`runOutDateKey`、`runOutBasis`、`urgency`、`shortageDetails[]`、施設バッチ coverage fields（`facilityPatientCount` / `shortagePatientCount` / `dataBackedPatientCount` / detail `affectedPatientCount`）を供給済み。run-out は `PrescriptionLine.end_date` 優先、欠損時は `start_date + days - 1`、`start_date` 欠損時は `unknown` とし、処方日からは捏造しない。FE は `c8131d97` で真の run-out/緊急度(StateBadge/6軸 token、normal はバッジなし、unknown は readonly)、basis honesty（推定/算出不可明記）、施設 coverage「N名中 M名に不足見込み」、不足薬リストを描画。Codex review APPROVED。backend focused Vitest/tsc/no-unused green、FE focused Vitest `1` file / `4` tests + scoped ESLint/Prettier + current-tree `tsc`/no-unused green。evidence: claude consult＋Codex CONSULT_REPLY(2026-06-27)、medical safety review High fix、`src/lib/analytics/inventory-forecast.ts`、`src/app/api/admin/inventory-forecast/route.ts`、`src/app/(dashboard)/admin/inventory-forecast/inventory-forecast-content.tsx`。
- [x] **inventory-forecast-code-first-drug-identity（F-20260629-006）**（owner: Codex backend/analytics/FE, reviewer: Claude, est M, **medical-safety/code-first**）: done `51edfa10`（Claude APPROVED 2026-06-29 04:34Z、reviewer-audit subagent クロスチェック・vitest 3 files/38 独立再実行 green、Codex が path-scoped commit）。自動予測マッチングが drug 基底名 join をやめ DrugMaster.id 優先→canonical code identity（`master:<id>`>`code:<yj>`）。route が処方 line drug_code を yj/receipt/hot で解決し receipt/HOT は yj_code+id に canonicalize。missing_code/code_not_found/receipt-HOT ambiguous は自動不足行から除外し `unresolvedDrugs` として UI confirm-state panel「コード未解決の処方需要」(reason/code, requiredQty, affectedPatientCount, 要確認)で surface（anti-false-empty=needed demand を silent drop しない）。**意図的 code-first tightening**（同名・別コード薬剤を分離）で preservation でなく正しく framing 済み。ambiguity は auto-pick せず unresolved 化（F-005 precedence より安全側）。DrugMaster un-org-scoped findMany は真 global ゆえ正（≠ DrugAlertRule hybrid [[careviax-drugalertrule-hybrid-rls-failsafe]]）。response 純加算で後方互換、前スライス urgency/runOut/coverage 不変。
- [x] **inventory-forecast-resolved-but-unstocked-demand-surface**（owner: Codex backend/analytics/FE, reviewer: Claude, est S/M, **correctness/follow-up**, F-006 監査由来 LOW pre-existing）: done `2503917a`。`src/lib/analytics/inventory-forecast.ts` の `drugs` builder から `stockByDrug.has(key)` 要件を外し、resolved コードで来週需要ありだが採用在庫レコードが無い薬剤も `DrugForecastRow` として残す。行/API/患者明細には required `stockRegistered` と `stockEvidence` を追加し、`stockEvidence: 'missing_adopted_stock_record'` は確認済み在庫不足ではなく「採用在庫台帳未登録」として surface。`summarizeInventoryForecast` は `stockRegistrationReviewCount` を `orderRequiredCount` / `orderCandidateCount` から分離し、登録済み在庫の発注不足と未登録在庫確認を混同しない。UI はテーブルに `未登録` / `未確認` / `登録確認`、患者カードに `在庫登録未確認` を出し、未登録薬を `不足薬` と表示しない。medical_safety_reviewer APPROVED、Claude APPROVED。validation: focused Vitest `3` files / `41` tests、scoped ESLint、scoped Prettier check、focused diff-check、`pnpm typecheck`、`pnpm typecheck:no-unused` green。

### RUN-20260627-OPDAY 稼働日カレンダー基盤（休日管理派生機能の土台、PLAN=docs/operating-day-calendar-plan.md rev3）

PLAN は Claude 起案 → Codex REQUEST_CHANGES(HIGH×3/MED×4/LOW×1) → rev2 反映 → **Codex APPROVED_WITH_NON_BLOCKING_NOTES**（rev3 b574e978 が SSOT）。
不変条件: 各スライス小・自レーン LOCK・maker/checker・objective gate・相互レビュー。**S2 migration は human-gate（hard-stop）**。R\* は behavior-preserving（特性テスト先行）。

| slice | owner        | reviewer | 内容                                                                                                                                       | hard-stop        | 状態                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1    | claude       | codex    | 営業日計算 pure util `src/lib/calendar/operating-day.ts`（resolver+§1.1 precedence / nearest/add / legacy adapter）+ tests                 | なし             | **done** 08be0979（codex APPROVED; vitest 32 + 全 gate green。c66daca3 + review fix: dateKey fail-closed / strict HH:mm）                                                                                                                                                                                                                                      |
| R1    | codex        | claude   | planner の休業日判定を S1 util へ単一化（§12.1、`buildOperatingCalendarLegacy` で behavior-preserving、特性テスト先行）。generate は S6 へ | なし（S1 後）    | **done** 9d960e7d（claude APPROVED; planner 14 passed=既存緑+特性テスト2、全 gate green。挙動保存確認・date-key local→UTC は JST 同値の改善）                                                                                                                                                                                                                  |
| S2    | codex        | claude   | `PharmacyOperatingHours` モデル + `BusinessHoliday` partial unique（§2.4）+ 既存 duplicate 解消 + migration + seed                         | migration 承認済 | **done** f2353f7c（claude APPROVED; 非破壊 ADD only / partial unique 2本 NULL分離 / dup は fail-closed 検査=削除なし / composite FK テナント越境防止 / RLS+FORCE+audit。prisma validate+generate+verify test 12+typecheck/no-unused/eslint=0。Codex がローカル dev DB へ db execute 適用 exit0+カタログ検証・重複0/0。**本番 RDS は prod_deploy ゲート維持**） |
| S3    | codex        | claude   | `/api/pharmacy-operating-hours` GET/PUT + resolved read model（§4.4 org-wide OR）+ @db.Time↔HH:mm adapter + no-store + tests               | なし（S2 後）    | **done** 055fa57e（claude APPROVED; §4.4 OR 取り込み確認 / UTC time adapter TZ安全 / GET/PUT no-store+canAdmin / PUT は withOrgContext+7行upsert+監査 / validation⇔DB CHECK 二重防御。vitest 3 files/357 + 全 gate green）                                                                                                                                     |
| S4    | claude       | codex    | 稼働日設定 UI（§13.1 月グリッド + 週次営業時間エディタ）。business-holidays 完全統合(§13.2)/プリセット/R3 は後続へ分離                     | なし（S3 後）    | **done** b64129bc + d49f299b（codex APPROVED; vitest 6+presets / 全 gate green。review fix: both-or-neither 契約整合・PUT 空→null・preset test 更新）。ナビ=案B shortcut 暫定、master-hub カード(案A)は codex 後続                                                                                                                                             |
| S5    | codex+claude | 両       | 祝日取込 API（@holiday-jp/holiday_jp v2.5.1、§14.1 依存ゲート）+ 連休プリセット + UI（確認/undo）                                          | 依存追加レビュー | queued                                                                                                                                                                                                                                                                                                                                                         |
| R3    | claude       | codex    | 休業日/シフト/営業時間/稼働日ビューの共通カレンダー部品化（§12.3、挙動不変で載せ替え）                                                     | なし             | queued（S4 の前提、新ビュー前に共通部品）                                                                                                                                                                                                                                                                                                                      |
| S6    | codex        | claude   | generate 休業日チェック + override（planner と整合、R1 後）                                                                                | なし（R1 後）    | queued                                                                                                                                                                                                                                                                                                                                                         |
| R2    | claude+codex | 両       | 日付/営業日 util 集約・責務純化（§12.2、挙動不変）                                                                                         | なし             | queued                                                                                                                                                                                                                                                                                                                                                         |
| R4    | codex        | claude   | 4 モデル責務境界明文化 + `canVisitOn`（薬局稼働∧シフト内）結合関数（§12.4）                                                                | なし             | queued                                                                                                                                                                                                                                                                                                                                                         |
| S7+   | —            | —        | 服薬終了日スライド（§5.2 規制薬 carve-out）/ inventory / オンコール / 算定 → 後続 PLAN へ分割                                              | 個別             | deferred（後続 PLAN）                                                                                                                                                                                                                                                                                                                                          |

実装順（Codex 推奨・合意）: **S1 → R1 → S2(migration 承認) → S3 → S5 → S6**、UI 系（S4/R3）は S3 後、R2/R4 は随時。
残未決（PLAN §11）: Q1 短縮/臨時営業を初版に含めるか / Q2 未設定拠点フォールバック（S1/R1 は §1 既定 open 厳守）/ Q3 祝日データ運用 / Q5 UI 統合（§13.2 推奨）/ Q6 責務分離（R4 で確定）/ Q9 カレンダー編集スコープ / Q10 スライド UI（Drawer 推奨）。

### RUN-20260702-FEBRUSH 進捗（D4 ダッシュボード、2026-07-02 12:31Z 時点）

計画=docs/frontend-brushup-plan.md（Codex APPROVE_WITH_NOTES 済・notes 反映済）。SSOT v2=565615d4+27c7c1f5（APPROVE）。

| track | 状態                                                                                                                                                                                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | A2 reduced-motion ✅ed99e744 / A5 SafetyTagBadge ✅1f9de4d9 / A8 ErrorState契約 ✅7377aa53（全てCodex APPROVE）。A3/A7=部品既存→C waveへ。A1 ESLintガード=Codex queued / A4 Expiry移行・A6 LoadingRegion昇格=Codex queued                                       |
| B     | B6 order-\* ✅da777ade / B9 tabular-nums ✅36051828（APPROVE）。B2 StatCard=Codex進行中(5/13: reports/external/capacity/billing/operations-insights済、+schedule-metric-card/signal-tile追加)。B1/B3/B5/B7=Codex queued。B4/B8 大型=未着手。B10=FEUX-5含みCodex |
| C     | 未着手（C1患者ホットパス→…→C-WB調剤ワークベンチ[解禁済]）。login order-\*はC4承認待ち                                                                                                                                                                           |
| D     | D4=本表。D1/D2 スクショ/axe=Codex queued                                                                                                                                                                                                                        |
| E     | E1 ✅台帳56c181ca / E3-2 facilities ✅解決0a278757。E2 wire=C wave相乗り待ち、retire?/hard-stop?=ユーザー承認待ち                                                                                                                                               |

offline lifecycle epic ✅（EPIC-A+CE14/N25+orgIdガード）。FEUX-1 ✅。redis-adapter follow-up ✅03d8f2ff。
