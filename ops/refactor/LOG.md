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
