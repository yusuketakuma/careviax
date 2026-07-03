# 医薬品マスター 本番初期ロード Runbook

新規環境（本番 Amazon RDS PostgreSQL）に対して、医薬品マスター関連テーブル
（`DrugMaster` / `DrugPackage` / `GenericDrugMapping` / `DrugPackageInsert` /
`DrugInteraction` / `DrugAlertRule`）を空の状態からロードするための実行手順書。
実装済みの importer（`src/server/services/drug-master-import/*`）・API route・
管理画面・日次ジョブを実行経路として使う。**本ドキュメントは手順のみを定義し、
実際の初期ロード実行は行わない。**

対象読者: 新規環境の立ち上げを行う運用担当者・管理者権限を持つオペレーター。

---

## 1. 前提条件

- 実行者は `canAdmin` 権限を持つ管理者アカウント（組織の owner/admin ロール）でログイン済み、
  もしくは自動実行用の `JOB_API_KEY`（`x-api-key` ヘッダ）を保有していること。
  - `/api/drug-master-imports/*`（SSK/HOT/MHLW/PMDA/manual-clinical の個別取込 API）は
    `requireAuthContext(canAdmin)` のみを受け付ける。**`JOB_API_KEY` では呼び出せない。**
  - `/api/jobs/{jobType}`（日次ジョブ経由の一括更新）は `requireApiKeyOrAuthContext` のため
    管理者セッション・`JOB_API_KEY` のどちらでも呼び出せる（`.env` の `JOB_API_KEY` を
    `x-api-key` ヘッダに設定）。
- 対象は `ap-northeast-1` の RDS。本番 DB への直接 `psql` 接続は
  `docs/operations/production-migration-runbook.md` 同様に bastion 経由が前提だが、
  本手順の検証は基本的に **アプリ API 経由**（`GET /api/drug-master-imports/status`,
  `GET /api/drug-master-import-logs`）で完結させ、直接 SQL 接続は必須としない。
- 事前に `pnpm db:migrate` でスキーマが適用済みであること（migration 適用手順は本書の対象外、
  `docs/operations/production-migration-runbook.md` 参照）。
- 環境変数（Secrets Manager 経由推奨、平文 `.env` へ保存しない）:

  | 変数                               | 用途                                                 | 本手順での要否                                         |
  | ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
  | `JOB_API_KEY`                      | `/api/jobs/*` 呼び出し認証                           | 日次ジョブ経由で自動化する場合は必須                   |
  | `HOT_MASTER_URL`                   | HOT コードマスター配布 URL（MEDIS ライセンス取得後） | HOT 取込時に必須（`fileUrl` body でも代替可）          |
  | `PMDA_PACKAGE_INSERT_FULL_URL`     | PMDA 添付文書 全量 ZIP URL                           | PMDA 取込時のみ（§5 参照、外部登録待ち）               |
  | `PMDA_PACKAGE_INSERT_DELTA_URL`    | PMDA 添付文書 差分 ZIP URL                           | PMDA 取込時のみ（§5 参照、外部登録待ち）               |
  | `DRUG_MASTER_IMPORT_ALLOWED_HOSTS` | importer が許可する追加ホスト（通常未設定）          | 通常不要（SSK/MHLW/HOT/PMDA は固定許可ホストで足りる） |

  SSK・MHLW（薬価/一般名）は取込元 URL を毎回公式ページから自動解決するため、
  URL 用の環境変数は不要（§3.1・§3.3 参照）。

- 実行経路は 3 通りあり、状況に応じて使い分ける。

  | 経路                                                   | 対象ソース                                          | 認証                                             | 特徴                                                                                                                                                                                                                                                 |
  | ------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 管理画面 `/admin/drug-masters`                         | SSK / MHLW薬価 / MHLW一般名 / HOT / PMDA(delta固定) | 管理者ログイン（ブラウザセッション）             | Dry-run プレビュー → 実行の 2 段階 UI。取込ログ・ステータスも同画面で確認可能。PMDA ボタンは `mode: 'delta'` 固定で初回全量ロードには使えない。manual-clinical 用のボタンは無い。                                                                    |
  | 直接 API 呼び出し（`POST /api/drug-master-imports/*`） | 全ソース（manual-clinical・PMDA full 含む）         | 管理者セッション（`canAdmin`）                   | URL・`limit`・`mode` 等を細かく指定できる唯一の経路。manual-clinical と PMDA `mode=full` はここでしか実行できない。                                                                                                                                  |
  | 日次ジョブ経由（`POST /api/jobs/{jobType}`）           | SSK / MHLW(薬価+一般名+後発)                        | `x-api-key: $JOB_API_KEY` または管理者セッション | curl/CLI からワンコマンドで実行できる。URL は常に自動解決（カスタムURL指定不可）。HOT/manual-clinical のジョブ handler は存在しない（PMDA は delta 専用の `pmda-package-insert-refresh` のみ存在し、full ロードのジョブ経路は無い。§5 手順5 参照）。 |

---

## 2. 推奨実行順序と依存関係

**SSK → HOT → MHLW（薬価/一般名） → manual-clinical** の順で実行する。

- SSK が `DrugMaster` の基盤レコード（`yj_code` を一意キーとする全件）を作る。
  HOT・MHLW はいずれも既存の `DrugMaster` 行を `upsert`／`findMany` で参照・拡張する実装なので、
  **SSK を先に完了させる**（`refreshAllFreeDrugMasters` のコード内コメントも同順序を明記）。
- HOT は `yj_code` が未存在でも `DrugMaster` をプレースホルダ作成できる実装だが、
  その場合 `drug_name` が `yj_code` そのもの・薬価/薬効分類等が空のまま残るため、
  **SSK 完了後に実行**して完全なレコードへ `hot_code` を紐付ける。
- MHLW 薬価は `DrugMaster.findMany` で既存 YJ コードに一致する行のみ更新する
  （新規 `DrugMaster` は作らない）。SSK が先に入っていないと 0 件になる。
- MHLW 一般名/後発（`mhlw-generic`, `mode=all`）は「薬価ワークブックの後発品フラグ」と
  「一般名処方マスタの成分マッピング」の 2 系統を同時に取り込む。どちらも既存
  `DrugMaster` の `yj_code` に一致させる実装のため、SSK/MHLW 薬価の後に実行する。
- manual-clinical（高齢者 PIM・腎機能調整・高リスク薬アラート等）は既存 `DrugMaster` の
  `yj_code` / `therapeutic_categories` に対する `DrugAlertRule` を追加するのみで、
  他ソースの完了に依存しないが、**紐付け対象の `DrugMaster` が存在した状態で流し込む方が
  検証しやすいため最後に実行する。**
- PMDA は外部登録が完了していないため本ドキュメントでは初期ロード対象から分離する（§5）。

---

## 3. 初期ロード手順

### 3.1 Step 1: SSK 基本マスター 全件取込

- **実行経路**: 管理画面「SSK全件取込」ボタン、または
  `POST /api/drug-master-imports/ssk`（body 省略可、URL は SSK 公式ページから自動解決）。
  自動化したい場合は `POST /api/jobs/drug-master-refresh`（`x-api-key` 認証）でも同じ処理が走る
  （dedupe key によりハッシュ同一なら再実行してもスキップされる）。
- **所要目安**: 全件約 18,000〜19,000 件（2026-06 時点確認値）。ZIP 取得＋パース＋200件単位
  chunk upsert のため、数分程度（ネットワーク・RDS レイテンシ依存）。
- **Dry-run 推奨**: 初回は必ず `dryRun: true` でプレビューし、`parsed_records` 件数・
  サンプル行が妥当かを確認してから本実行する。

  ```bash
  # プレビュー
  curl -sS -X POST "$APP_URL/api/drug-master-imports/ssk" \
    -H "Cookie: $ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
    -d '{"dryRun": true, "previewLimit": 20}'

  # 本実行
  curl -sS -X POST "$APP_URL/api/drug-master-imports/ssk" \
    -H "Cookie: $ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
    -d '{}'
  ```

  ジョブ経由で自動化する場合:

  ```bash
  curl -sS -X POST "$APP_URL/api/jobs/drug-master-refresh" -H "x-api-key: $JOB_API_KEY"
  ```

- **検証**:
  - レスポンスの `data.importedCount` が想定件数（1万件以上）であること。
  - `GET /api/drug-master-import-logs?source=ssk&limit=1` で最新ログが `status: "completed"`、
    `record_count` が同件数であること。
  - `GET /api/drug-master-imports/status` の `sources[].source === "ssk"` で
    `freshness: "fresh"`、`totals.drug_master_count` が `importedCount` と概ね一致すること。
- **実行証跡**: `DrugMasterImportLog`（`source: "ssk"`, `status`, `record_count`,
  `source_file_hash`, `source_published_at`, `import_mode`）に自動記録される。
  追加の手動記録は不要。

### 3.2 Step 2: HOT コードマスター取込

- **前提**: MEDIS-DC「標準マスター」利用許諾を取得し、配布 URL を入手済みであること
  （`docs/drug-code-master-architecture.md` 参照）。取得した URL を Secrets Manager /
  環境変数 `HOT_MASTER_URL` に設定するか、リクエスト body の `fileUrl` に渡す。
  未設定の場合は importer が `Error('HOTコードマスタ URL が未設定です...')` を投げて失敗する。
- **実行経路**: 管理画面「HOT取込」ボタン、または `POST /api/drug-master-imports/hot`。
  **ジョブ経由の自動実行は無い**（`JOB_HANDLERS` に HOT 用エントリが存在しない）ため、
  必ず管理画面または直接 API で実行する。
- **所要目安**: HOT ファイルサイズ次第（policy 上限 128MiB）。SSK より件数が多いことがあるため
  数分〜10分程度を見込む。
- **Dry-run 推奨**: SSK と同様に `dryRun: true` で `drug_master_upsert_count` /
  `package_upsert_count` / `skipped_missing_yj` 等のサマリを確認してから本実行する。

  ```bash
  curl -sS -X POST "$APP_URL/api/drug-master-imports/hot" \
    -H "Cookie: $ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
    -d '{"dryRun": true, "previewLimit": 20}'

  curl -sS -X POST "$APP_URL/api/drug-master-imports/hot" \
    -H "Cookie: $ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
    -d '{}'
  ```

- **検証**:
  - `data.importedCount`（DrugMaster 更新件数）・`data.packageImportedCount`（DrugPackage 件数）
    がプレビューの `drug_master_upsert_count` / `package_upsert_count` と一致すること。
  - `GET /api/drug-master-imports/status` の `totals.hot_code_coverage`
    （`DrugMaster.hot_code IS NOT NULL` の割合）が SSK 全件に対して妥当な水準まで上がっていること。
  - `skipped_missing_yj` / `skipped_invalid_yj` / `skipped_invalid_package_code` が
    異常に多くないか（レコードフォーマット変化の兆候）を確認する。
- **実行証跡**: `DrugMasterImportLog`（`source: "hot"`）。

### 3.3 Step 3: MHLW 薬価・一般名処方マスタ取込

薬価基準収載品目リストと一般名処方マスタはどちらも厚労省ページから最新版 URL を自動解決するため、
URL 指定なしで実行できる（無料・登録不要ソース）。

- **実行経路**: 管理画面「薬価更新」＋「一般名/後発更新」ボタン、または
  `POST /api/drug-master-imports/mhlw-price` と `POST /api/drug-master-imports/mhlw-generic`
  （`mode: "all"`）。自動化したい場合は `POST /api/jobs/drug-reference-refresh`
  （薬価＋一般名フラグ＋一般名マッピングを 1 コールで実行）でも可。
  さらに SSK＋MHLW をまとめて実行したい場合は `POST /api/jobs/drug-master-auto-refresh`
  （SSK 完了後に MHLW を実行する順序制御込み）を使うと Step 1 と Step 3 を 1 リクエストに集約できる。
- **所要目安**: 薬価ワークブック・一般名処方マスタワークブックのダウンロード＋Excel パース
  （`exceljs`）のため数分程度。
- **Dry-run 推奨**: `dryRun: true` で `changed_flag_count` / マッピング差分件数を確認する。

  ```bash
  # 薬価
  curl -sS -X POST "$APP_URL/api/drug-master-imports/mhlw-price" \
    -H "Cookie: $ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" -d '{}'

  # 一般名/後発（flags + mappings 両方）
  curl -sS -X POST "$APP_URL/api/drug-master-imports/mhlw-generic" \
    -H "Cookie: $ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
    -d '{"mode": "all"}'

  # まとめて自動化する場合
  curl -sS -X POST "$APP_URL/api/jobs/drug-reference-refresh" -H "x-api-key: $JOB_API_KEY"
  ```

- **検証**:
  - `GET /api/drug-master-imports/status` で `sources[].source` が `mhlw_price` /
    `mhlw_generic` ともに `freshness: "fresh"` であること。
  - `totals.generic_mapping_count`（`GenericDrugMapping` 件数）が 0 より大きいこと。
  - `mhlw-price` レスポンスの `change_summary`（価格差分要約）が異常な全件変更（初回のため
    「既存無し→新規作成」が大半になるのは正常）になっていないか目視確認する。
  - **既知のリスク**: 一般名処方マスタのシート名（例:
    `一般名処方マスタ（R8.4.1版） 全体`）はコード上で年度版を含めた文字列に一致させている
    （`parseGenericNameWorkbook` in
    `src/server/services/drug-master-import/mhlw.ts`）。厚労省が年度更新でシート名を
    変更した場合、`Excel ワークシート 'X' を解決できませんでした` で失敗する。失敗時は
    最新ワークブックのシート名を確認し、コード側の定数更新が必要か判断する（§6 参照）。
- **実行証跡**: `DrugMasterImportLog`（`source: "mhlw_price"`, `source: "mhlw_generic"`）。
  `mhlw-generic` は flags と mappings で個別に 2 件のログが作成される。

### 3.4 Step 4: manual-clinical 手動臨床ルール取込

- **前提**: 事前に投入する JSON バンドルを用意する。**リポジトリ内に既製のバンドルファイルは
  存在しない**（`CLAUDE.md` の医薬品マスタ一覧が示すとおり、高齢者 PIM リスト
  （厚労省 PDF）・腎機能別用量調整（JSNP PDF）は元データが PDF のため手動構造化が前提）。
  臨床チーム／薬剤師監修で以下のスキーマ（`manualClinicalRuleBundleSchema` in
  `src/server/services/drug-master-import/manual.ts`）に沿った JSON を作成する。

  ```jsonc
  {
    "pim_rules": [
      {
        "condition": { "yj_codes": ["..."], "therapeutic_categories": ["..."] },
        "severity": "warning", // critical | warning | info
        "message": "...",
        "is_active": true,
      },
    ],
    "high_risk_rules": [
      /* 同上スキーマ */
    ],
    "renal_adjustments": [
      {
        "yj_code": "...",
        "dosage_adjustment_renal": [{ "egfr_min": 0, "egfr_max": 30, "recommendation": "..." }],
      },
    ],
    "drug_safety_overrides": [
      /* manual.ts 参照 */
    ],
  }
  ```

- **実行経路**: **管理画面にボタンは無い**。`POST /api/drug-master-imports/manual-clinical`
  への直接 API 呼び出しのみ（ジョブ handler も無い）。
- **所要目安**: バンドルの件数次第だが、通常は数百件規模でほぼ即時完了。
- **スコープの注意**: `withOrgContext(ctx.orgId, ...)` で実行されるが、実際に作成される
  `DrugAlertRule` は `org_id: null`（グローバル・全テナント共通）で保存される
  （`manual.ts` の `createMany` 参照）。**組織ごとに繰り返す必要は無く、1 回の実行で全組織に
  適用される。**

  ```bash
  curl -sS -X POST "$APP_URL/api/drug-master-imports/manual-clinical" \
    -H "Cookie: $ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
    --data-binary @manual-clinical-bundle.json
  ```

- **検証**:
  - レスポンスの `data.pimCount` / `data.highRiskCount` / `data.renalCount` /
    `data.safetyOverrideCount` がバンドルの件数と一致すること。
  - `GET /api/drug-master-imports/status` の `totals.active_alert_rule_count`
    （`org_id: null` かつ `is_active: true` の `DrugAlertRule` 件数）が想定件数だけ増えていること。
- **実行証跡**: `DrugMasterImportLog`（`source: "manual_clinical"`）。

---

## 4. 全体検証（初期ロード完了後）

1. `GET /api/drug-master-imports/status` を実行し、以下を確認する。
   - `sources[]` の `ssk` / `mhlw_price` / `mhlw_generic` / `hot` すべてが
     `last_success` を持ち `freshness` が `fresh` または `aging`（`stale`/`never` は NG）。
   - `totals.drug_master_count` が SSK 想定件数と一致。
   - `totals.hot_code_coverage` / `totals.drug_package_coverage` が MEDIS ライセンス
     取得済みなら妥当な水準（0% のままなら Step 2 未実施または失敗）。
   - `totals.generic_mapping_count` / `totals.active_alert_rule_count` が 0 でないこと。
2. `GET /api/drug-master-import-logs?limit=20`（source 未指定）で直近ログを一覧し、
   `status: "failed"` が残っていないか確認する。残っている場合は `error_log` を確認し §6 へ。
3. 管理画面 `/admin/drug-masters` を開き、任意の YJ コード・薬品名で検索して
   薬価・後発フラグ・HOT コードが表示されることを目視確認する（実データでの最終確認）。
4. `checkDrugMasterFreshness`（`POST /api/jobs/drug-master-freshness-check`）を一度実行し、
   鮮度アラートが（HOT/PMDA 除く free ソースについて）出ないことを確認する。

---

## 5. PMDA 添付文書（外部登録待ち）

PMDA 添付文書 importer（`src/server/services/drug-master-import/pmda.ts`）は実装済みだが、
**PMDA メディナビ／マイ医薬品集の外部登録が完了するまで実行できない**（配布 URL が
発行されないため）。初期ロードの必須ステップからは分離し、登録完了後に別途実施する。

登録手順・追加手順は既存の `docs/operations/pmda-onboarding-runbook.md` を正本とする。
概要のみ再掲する。

1. PMDA メディナビ登録＋マイ医薬品集の全医療用医薬品 XML 利用申請を完了する。
2. 発行された全量 ZIP / 差分 ZIP の URL を `PMDA_PACKAGE_INSERT_FULL_URL` /
   `PMDA_PACKAGE_INSERT_DELTA_URL` として Secrets Manager または環境変数に設定する
   （平文でリポジトリへ入れない）。
3. `pnpm pmda:onboarding:check` で登録状態・ドキュメント前提を確認する。
4. 初回は **全量ロード**を実行する（管理画面の PMDA ボタンは `mode: "delta"` 固定のため、
   初回全量は直接 API を使う）。

   ```bash
   curl -sS -X POST "$APP_URL/api/drug-master-imports/pmda" \
     -H "Cookie: $ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
     -d '{"mode": "full", "dryRun": true}'   # まずプレビュー

   curl -sS -X POST "$APP_URL/api/drug-master-imports/pmda" \
     -H "Cookie: $ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
     -d '{"mode": "full"}'
   ```

5. 以降の差分更新は管理画面の「PMDA取込」ボタン、または
   `POST /api/jobs/pmda-package-insert-refresh`（`x-api-key` 認証、`mode: "delta"` 固定）で
   定期実行する。
6. 検証: `GET /api/drug-master-imports/status` の `sources[].source === "pmda"` が
   `fresh`、`totals.package_insert_count` / `totals.interaction_count` が 0 より大きいこと。
   `DrugMasterImportLog`（`source: "pmda"`）に成功ログが残ること。

---

## 6. 失敗時のトラブルシュート

| 症状                                                     | 主な原因                                                                   | 対応                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `HOTコードマスタ URL が未設定です`                       | `HOT_MASTER_URL` 未設定・`fileUrl` 未指定                                  | MEDIS ライセンス取得状況を確認し、URL を設定してから再実行                                      |
| `PMDA 添付文書 ZIP URL が未設定です`                     | PMDA 未登録（§5 未完了）                                                   | §5 の登録手順を先に完了する                                                                     |
| `Excel ワークシート 'X' を解決できませんでした`          | 厚労省側でワークブックのシート名（年度版表記）が変更された                 | 最新ワークブックのシート名を確認し、`mhlw.ts` の定数更新が必要か開発チームへエスカレーション    |
| 入力値バリデーションエラー（`validationError`）          | 許可ホスト外の URL・`limit`/`previewLimit` 範囲外など                      | `SSK_IMPORT_URL_POLICY` 等の許可ホスト一覧・`requestSchema` の制約を確認して URL/値を修正       |
| `record_count` は多いが `hot_code_coverage` が 0% のまま | Step 2 (HOT) が未実施、または SSK より前に実行して upsert が中途半端       | Step 2 を（SSK 完了後に）再実行                                                                 |
| ジョブ経由の呼び出しが 401                               | `x-api-key` ヘッダ未設定、または `JOB_API_KEY` の値不一致                  | Secrets Manager の値と環境変数の設定を突き合わせる                                              |
| `dryRun` レスポンスは正常だが本実行がタイムアウトする    | ZIP/ワークブックが大きく `withRoutePerformance` のタイムアウトに達している | `limit`（SSK）でチャンク分割実行するか、バックグラウンドジョブ経路（`/api/jobs/*`）に切り替える |

---

## 7. 完了条件チェックリスト

- [ ] SSK 全件取込が `completed` で記録され、`totals.drug_master_count` が想定件数
- [ ] HOT 取込が `completed` で記録され、`totals.hot_code_coverage` が妥当な水準（MEDIS ライセンス取得済みの場合）
- [ ] MHLW 薬価・一般名/後発（flags + mappings）が両方 `completed`
- [ ] manual-clinical バンドルが投入され、`active_alert_rule_count` が想定件数
- [ ] `GET /api/drug-master-imports/status` に `stale`/`never` の free ソースが残っていない
- [ ] `GET /api/drug-master-import-logs` に未解決の `failed` ログが残っていない
- [ ] （該当する場合）PMDA 外部登録が完了し §5 の全量ロードが完了している。未完了の場合は
      `docs/operations/pmda-onboarding-runbook.md` にフォローアップとして記録されていること
