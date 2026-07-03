# 日次 cron 全org横断クエリ 判定台帳（W0-8）

在宅訪問薬局プラットフォームの daily ジョブは、org context を張らない基底 `prisma`
クライアント（`src/lib/db/client.ts`）で **全org横断**にレコードを走査する。本台帳は
その各クエリが「システム全体 cron としての意図的な全org処理（by-design）」か「テナント
分離を破る漏洩（leak）」かを、コードを追って判定した結果を記録する SSOT である。

判定日: 2026-07-03 / 対象ブランチ: `refactor/repo-quality-loop-20260701`

## 判定の共通観点

各クエリについて以下 3 点を確認した:

- **(a) 全org処理の意図**: システム全体 cron として全org を一括処理するのが設計意図か。
- **(b) org 毎分割の要否**: org 毎に分割実行すべき（= 全org横断が過剰）か。
- **(c) 出力の org 境界越え**: 走査結果から生成する通知・タスク・レポート等が org 境界を
  跨いで別org のユーザーに届かないか。

## 全体構造（by-design の根拠）

- daily ジョブは Amplify/CloudWatch 起点のシステム cron（`runner.ts` の `runJob`）から
  呼ばれ、特定 org に紐づかない。読み取りフェーズで全org のレコードを集約し、書き込み
  フェーズで **行が持つ `org_id` 単位** に処理を分岐する 2 段構成を全ジョブが踏襲する。
- 書き込みは `withOrgContext(row.org_id, tx => ...)`（RLS セッション変数を張る）内で行うか、
  もしくは各行に `org_id` を明示付与した `createMany`/`syncGeneratedOperationalTasks` を使う。
- 通知の宛先ユーザーは `findAdminUserIdsByOrg` / `findPrimaryPharmacistIdsForActiveCases`
  （`daily/shared.ts`）で **org 毎に bucket 化した Map** から `Map.get(row.org_id)` で引くため、
  ある org の行が別org のユーザーに配信されることはない（`orgPatientKey` は org_id を含む）。
- 以上より、全org横断は「1 プロセスで全テナントを回す cron」という意図的設計であり、
  出力は各行の org に閉じる。**今回精査した範囲に leak は無し**。

## 判定一覧

| #   | 箇所                                                          | クエリ対象                                              | 判定          | 理由（(a)/(b)/(c)）                                                                                                                                                               | 残存リスク                                             |
| --- | ------------------------------------------------------------- | ------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | `src/server/jobs/daily/conferences.ts:22`                     | `conferenceNote.findMany`（担当者会議リマインダ）       | **by-design** | (a) 全org一括のリマインダ cron。(b) 分割不要。(c) 通知は `withOrgContext(note.org_id)` 内で dispatch、宛先 `primaryPharmacistId` は `note.case_id`→同一org の `careCase` から解決 | 低。`case_id`→`careCase` の org 一致は参照整合性に依存 |
| 2   | `src/server/jobs/daily/followups.ts:59`                       | `visitScheduleContactLog.findMany`（折り返し期限超過）  | **by-design** | (a) 全org一括。(c) タスクは `withOrgContext(log.org_id)`、担当者は同一行の `proposal` から解決                                                                                    | 低                                                     |
| 3   | `src/server/jobs/daily/followups.ts:102`                      | `residence.findMany`（ジオコード品質）                  | **by-design** | (a) 全org一括。(c) タスクは `withOrgContext(residence.org_id)`、担当者は同一org の `patient.cases` から解決                                                                       | 低                                                     |
| 4   | `src/server/jobs/daily/followups.ts:159`                      | `patientSelfReport.findMany`（自己申告フォロー）        | **by-design** | (a) 全org一括。(c) タスク/通知は `withOrgContext(report.org_id)`、宛先は `report.patient_id`(同一org)の `careCase` から解決                                                       | 低                                                     |
| 5   | `src/server/jobs/daily-prescription-original-retention.ts:35` | `prescriptionIntake.findMany`（原本保存期限）           | **by-design** | (a) 全org一括。(c) `notification` は各行 `intake.org_id` を付与、宛先は org 毎 bucket の `adminsByOrg.get(intake.org_id)` + 同一org の `primary_pharmacist_id` に限定             | 低                                                     |
| 6   | `src/server/jobs/daily/cleanup.ts:13`                         | `qrScanDraft.findMany`（放置ドラフト破棄）              | **by-design** | (a) 全org横断の保守ジョブ。(c) 結果は in-place スクラブ（discarded 化）のみで通知・レポート出力なし                                                                               | 低                                                     |
| 7   | `src/server/jobs/daily/compliance-expiry.ts:31`               | `facilityStandardRegistration.findMany`（施設基準期限） | **by-design** | (a) 全org一括。(c) 通知は各行 `reg.org_id` を付与、宛先は org 毎 bucket の `adminUserIdsByOrg.get(reg.org_id)` に限定                                                             | 低                                                     |

（行番号は本コミットのコメント追記後の値。）

## 同一ファイル内の同型クエリ（同判定・参考）

W0-8 で列挙された 7 箇所と同じ 2 段構成に従う、同一ファイル内の他の全org横断クエリも
**すべて by-design**（出力は行の org に閉じる）。コメント追記は列挙された 7 箇所に限定した。

- `followups.ts`: `managementPlan.findMany`（次回見直し）/ `communityActivity.findMany`
  （地域活動フォロー）— それぞれ `withOrgContext(row.org_id)` で書き込み。
- `daily-prescription-original-retention.ts`: `prescriptionIntake.findMany`（FAX原本未回収の
  overdue 分）— `intake.org_id` 付き `notification` + org 毎 bucket 宛先。
- `cleanup.ts`: `qrScanDraft.updateMany`（terminal ペイロード scrub）— in-place のみ。
- `compliance-expiry.ts`: `pharmacistCredential.findMany` / `consentRecord.findMany` /
  `patientInsurance.findMany`（公費期限。`context.orgId` 指定時は単org へ絞り込み可）—
  いずれも org 毎 bucket 宛先。

## 結論

精査した全org横断クエリはいずれも「システム全体 cron が全テナントを 1 プロセスで処理し、
出力を各行の `org_id` 単位に閉じる」意図的設計であり、org 境界を跨ぐ通知・タスク・
レポートの漏洩は確認されなかった。**コード修正は不要**（本タスクではコメント追記のみ）。
