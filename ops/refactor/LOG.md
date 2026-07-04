# LOG — 実施記録+検証（1スライス1エントリ）

> 2026-07-03 台帳再編で REFACTOR_LOG.md と VERIFICATION.md を統合。過去分は
> `archive/REFACTOR_LOG_until-20260703.md` / `archive/VERIFICATION_until-20260703.md` を参照。
> エントリ書式: `## <日付> <変更ID> <commit>` — 分類 / 対象 / 実施内容 / 挙動変更 /
> 検証(コマンドと結果) / レビュー verdict / 残課題。簡潔に（1エントリ 15 行以内目安）。

## 2026-07-03 台帳再編（このコミット）

- 分類: docs/ops
- 実施: ops/refactor を 3+1 ファイル体制へ再編（STATE/BACKLOG/LOG + CODE_MAP）。
  旧11台帳+ULTRACODE 系8+workflow スクリプト4を archive/ へ git mv（履歴保全）。
  BACKLOG.md = A3 統合バックログ + A1/A2 候補 + VG1 裁定(A1-GEO flagged)。
  P0 は .agent-loop/BLOCKED.md へ一本化（X01 追記）。
- 挙動変更: なし（docs のみ）
- 検証: n/a（ソース非接触）

## 2026-07-03 PERF-01 981f1a58

- 分類: performance / behavior-preserving API internals
- 対象: `src/app/api/pharmacy-drug-stocks/bulk/route.ts` + focused route test
- 実施: preview/audit row→operation 照合の `operations.find(rowNumber)` を first-wins
  `operationByRowNumber` Map に置換。summary audit 側の同種探索も同じ Map へ収束。
- 挙動変更: なし。response shape、row order、invalid/unmatched、audit payload、upsert/auth/no-store 不変。
- 検証: baseline focused vitest 18/18 green。post-edit focused vitest 19/19 green（60行 audit row
  mapping regression 追加）。scoped eslint/prettier/diff-check green。`pnpm typecheck` /
  `pnpm typecheck:no-unused` green。
- レビュー: opus APPROVE、claude commit 981f1a58。self-commit なし。

## 2026-07-03 MFA1 f7bf2e97

- 分類: auth/security observability / behavior-preserving log convergence
- 対象: `src/app/api/auth/mfa/recovery/route.ts` + focused route test
- 実施: Cognito 失敗後の recovery-code restore 失敗ログを `console.error` から safe `logger.error`
  へ置換。context は event/route/method/operation のみ、error は logger の `error_name` 抽出のみ。
- 挙動変更: なし。rate-limit、validation、復旧処理、502/503 応答、restore fail-soft 方向は不変。
- 検証: focused vitest 9/9 green。scoped eslint/prettier/diff-check green。`pnpm typecheck` /
  `pnpm typecheck:no-unused` green。secret/token 非包含 negative assert 追加。
- レビュー: opus APPROVE、claude commit f7bf2e97。self-commit なし。

## 2026-07-03 F84 c22c7fe3

- 分類: bug/concurrency / behavior-preserving app-layer serialization
- 対象: `src/app/api/consent-records/route.ts` + focused route test
- 実施: active ConsentRecord の `patient_id+consent_type` 重複チェックを advisory lock +
  tx内再readへ移動。DB migration/partial unique index は追加しない。
- 挙動変更: なし。既存 400 validation error/message、auth、no-store、audit fail-closed は不変。
- 検証: baseline focused vitest 13/13 green。post-edit focused vitest 14/14 green。scoped
  eslint/prettier/diff-check green。`pnpm typecheck` / `pnpm typecheck:no-unused` green。
- レビュー: opus APPROVE、claude commit c22c7fe3。self-commit なし。

## 2026-07-03 CE17 5205fc48

- 分類: performance / daily prescription expiry scan bounding
- 対象: `src/server/jobs/daily/prescriptions.ts` + `src/server/jobs/daily.test.ts`
- 実施: `checkPrescriptionExpiry` の `prescription_expiry_date <= tomorrow` 全履歴 scan を、
  JST 7日前開始〜翌日終了の bounded window へ変更。通知 title/message/recipient/dedupe/processedCount は不変。
- 通知意味論: 直近7日の outage を catch-up し、dedupe_key は intake id のままなので再通知スパムを増やさない。
- レビュー: opus CHANGES_REQUESTED 1件（初回の今日〜翌日窓では D-1/D 2連続欠落時に通知が永久喪失）。
  下限を7日前へ修正し、`formatDateKey` TZ表示ズレは CE20 として BACKLOG 起票。
- 検証: focused `daily.test.ts -t "prescription expiry"` 3/3 green。full `daily.test.ts` 43/43 green。
  scoped eslint/prettier/diff-check green。`pnpm typecheck` は並行 A1-CRC FE dirty の `reports/[id]/page.tsx`
  型エラーで blocked（CE17外、該当 lane へ委譲）。
- 最終: opus APPROVE、claude commit 5205fc48。self-commit なし。

## 2026-07-03 R07 f3733036

- 分類: dead-code removal / behavior-preserving cleanup
- 対象: `src/lib/dashboard/home-config.ts` + 自テスト
- 実施: 外部参照0の dashboard home config（358行）と、その config のみを検証していたテスト（95行）を削除。
  `home-link-builders.ts` は18以上の生存 consumer があるため保持。
- 挙動変更: なし。runtime import なし、route/config/script/型のみ参照なし。docs の生きた参照なし、archive 参照のみ残置。
- 検証: export symbol 静的 `rg` 0件。`home-link-builders.test.ts` 4/4 green。scoped eslint green。
  `tsc --noEmit --pretty false` green、home-config 該当エラー grep 0件。
- レビュー: opus APPROVE、claude commit f3733036。self-commit なし。

## 2026-07-03 PERF-02 60469cd1

- 分類: performance / behavior-preserving API internals
- 対象: `src/app/api/dispense-results/route.ts` + focused route test
- 実施: `DispenseResult` 保存の update/create/P2002 fallback を `org_id_task_id_line_id`
  compound unique upsert へ置換。`DispensingDecision` upsert、partial lock、replay、audit/webhook は不変。
- 同値性: create arm は旧 create の `org_id/task_id/line_id + resultData`、update arm は旧 update/fallback update の
  `resultData` のみ。immutable identity は update に載せない。
- 検証: route+workflow vitest 45/45 green。scoped eslint/prettier/diff-check green。
  `pnpm typecheck` green。2行投入で `DispenseResult.upsert` 2回のみを test-lock。
- レビュー: opus APPROVE、claude commit 60469cd1。self-commit なし。

## 2026-07-03 CE20 66d65f99

- 分類: bug/TZ / user-visible notification date
- 対象: `src/server/jobs/daily/prescriptions.ts` + `src/server/jobs/daily.test.ts`
- 実施: 処方箋期限通知 message の日付を process-local `formatDateKey` から JST 固定 `japanDateKey` へ変更。
- 不変: query window / dedupe_key / recipient / link / processedCount / createMany skipDuplicates。
- 検証: focused `daily.test.ts -t "prescription expiry"` 4/4 green。
  `daily.test.ts` + `date-boundary.test.ts` 68/68 green。scoped eslint/prettier/diff-check green。
  `pnpm typecheck` green。
- レビュー: opus APPROVE、claude commit 66d65f99。self-commit なし。

## 2026-07-03 ID-1a report-ready

- 分類: design-spike / Prisma query extension tx feasibility
- 対象: `src/lib/db/display-id-spike.test.ts` + 台帳3ファイル
- 実施: 既存 `PackagingMethodMaster.description` を display_id surrogate とし、実DB disposable
  `display_id_spike_sequence` で Prisma 7.8 `query.$allModels.create/createMany` hook の挙動を検証。
  schema/migration は変更なし。
- 判定: 基準1 FAIL（interactive tx rollback 後、親行は0件だが sequence `next_value=2` が残り別接続漏れを実証）。
  基準2 非tx create PASS、基準3 createMany 注入 PASS、基準4 withOrgContext session 変数非干渉 PASS。
- 推奨: E1 は不採用。親 create と同一 tx を呼び出し側から渡す E2（明示 `allocateDisplayId(tx, ...)`）へ fallback。
- 検証: focused vitest（local 5433 e2e DB 明示）4/4 green。env未設定時は4/4 skipを確認。
  scoped eslint/prettier/diff-check green。
  `pnpm typecheck` green。`pnpm typecheck:no-unused` は Node 4GB heap OOM、8GB指定で green。
- レビュー: report pending。self-commit なし。

## 2026-07-03 ID-1b report-ready

- 分類: infra/db / display_id E2 allocation foundation
- 対象: `prisma/schema/admin.prisma`, new `20260703143000_add_id_sequence`, `src/lib/db/display-id*`,
  `prisma/rls-policies.sql`, `src/tools/rls-policy-contract.test.ts`, 台帳3ファイル
- 実施: `IdSequence` additive table（`@@map("id_sequence")`, PK org_id+prefix, DB defaults/checks）、
  §2表の138件 registry、`allocateDisplayId` / `allocateDisplayIdRange` / `allocateGlobalDisplayId` を実装。
- 安全契約: org scope は tx 必須、global は `__global__` の明示 helper のみ。`Setting` は業務除外、
  `IdSequence` は infrastructure 除外、`cfg` は予約 prefix。RLS は設計通り intentional exclusion。
- 検証: prisma validate green。unit/static 32 pass + DB 5 skip（env unset）。local e2e migration 適用成功、
  DB integration 含む 37/37 green（rollback非リーク・20並行連番・tenant分離・global sentinel）。
  dev `.env` は `localhost:5432/ph_os_dev` だが DB 未起動で `migrate deploy` は P1001（prod接続なし）。
  eslint/format:check/diff-check green。`pnpm typecheck` は4GB OOM、8GB指定で green。
  `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused` green。
- レビュー: report pending。self-commit なし。

## 2026-07-03 ID-2-W1 report-ready

- 分類: infra/db / display_id patient-domain wave 1
- 対象: `prisma/schema/patient.prisma`, new `20260703150000_add_patient_display_ids`,
  `tools/scripts/backfill-display-ids.ts` + test, `src/lib/db/display-id.test.ts`, 台帳3ファイル
- 実施: patient.prisma の18 org-scoped model へ nullable `display_id` と `@@unique([org_id, display_id])` を追加。
  migration は既存列非破壊の `ADD COLUMN` + `WHERE display_id IS NOT NULL` partial unique index のみ。
- backfill: registry model args 指定、org別 `created_at ASC, id ASC`、`allocateDisplayIdRange` batch 採番、
  NULLのみ更新、duplicate/format/sequence pre/post check。local e2eで322 rows backfilled。
- addendum: `--max-rows` を model単位ではなく run全体の apply 上限として事前合計チェック+残budget共有へ修正。
- seed確認: `pnpm db:e2e:prepare` / `pnpm db:e2e:seed` green。post-seed dry-run は全18 model null 0・issues 0。
- 検証: prisma validate/db:generate green。focused vitest DB込み 24/24 green。scoped eslint/format green。
  `pnpm typecheck` は4GB OOM、`NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck` green。
- 備考: dev DB `localhost:5432` は未起動（接続不可）。Patient create-path allocation は今回LOCK外のため follow-up 候補。
- レビュー: report pending。self-commit なし。

## 2026-07-03 ID-2-W2 report-ready

- 分類: infra/db / display_id prescription-domain wave 2
- 対象: `prisma/schema/prescription.prisma`, new `20260703152000_add_prescription_display_ids`,
  `tools/scripts/backfill-display-ids.ts` usage文言, `src/lib/db/display-id.test.ts`, 台帳3ファイル
- 実施: prescription.prisma の18 org-scoped model へ nullable `display_id` と `@@unique([org_id, display_id])` を追加。
  migration は既存列非破壊の `ADD COLUMN` + `WHERE display_id IS NOT NULL` partial unique index のみ。
- backfill: W1 generic script を registry model args で再利用。local e2e dry-run は対象 NULL 1,522 rows・issues 0。
  apply は1,522 rows backfilled、postChecks は全18 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。
- seed確認: `pnpm db:e2e:prepare` / W2 apply / `pnpm db:e2e:seed` / post-seed dry-run green。
- 検証: prisma validate/db:generate green。focused vitest DB込み 29/29 green。scoped eslint/format/diff-check green。
  `NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck` と `typecheck:no-unused` green。
- レビュー: db_steward read-only LOW（`--max-rows` usage ambiguity）は wording 修正済み。self-commit なし。

## 2026-07-04 ID-2-W3 report-ready

- 分類: infra/db / display_id visit+communication wave 3
- 対象: `prisma/schema/visit.prisma`, `prisma/schema/communication.prisma`,
  new `20260703153000_add_visit_communication_display_ids`, `src/lib/db/display-id.test.ts`, 台帳3ファイル
- 実施: visit.prisma 10 + communication.prisma 14 direct org-scoped model へ nullable `display_id` と
  `@@unique([org_id, display_id])` を追加。migration は W1/W2 同型の `ADD COLUMN` +
  `WHERE display_id IS NOT NULL` partial unique index のみ。
- 方針: `HandoffBoard` は direct org として W3 対象。`HandoffItem` は registry `orgViaParent` /
  `board_id` 経由で direct `org_id` が無いため W3 generic backfill から除外し W7 残余へ。
- backfill: local e2e dry-run は対象 NULL 102 rows・issues 0。apply は102 rows backfilled、
  postChecks は全24 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。seed 後 dry-run も全0。
- 検証: prisma validate/db:generate green。`pnpm db:e2e:prepare` / W3 apply / `pnpm db:e2e:seed` /
  post-seed dry-run green。focused DB vitest 29/29 green。scoped eslint/format/diff-check green。
  `NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck` と `typecheck:no-unused` green。
- レビュー: db_steward read-only No Findings。self-commit なし。

## 2026-07-04 ID-2-W4 report-ready

- 分類: infra/db / display_id organization-domain wave 4
- 対象: `prisma/schema/organization.prisma`, new `20260703154000_add_organization_display_ids`,
  `src/lib/db/display-id.test.ts`, 台帳3ファイル
- 実施: organization.prisma の direct org-scoped 15 model へ nullable `display_id` と
  `@@unique([org_id, display_id])` を追加。`Organization` と `User` は割当指示どおり対象外。
  migration は W1-W3 同型の `ADD COLUMN` + `WHERE display_id IS NOT NULL` partial unique index のみ。
- backfill: local e2e dry-run は対象 NULL 38 rows・issues 0。apply は38 rows backfilled、
  postChecks は全15 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。seed 再実行後に
  `Membership` が4 rows再作成されたため、所有外の seed caveat として記録し、Membership の再backfill後の
  final dry-run は全15 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。
- 検証: prisma validate/db:generate green。`pnpm db:e2e:prepare` / W4 apply / `pnpm db:e2e:seed` /
  Membership再apply / final dry-run green。focused DB vitest 29/29 green。scoped eslint/format/diff-check green。
  `NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck` と `typecheck:no-unused` green。
- レビュー: db_steward read-only No Findings + opus 独立レビュー APPROVE（15モデル網羅・additive・既存 unique 非破壊）。
- land: `7e18fcb2`（code+migration+test）+ `a42065fa`（FIX-CATALOG-IDSEQ）。
- 併せ解消した既存欠陥 FIX-CATALOG-IDSEQ: `IdSequence`（ID-1b 0a3b910c 追加の採番カウンタ表）が
  `src/lib/admin/data-explorer-catalog.ts` のカバレッジカタログに未登録で、`db:generate` 鮮度更新後の
  フル `pnpm test` が `classifies every Prisma model exactly once` で赤（過去波は生成 client stale で通過）。
  `backend_only` へ分類 + `DATA_EXPLORER_MODEL_EXCLUSIONS` へ追加（tenant Data Explorer から除外）。
  combined gate green（test 13056 passed / 0 failed、lint green、build/typecheck/no-unused は W4 tree で green）。
- opus follow-up: M-1（`User` は registry scope='org' だが波計画 global(W6)、`CXR2-RLS02` design 判定で確定）と
  L-1（org-scoped registry model の wave 網羅 completeness assertion）を BACKLOG `ID-2-UR` に登録。

## 2026-07-04 ID-2-W5 report-ready

- 分類: infra/db / display_id pharmacy-partnership wave 5
- 対象: `prisma/schema/pharmacy-partnership.prisma`, new
  `20260703155000_add_pharmacy_partnership_display_ids`, `src/lib/db/display-id.test.ts`,
  台帳3ファイル
- 実施: pharmacy-partnership.prisma の direct org-scoped 18 model へ nullable `display_id` と
  `@@unique([org_id, display_id])` を追加。migration は W1-W4 同型の `ADD COLUMN` +
  `WHERE display_id IS NOT NULL` partial unique index のみ。
- 方針: `PatientShareCase` 等の cross-org 共有系も display_id は row の `org_id` による自org採番。
  相手org向け/外部向け番号としては扱わず、既存 `invoice_no` 等の業務番号も置換しない。
- gate強化: W5 wave list に加え、`pharmacy-partnership.prisma` の direct org-scoped model 集合と
  W5 list が一致する completeness guard を追加。
- backfill: local e2e dry-run は対象 NULL 32 rows・issues 0。apply は32 rows backfilled、
  postChecks は全18 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。seed 再実行後の
  final dry-run も全18 model null 0・duplicate 0・invalid 0・sequenceMismatch 0。
- 検証: prisma validate/db:generate green。`pnpm db:e2e:prepare` / W5 dry-run / W5 apply /
  `pnpm db:e2e:seed` / final dry-run green。focused DB vitest 30/30 green。
  scoped eslint/format/diff-check green。`NODE_OPTIONS=--max-old-space-size=12288 pnpm typecheck`
  と `typecheck:no-unused` green。
- レビュー: migration_planner read-only No Findings。test_architect read-only は W5 completeness guard
  追加を推奨、対応済み。opus 独立レビュー APPROVE（findings ゼロ。cross-org は単一org所有設計
  =第2オーナー列皆無・全relation [id, org_id] 参照で display_id 意味論の破綻なしを実証）。
- land: `86d9d273`。全量 gate: test は 13054 passed / 実失敗 0（唯一の Failed Suite は並行 R22-EXEC の
  ファイル削除と vitest collection の race による spurious ENOENT。W5 非起因）。lint green。
- 運用改善: 以後の全量 gate は EDIT-FREEZE broadcast → 全レーン ACK → gate 実行に変更（race 再発防止）。

## 2026-07-03 DR-DUP1 2e0c7fdb

- 分類: bug/data-integrity / defensive validation
- 対象: `src/app/api/dispense-results/route.ts` + focused route test
- 実施: `lines[].line_id` 重複を zod schema の `superRefine` で 400
  `VALIDATION_ERROR` 拒否。transaction 前に止め、同一 `DispenseResult` の非決定的上書きを防止。
- 呼び出し元 recon: 非テスト POST は workbench mutate→adapter の単一路線。
  FE payload は API `count_rows.map(line.id)` 由来で、drag/drop は splice→push の移動。
- 挙動変更: あり（malformed duplicate payload を拒否）。正規 FE 呼び出しの正常系は不変。
- 検証: focused duplicate test green。full `dispense-results/route.test.ts` 43/43 green。scoped eslint green。
- レビュー: opus APPROVE、claude commit 2e0c7fdb。self-commit なし。

## 2026-07-03 までのスライス（要約、詳細は archive/ と git log）

- Claude lane: Wave2 完了バッチ(9 commits) / W3 code-only(C2/E2/E3, 4 commits) /
  W3-E2/E3 残(3 commits) / W3-B4 中核 52ce1f66 / B6 設計 3a39f69e / Plans 台帳 4cf5bc3b
- codex lane: BE-1 036e05e7 / b33c71b8 / RT1 e8027e51 / RR-QP-A 1b9b5366 / RR-QP-B 07cd78a1 /
  JOB1 c025b133 / JOB2 d6cdc59a / CW1 f15f9f98 / BM1 5be6ebca / billing-candidates 9d1567ba
  — 全て opus APPROVE（9d1567ba/b33c71b8 は post-commit 承認）
- gate: 全量 green（test 13033 / lint / format / colors / typecheck / no-unused / build）

## 2026-07-04 R16-MIN da5889f0 / R16-SWEEP 6f26c04c

- 分類: refactor / JST date-key 収斂（codex2 レーン初仕事）
- 対象: patient-home-operations(MIN) + prescription-date-window / date-continuity /
  conference-data-sync / visit-schedule-planner / dispense-workbench-patients(+新規test)(SWEEP)
- 実施: ローカル TOKYO formatter/toISOString().split を正本 japanDateKey / formatUtcDateKey へ収斂。
  意図的 semantics 修正1件: workbench registered_date を JST 業務日付へ（表示+ソートのみ、課金非関与を
  caller 全数 grep で確認）。除外領域(billing/MCS/timeline/export/auth/schema)は list-only。
- 検証: TZ=UTC / TZ=America/New_York で focused 68 tests green。MIN は Intl 設定 byte-identical 証明。
- レビュー: MIN=committer 検証 APPROVE、SWEEP=opus APPROVE（同値性を helper 実装まで遡って裏取り）。
  opus Low: planner:1241-1245 localDateKey は pre-existing・実害なし、将来 sweep 候補（R16 残余に記録）。

## 2026-07-04 R22-EXEC 759b4dbc

- 分類: dead-code removal / 未使用 Yjs 協調編集+room-token チェーン削除（codex3 レーン初仕事）
- 対象: Yjs client 鎖8+専属テスト、room-token route/service+テスト、package.json(yjs/y-protocols/
  y-websocket/lib0 除去、lockfile 純transitive -57行)、rate-limit/protected-post matrix、
  presence.test の cursor-overlay entry、stale docs 5件、【LOCK例外】websocket lambda テスト2件の
  ローカル token fixture 化（削除 service import の随伴修正、アサーション不変）
- プロセス: opus 計画審査(PLAN_CHANGES_REQUESTED→HIGH織込み: presence.test の readFileSync ENOENT 回避)
  → 実装 → opus 実装レビュー APPROVE。UI 到達可能性ゼロを 二重検証（maker rg + opus 独立 rg）。
- 検証: survivor 11 files/276 tests + websocket 2 files/16 tests green。tree-wide typecheck green
  (claude 独立実行)。build は land 後に claude が検証。
- 残: R22b（tools/infra/websocket 一式+infra docs）。
- 教訓: 全量 gate 中のファイル削除が vitest collection と race → EDIT-FREEZE 運用を導入。
  opus 計画審査は src/ 境界のみで tools/ の cross-boundary import を見落とし → maker が検出・FYI 即応で解消。

## 2026-07-04 R08-EXEC cee20c66

- 分類: dead-code removal / 零importer 5モジュール+5テスト削除（922行、codex3）
- evidence: per-symbol rg 0件、/api/health は backup-monitor shadow 実装で無関係、
  localStorage 生キー不在、barrel 再export なし — maker と opus が独立に二重検証。
- 検証: survivor 7 files/64 tests green、typecheck(8GB) green。
- レビュー: opus APPROVE。Low: design-gap-analysis 等の recent-operations stale 記述
  (元々未配線・退行なし) → doc 掃除 follow-up。

## 2026-07-04 ID-2-W6 d2bcde00

- 分類: infra/db / display_id admin+drug 波 + 設計判断（codex xhigh）
- 実施: admin 15 + drug 3 モデルへ W1-W5 同型 additive。**User registry scope='org'→'global' 是正**
  (M-1 解消。staff 表示は Membership.display_id)。DrugAlertRule/IntegrationJob は nullable org_id で
  恒久 defer。**L-1 completeness gate 実装**(wave 所属 or 明示 DEFERRED、双方向検査)。
- backfill: local e2e 25,347 rows(AuditLog 25K 含む)、postChecks 全 green。
- レビュー: opus APPROVE。Medium(運用): 本番高書込表への index 作成は CONCURRENTLY 別ステップ or
  メンテ窓 → BACKLOG `ID-2-OPS` に起票。Low×2(DEFERRED 注記分離・IntegrationJob 根拠記録)は W7 で消化。

## 2026-07-04 FE-FALSEEMPTY-SWEEP 27496917

- 分類: bug/fe / false-empty fail-close 4画面（codex2）
- 実施: QR draft 詳細・conferences カレンダー・conflict-resolution・visit-brief セクションで
  fetch 失敗が空状態/無言消滅に潰れていたのを ErrorState variant=server + refetch / サマリ '—' へ。
- 検証: focused 4 files/27 tests green(error UI+false-empty 文言不在+refetch 配線)。
- レビュー: opus APPROVE(conferences 巨大 diff を git diff -w で分離し3点のみ確認、isLoading→isError
  順序・enabled ガード適正)。list-only 残余: schedules 系 form 副次データ・billing 隣接(BACKLOG 記載)。

## 2026-07-04 R17-SWEEP 0fd02044 / R17-B2 6d5b256d

- 分類: refactor / counted-list envelope の byte-preserving 収斂（codex2）
- 実施: buildCountedListEnvelope 新設(先頭5キー固定・metadata 後置)、8+2 route を収斂。
  cursor 系/meta.has_more 系/複雑 shape は drift 実在のため list-only(R17 stage1 分類)。
- 検証: キー順を helper/route 両層の full-key-order assert でロック。truncated 2変種の数学的
  同値を opus が証明。9 files/86 tests + B2 30 tests green。
- レビュー: opus APPROVE + B2 は committer 検査(opus 事前検証済みパターン)。

## 2026-07-04 R23 batch2 7e7b6bcd / batch3 618c591a

- 分類: refactor / messageFromError 移行 第2-3バッチ（codex3）
- 実施: B2=admin 9ファイル20箇所+route-compare の byte-identical ローカル helper 削除。
  B3=dashboard 8ファイル15箇所(billing candidates は CSV export toast 1箇所のみ=算定非接触を
  opus が hunk 単位確認)。fallback 全 byte 保存。残量 88 hits/26 files(大半機械的候補、継続妥当)。
- レビュー: 両バッチ opus APPROVE。

## 2026-07-04 ID-2-W7 483750cb — schema 波完遂

- 分類: infra/db / display_id 最終 residual 波（codex xhigh）
- 実施: 残余12 direct-org モデル同型 additive。HandoffItem は org_id 列なし→display_id+非unique
  partial index+--include-parent-scoped opt-in の親join backfill(board→org、二重 reject+test固定)。
  DEFERRED は恒久 defer(DrugAlertRule/IntegrationJob=nullable org_id)のみに分離。
- レビュー: opus APPROVE。Low 申し送り: **HandoffItem の親org unique 軸は未解決 — runtime allocator
  配線前に必ず解決**(design doc §11 参照)。injection 面 clean(quoteIdentifier allowlist+parameterized)。
- これで W1-W7 全波 land。org-scoped 137モデル(恒久defer 2除く)に display_id 列+backfill 経路が揃った。

## 2026-07-04 全量 gate ALL GREEN（EDIT-FREEZE 下）

- 手順: EDIT-FREEZE broadcast → 3レーン ACK 確認 → 直列 gate 実行(新運用の初適用、race ゼロ)。
- 結果: db:generate / test 12995 passed(削除スライス反映で母数減は想定どおり) / lint / format:check /
  colors:check / typecheck(8GB) / typecheck:no-unused(8GB) / build 全 PASS。
- 対象: W4 以降の本日 land 全19スライス(display-id W4-W7 / FIX-CATALOG / R21 / R16×2 / R22 / R08 /
  R23×3 / R17×2 / FE-FALSEEMPTY / 台帳4)。

## 2026-07-04 R23 batch4-6 81958346 / 348aea1a / 8c6d746e

- 分類: refactor / messageFromError 移行 B4-B6（codex3）
- B4=admin 5 files 44箇所(初回 report は単一行 grep で multiline 9箇所を取りこぼし
  → opus CHANGES_REQUESTED → 修正 → 私の独立 rg -U で 0 確認)。B5=patient cards 10 files 17箇所。
  B6=schedules/visits/billing 9 files 22箇所(billing hunks は onError toast のみ)。
- 教訓: 同型 sweep の検出は rg -U (multiline) を標準化。残余 ~20 hits は workflow/offline
  大ファイル+非toast sink → B7-RECON で最終評価中。

## 2026-07-04 R24 cursor-pagination 収斂 bdb02a75 (+ee089258 GET 分)

- 分類: refactor / 手組みカーソルページネーション→buildCursorPage（codex2）
- B1=patient-self-reports/cases/qr-scan-drafts/medication-issues、B2=prescription-intakes 2分岐。
  キー順 byte 保持(full-key-order assert)+exact-limit 境界テスト。take/slice 同値・nextCursor
  表示末尾行 id 同値を opus が証明。複雑系(consent-records/visit-records/care-reports/drug-masters/
  offset型 medication-cycles)と billing-candidates は recon 分類で除外のまま(BACKLOG 保留)。
- インシデント: レビューアが検証で git stash 退避→maker 再適用と衝突し一時差分消失
  → 完全復元・データ喪失なし。以後レビューアには working-tree 変更禁止(git show HEAD: 参照)を
  プロンプトで明示する運用に変更。

## 2026-07-04 ID-2-CP-A a564c824 / ee089258 — create-path 配線 第1弾

- 分類: infra/db / 本番 create 経路が IdSequence 消費開始（codex xhigh）
- 対象: SavedView/Task(非dedupe: operational+set-audit rework+conflict-reconfirmation)/PcaPump/
  PcaPumpRental/PcaPumpMaintenanceEvent/MedicationIssue(visit-record 残薬経路含む) の 6モデル、
  route 9+service 1。same-tx 採番・validation 後配置・4xx 非採番(negative assert は allocator
  不呼出を直接検査)・operational-tasks 公開型 byte 同一(billing-evidence 等 caller 無変更)。
- レビュー: opus 全9項目 PASS で APPROVE。272 tests green。
- 追跡(Medium): **dedupe upsert Task 経路(本番最多)は未配線=NULL display_id 続行** → CP-B で
  設計裁定(事前チェック型 vs 事後埋め型 vs 定期 backfill)。
- 運用ノート(Low): same-tx 採番は id_sequence(org,prefix) 行ロックを commit まで保持。Task の
  't' prefix は org 内ホット行 — 長尺 tx の Task create は org 単位で直列化(設計内在の trade-off)。
- medication-issues は CP-A(POST)+R24-B1(GET) の二重レーン共有ファイル → 両 verdict 後に
  合本コミット ee089258 で land(hunk 非干渉を opus 確認)。

## 2026-07-04 R25-B1 bf005a43 / R18 47c80904 / R23-B5〜B7 348aea1a,8c6d746e,786fdec7+40102b7e

- R25-B1(codex2): 手組み retry action 63箇所/50画面 → 既存 onRetry へ(レンダリング完全同値、
  外観保全 site 3件と「再読み込み」系は保全。label prop 化は契約変更として保留)。opus APPROVE。
- R18(codex3): prescriptions FE の重複 DTO 2型を shared へ(純 type-only、committer 全数検査=
  type-only は検査で完全検証可能なため opus 省略の明示例外)。
- R23 B5-B7(codex3): patient cards 17 + schedules/visits 22 + 最終18箇所。B7 は opus が
  「変数名 error 固定の sweep が draftError を見逃し完了宣言が偽」を捕捉→修正。
  **toast 同型 sweep 完了(B1-B7 計~140箇所)**。教訓: 同型検出は変数名非依存+rg -U を標準。
- B7 land 時に committer の add pathspec ミスで 2 コミット分割(786fdec7+40102b7e、内容同一)。

## 2026-07-04 ID-2-CP-C fbbbe905 / FIX-CPA-MATRIX 435a4b0f / Gate #2 ALL GREEN

- CP-C(codex): range 採番配線 = MedicationProfile/PatientLabObservation/ResidualMedication の
  7経路。opus: range 数=実挿入数を全経路実証、dup-skip→採番順序、skipDuplicates 不在。
- Gate #2(EDIT-FREEZE 下): 唯一の失敗 = auth-matrix ハーネスの汎用 tx proxy に $queryRaw 欠落
  (CP-A 配線 route が 500)。診断で route 設計は正(採番は event-create 分岐内)と確定、
  harness 修正+negative assert 追加(435a4b0f)。test 再実行 13007 passed で ALL GREEN 宣言。
- 教訓: create-path 配線スライスは focused suite に加え **cross-cutting matrix テスト
  (protected-post/patch-delete)を必須検証に含める**。
- 凍結中の idle recon 成果: R06/R19/R20/R30/R35/R42/R45(codex2)、R09/R10/R12/R14/R15/R22b(codex3)
  の現存確認・スライス案が揃い、FREEZE 解除後のキューに投入。

## 2026-07-04 R19 1baee9ab / R06 a59d9d4a / R18 系 type-only 3連

- diff-review(R19)・CdsAlert(R06) の BE/FE 重複契約を中立モジュールへ(type-only、re-export で
  consumer 不変)。R06 は CDS 医療安全隣接のため type-only 厳守で実施。committer 全数検査
  (type-only 例外規定)。R42(VisitVehicleResource、subset/full 分離維持)も同型で進行中。

## 2026-07-04 R15-B1 7d1370c0 / FIX 627c46b4

- R15-B1(codex3): admin 17ファイル57箇所の生 x-org-id → buildOrgHeaders 系へ。opus がヘッダ
  集合 byte 同値・fail-closed 非発火・条件分岐保存を全数確認。B2(admin 外 20ファイル)進行中。
- 627c46b4: 私が land した FIX-CPA-MATRIX の 1n literal が typecheck 赤(TS2737) — gate の
  typecheck 通過**後**に land して再検証を怠った committer ミス。BigInt(1) hotfix。
  教訓: gate 後の追加 land は当該ステップ(typecheck 等)の部分再実行をセットにする。

## 2026-07-04 ID-2-CP-B 4eae9ffc — dedupe upsert Task の採番完了

- 設計: fable 裁定 Option B(事後埋め型)。upsert select id/display_id → NULL なら同 tx で
  allocate + CAS updateMany({id, org_id, display_id: null})。count=0 は reread 収束、fail-closed。
  update branch が display_id を書かない不変条件を test 固定(並行安全性の根拠)。
- レビュー: opus APPROVE(公開 Tx 契約不変・caller 40+ 戻り値未消費まで確認・189+22 green)。
- 既存 NULL 行は次回 dedupe touch で自己治癒。race は欠番のみで重複なし(欠番許容設計)。
- display_id create-path: CP-A/B/C で主要経路完了。残 = CP-D(Patient 系 PHI batch)、
  HandoffItem(unique 軸未解決)、derived MedicationIssue(凍結)。次フェーズ ID-3(UI 表示置換) recon 開始。

## 2026-07-04 収斂バッチ群 (R30/R42/R15-B2,B3/R19/R06/R20-B1〜B4)

- R30(77d8efda): formatFileSize 共有化。R42(d77c5829): VisitVehicleResource 契約共有(subset/full 分離)。
- R15: B2=patients/schedules 19ファイル(489b3da9)、B3=workflow/presence 系 9ファイル(fc261eb2)。
  共有 planner-hooks は R42 と合本(65b3ce26)。B3 で「広い解釈で実装→裁定後 revert→report が stale」
  の報告齟齬が発生、opus が実 tree との乖離を検出 → **report には送信時点の git diff --stat を
  添付する運用**を導入。残 13ファイル/89箇所は B4 進行中(nuance 4件のガイダンス付き)。
- R19(1baee9ab)/R06(a59d9d4a): diff-review・CdsAlert の BE/FE 契約を中立モジュールへ(type-only)。
- R20 B1-B4(b268b41e/e646023f/d4573ccb/f023eb6c): no-store アサーション共有 helper + 147ファイル移行。
  残 ~40 同型 + variant 8(list-only)。
- 627c46b4 の教訓は既記載(land 後の部分再gate)。

## 2026-07-04 ID-3-S1 3ce1e5c1 — UI display_id 表示の第1スライス

- 表示規約 helper(src/lib/display-id/display-labels.ts): 可視ラベル=display_id 非空優先、
  fallback は旧 cuid 短縮と byte 同一。**識別子(href/value/key/payload/cursor)は cuid 恒久維持**。
- prescription-intakes API に additive display_id/cycle.display_id 露出(R24 の key-order テスト無干渉)。
- prescription 系 5 画面の可視ラベル置換。§7 外部非露出は external-access payload の JSON 全文
  negative test で固定(mock に display_id を混入させても公開 payload に出ない)。
- レビュー: opus APPROVE(cuid 維持を site 全数検証)。次: S2=schedule/day-view+patient CareCase パネル。
  billing invoice/PDF 番号は §8.2 別レイヤで恒久 keep-out。

## 2026-07-04 R15 完了級 / R20 完了 / R43 開始 / day-board インシデント

- R15 B4(72392917)/B5(b0801994): 計 72ファイル/291箇所の org ヘッダ収斂完了(残 route-compare 1件
  =S2 待ち解放済み、core boundary 2ファイルは恒久除外)。B5 は offline/realtime クリティカル経路
  含む — opus が retry/queue/SSE 不変と条件付き semantics の実装判断(qr-scan/app-header)を検証。
- R20 B5(9d4fbd89)/B6(45ab4804): no-store アサーション共有化完了(204ファイル)。残14は
  variant 8 + mock 干渉 6(helper import が hoisting で 500 化するファイル=理由文書化済み)。
- R43-B1(7e7ebc63): fetch mock helper 共有化開始(11ファイル)。
- **day-board インシデント(d09688a5)**: R20-B6 で私(committer)が maker の「mixed-lane ファイルは
  hunk 分離」フラグを見落とし whole-file staging → S2 の test 期待値が先行 land し HEAD 赤2件。
  detached worktree で赤を実証 → R20-only 内容を再構築して commit、S2 hunk は worktree に復元。
  **教訓(恒久運用): maker が mixed-lane を明示したファイルは git apply --cached による hunk 単位
  staging を必須とする。丸ごと add 禁止。**

## 2026-07-04 ID-3-S2 5ef759db — schedule/patient パネルの display_id 表示

- day-view 共有 helper が display-labels 経由に(fallback byte 同一・「未設定」保持)。
  proposals/day-board/cases API に additive 露出。**redaction は allowlist 再構築で PHI 防御不変**
  (phone/保険番号等の非露出テスト継続)。UI ラベル置換 + cuid 不変条件を直接値比較で test 固定
  (route-compare の React key はむしろ display 由来→cuid へ改善)。opus APPROVE、392 tests green。
- ID-3 残: S3(patient board/detail nested)、S4+(data-explorer 等の設計スライス)。CP-D recon 進行中。

## 2026-07-04 R55 admin pharmacy-sites loading skeleton (codex3, pending review)

- 分類: UI pattern convergence / R55 plain-text loading → skeleton。
- 実施: `src/app/(dashboard)/admin/pharmacy-sites/pharmacy-sites-content.tsx` の薬局一覧 loading と
  保険設定 sheet 内 loading を visible plain text から `SkeletonRows` + named `role=status` に置換。
  `docs/ui-ux-design-guidelines.md` の skeleton loading 方針に沿い、API/DB/auth/billing 挙動は不変。
- テスト: `pharmacy-sites-content.test.tsx` に2件追加し、薬局一覧/保険設定 loading が
  announced skeleton になり旧 visible div text が出ないことを固定。
- 検証: focused Vitest 21/21 green、scoped ESLint green、scoped Prettier check green、
  scoped `git diff --check` green。
- 状態: Claude/Fable review/commit 待ち。W3-B2 migration apply/commit は引き続き user §15 承認待ち。

## 2026-07-04 agmsg Claude removal / R55 admin jobs loading 66ae881e

- 運用: ユーザー指示「claudeは今回使いません。削除してください。」に従い、`phos` から
  `claude` 登録を削除。`despawn.sh` は live actas lock なし、`reset.sh "$(pwd)" claude-code
claude` が 1 registration を削除。最終 `team.sh phos` は `codex` / `codex2` / `codex3` /
  `codex4` の4名のみ。
- land: codex2 の `R55-ADMIN-JOBS-PAGE-SUSPENSE-LOADING-LABEL` を coordinator 再検証後に
  `66ae881e refactor(admin): name jobs route loading status` として scoped commit。
- 変更: `src/app/(dashboard)/admin/jobs/page.tsx` の route-shell `Suspense` fallback を
  screen-specific `Loading label="ジョブ監視を読み込み中..."` に変更し、`page.test.tsx` で
  suspended content 時の named `role=status` と旧 generic status 不在を固定。
- 検証: focused Vitest `2/2` green、targeted ESLint green、targeted Prettier check green、
  targeted `git diff --check` green。
- 次: codex2=`R55-ADMIN-MASTER-PAGE-SUSPENSE-LOADING-LABELS`、codex3=`R55-DRUG-MASTER-IMPORT-HISTORY-LOADING-SKELETON`、
  codex4=backend/business-domain top2 read-only triage を割当済み。

## 2026-07-04 R55 admin master + drug-master loading f0029164 / fd065171

- 分類: UI pattern convergence / R55 loading-state cleanup。
- land: codex2 の `R55-ADMIN-MASTER-PAGE-SUSPENSE-LOADING-LABELS` を coordinator
  再検証後に `f0029164 refactor(admin): name master loading statuses` として scoped commit。
  coordinator 側で `packaging-methods` / `business-holidays` page tests を追加し、
  Suspense fallback の screen-specific `role=status` と旧 generic status 不在を固定。
- land: codex3 の `R55-DRUG-MASTER-IMPORT-HISTORY-LOADING-SKELETON` を coordinator
  再検証後に `fd065171 refactor(drug-masters): skeletonize import history loading` として
  scoped commit。取込履歴 loading を named skeleton にし、error/empty 分岐は維持。
- 検証: admin master focused Vitest `2 files / 4 tests` green、drug-master focused
  Vitest `1 file / 86 tests` green、両スライスとも exact ESLint / exact Prettier check /
  exact `git diff --check` green。
- 安全性: API/DB/auth/authorization/PHI/billing/import/deploy は不変。R22b infra deletion と
  ledger dirt は混ぜず別スライスとして保持。
- 次: codex2=`R55-SCHEDULE-OPERATIONAL-TASKS-LOADING-SKELETON`、codex3=`R21-SONNER-MOCK-SMALL-WAVE` を
  exact path で割当済み。codex4 backend/business-domain triage 待ち。

## 2026-07-04 W3-B9 emergency category fail-closed d535b4f6

- 分類: billing correctness / emergency category source fail-closed。
- land: codex4 read-only triage の candidate1 を coordinator 側で実装し、
  `d535b4f6 fix(billing): fail closed missing emergency rule category` として scoped commit。
- 変更: `rule-engine` は emergency visit の `emergencyCategory` が null/undefined の場合に
  fee2(`other_exacerbation`) を推定しない。manual emergency candidate も同条件では出さない。
  evidence 側 cbef13f4 の `emergency_category_source_missing` blocker と整合。
- 検証: focused Vitest
  `rule-engine.test.ts` + `rule-engine-emergency.test.ts` + `billing-evidence/core.test.ts`
  `3 files / 106 tests` green、targeted ESLint green、targeted Prettier check green、
  targeted `git diff --check` green。
- 安全性: DB/migration/auth/authorization/PHI/API payload は不変。算定根拠欠落時の過請求防止のみ。
- 次: codex4 は W3-B9 candidate2 として `monthly_cap_shared` が rule-engine で未消費の問題を
  read-only で公式根拠確認し、care online 46単位 / medical online 59点の shared cap 実装スライスを提案する。

## 2026-07-04 R55 schedule loading + R21 sonner mock 932d3d22/a54484d3

- land: codex3 の `R21-SONNER-MOCK-SMALL-WAVE` を coordinator 再検証後に
  `932d3d22 test(reports): use shared sonner mock` として scoped commit。
  `report-delivery-dashboard.test.tsx` の local partial `sonner` mock を既存
  `createSonnerToastMock()` helper に置換。test-only で product runtime は不変。
- land: codex2 の `R55-SCHEDULE-OPERATIONAL-TASKS-LOADING-SKELETON` を coordinator
  再検証後に `a54484d3 refactor(schedules): skeletonize operational task loading` として
  scoped commit。再架電タスク / 運用タスク loading を visible plain text から named
  `role=status` skeleton に置換し、false-empty 分離を test 固定。
- 検証: report delivery dashboard focused Vitest `1 file / 9 tests` green、schedule
  operational tasks focused Vitest `1 file / 8 tests` green、両スライスとも exact ESLint /
  exact Prettier check / exact `git diff --check` green。
- 安全性: report slice は test-only。schedule slice は query/action/API/DB/auth/billing/audit/PHI
  と empty-state semantics 不変。R22b infra deletion / AWS timeout/env-catalog dirt は混ぜず別スライスとして保持。

## 2026-07-04 R22b orphaned websocket infra deletion 96ead96b

- land: `R22b` の残りとして、`96ead96b refactor(infra): remove orphaned websocket stack`
  を scoped commit。`tools/infra/websocket/**` の orphaned SAM/Yjs WebSocket stack を削除し、
  infra README / AWS cost docs / env catalog / code map / repository inventory / staging docs /
  AWS client timeout contract から stale websocket/Yjs 参照を除去。
- 検証: `src/tools/aws-client-timeout-contract.test.ts` focused Vitest `1 file / 3 tests` green、
  targeted ESLint green、exact docs/tooling Prettier check green、targeted `git diff --check` green、
  websocket/Yjs/env residual `rg` no live refs、`NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` green。
- 安全性: app runtime/API/DB/auth/authorization/PHI/audit/billing/deploy は不変。削除対象は tracked
  infra tooling の未参照 stack のみ。`refactor-instructions.md` の広範な Markdown formatting churn は
  commit に含めず未処理として残置。

## 2026-07-04 R21 comment-thread sonner mock 7bb192e9

- 分類: test-harness cleanup / R21 sonner mock residual。
- land: `7bb192e9 test(comments): use shared sonner mock`。`comment-thread.test.tsx` の
  local partial `sonner` mock を既存 `createSonnerToastMock()` helper に置換。
- 検証: focused Vitest `comment-thread.test.tsx` + `sonner-test-utils.test.ts` が
  `2 files / 12 tests` green。exact ESLint / Prettier check / `git diff --check` green。
- 安全性: test-only。runtime component/API/DB/auth/authorization/PHI/audit/billing/deploy/payload は不変。
  `pnpm exec` により一時的に `@aws-sdk/client-apigatewaymanagementapi` の package/lock diff が出たが、
  out-of-scope 副作用として復元済み。

## 2026-07-04 R22 websocket reference refresh 91bca6fb

- 分類: R22 docs/tooling stale-reference cleanup。
- land: `91bca6fb docs(refactor): refresh websocket cleanup references`。
  R22b 後に残っていた WebSocket/Yjs 表現を、現在の presence-only / Redis-backed realtime
  前提へ整合。
- 変更: `REFACTOR_REPORT.md`、`docs/env-catalog.md`、
  `docs/operations/aws-cost-minimal-deployment.md`、`ops/refactor/BACKLOG.md`、
  `ops/refactor/CODE_MAP.md`、`tools/aws-cost-minimal-scenarios.json`。
- 検証: exact docs/tooling Prettier check green、targeted `git diff --check` green。
  `docs/env-catalog.md` の key row count は `134`。
- 安全性: docs/tooling-only。package dependencies、app runtime/API/DB/auth/authorization/PHI/audit/billing/deploy
  は不変。`refactor-instructions.md` の広範な Markdown formatting churn は未コミットのまま残置。

## 2026-07-04 W3-B9 online shared monthly cap ae81a9f7

- 分類: billing correctness / online monthly cap sharing。
- land: `ae81a9f7 fix(billing): apply shared online monthly caps`。
  `monthly_cap_shared` の base rule が explicit `monthly_cap` を持たない場合も、通常月4回・特別患者月8回/週2回の
  shared cap を rule-engine 側で適用。
- 変更: `src/server/services/billing-rules/rule-engine.ts` と
  `src/server/services/billing-rules/rule-engine.test.ts`。医療オンライン59点、介護オンライン46単位、
  null special-cap 値からの fallback を focused test で固定。
- 検証: billing focused Vitest `3 files / 109 tests` green、exact ESLint green、exact
  Prettier check green、targeted `git diff --check` green、full `pnpm typecheck` green。
- 安全性: DB/migration/auth/authorization/API payload/PHI logging/deploy/package dependencies は不変。
  算定上限の過小適用を防ぐ fail-closed 寄りの修正。

## 2026-07-04 Codex CLI 0.142.5 / subagent persona optimization

- 分類: developer/runtime operations / Codex CLI profile and custom-agent persona。
- update: `/Users/yusuke/.nvm/versions/node/v24.16.0/bin/codex update` は成功。
  実バージョンは `codex-cli 0.142.5` のままで、最新版としてローカル整合。
- 変更:
  - `~/.codex/config.toml`: bare `codex` 既定を `gpt-5.5` + low reasoning +
    cached web + `service_tier="fast"` に調整し、`agents.max_depth=1`。
  - `~/.codex/implement.config.toml` / `~/.codex/plan.config.toml`:
    direct subagent delegation only の `max_depth=1`。
  - `~/.codex/agents/*.toml`: 共通 persona contract を v3(Codex 0.142+)へ更新。
  - `.codex/agents/*.toml`: direct child / no recursive fan-out / explicit verdict rule を追加。
  - `AGENTS.md`、`.agent-loop/README.md`、`.codex/config.toml`、本 STATE:
    agmsg/codex2/codex3/codex4/Claude なし、Codex CLI direct subagents ありの運用へ整合。
- 検証: official Codex manual fetch current、Codex strict doctor `16 ok / 0 fail`、
  TOML `63 files` parse ok、Markdown Prettier ok、targeted `git diff --check` ok。
  Prettier は TOML parser 不在のため TOML には使わず、`tomllib` + strict doctor を採用。
- 安全性: product source/API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
  ローカル Codex config と operator/persona 文書のみ。

## 2026-07-04 R21 report edit form sonner mock

- 分類: test-harness cleanup / R21 sonner mock residual。
- 実施: `src/components/features/reports/report-edit-form.test.tsx` の local partial `sonner`
  mock を既存 `createSonnerToastMock()` helper へ置換。
- 変更ファイル: `src/components/features/reports/report-edit-form.test.tsx`。
- 削除したコード: test-local の `success` / `error` のみの partial mock。
- 共通化した処理: sonner toast mock surface を `src/test/sonner-test-utils.ts` に統一。
- 挙動変更: なし。test-only で product runtime source は不変。
- FE/BE整合性への影響: なし。
- UI配置への影響: なし。
- 性能への影響: なし。
- 検証: focused Vitest `2 files / 7 tests` green、exact ESLint green、exact
  Prettier check green、targeted `git diff --check` green。
- 残課題: R21 の他の sonner mock residual は引き続き段階移行対象。
- 次アクション: 単独 Codex 運用で、次の安全な R21/R55/R40 系 slice を選ぶ。

## 2026-07-04 Single Codex operation switch

- 分類: operator workflow / agmsg multi-agent shutdown。
- 実施: ユーザー指示に従い、現行 SSOT を Codex 単独運用へ更新。
  agmsg、codex2/codex3/codex4、Claude、subagent、PATCH_REPORT 待ち、外部
  maker/checker handoff はユーザーが明示的に再有効化するまで使わない。
- 変更: `AGENTS.md`、`.agent-loop/README.md`、`ops/refactor/STATE.md`。
  17:53 の Codex CLI/subagent persona 記録は履歴として残すが、現行運用はこの単独運用設定を優先。
- 検証: `git diff --check -- AGENTS.md ops/refactor/STATE.md .agent-loop/README.md` green、
  `./node_modules/.bin/prettier --check AGENTS.md ops/refactor/STATE.md .agent-loop/README.md` green。
- 安全性: process/docs-only。product source/API/DB/auth/authorization/PHI/billing/deploy/package dependency は不変。
- 残課題: `.codex/config.toml` / `.codex/agents/*.toml` /
  `src/components/features/reports/report-edit-form.test.tsx` / `refactor-instructions.md` の dirty diff は
  別スライスとして保持し、この切替には混ぜない。
