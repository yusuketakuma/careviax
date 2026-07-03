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

## 2026-07-03 R07 pending verdict

- 分類: dead-code removal / behavior-preserving cleanup
- 対象: `src/lib/dashboard/home-config.ts` + 自テスト
- 実施: 外部参照0の dashboard home config（358行）と、その config のみを検証していたテスト（95行）を削除。
  `home-link-builders.ts` は18以上の生存 consumer があるため保持。
- 挙動変更: なし。runtime import なし、route/config/script/型のみ参照なし。docs の生きた参照なし、archive 参照のみ残置。
- 検証: export symbol 静的 `rg` 0件。`home-link-builders.test.ts` 4/4 green。scoped eslint green。
  `tsc --noEmit --pretty false` green、home-config 該当エラー grep 0件。
- レビュー: opus verdict 待ち。self-commit なし。

## 2026-07-03 までのスライス（要約、詳細は archive/ と git log）

- Claude lane: Wave2 完了バッチ(9 commits) / W3 code-only(C2/E2/E3, 4 commits) /
  W3-E2/E3 残(3 commits) / W3-B4 中核 52ce1f66 / B6 設計 3a39f69e / Plans 台帳 4cf5bc3b
- codex lane: BE-1 036e05e7 / b33c71b8 / RT1 e8027e51 / RR-QP-A 1b9b5366 / RR-QP-B 07cd78a1 /
  JOB1 c025b133 / JOB2 d6cdc59a / CW1 f15f9f98 / BM1 5be6ebca / billing-candidates 9d1567ba
  — 全て opus APPROVE（9d1567ba/b33c71b8 は post-commit 承認）
- gate: 全量 green（test 13033 / lint / format / colors / typecheck / no-unused / build）
