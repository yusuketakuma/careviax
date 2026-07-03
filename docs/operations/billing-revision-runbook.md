# 診療報酬・薬価・介護報酬改定 運用 Runbook

## 目的

医療保険（診療報酬・2年周期）・薬価（随時〜年1-2回）・介護保険（介護報酬・3年周期）の改定を、
`src/server/services/billing-rules/revisions/` の改定レジストリと `src/server/services/drug-master-import/mhlw.ts`
の薬価インポータへ安全に反映するための手順を定義する。

## 前提（実コードで確認済みの構造）

- 改定レジストリの SSOT は `src/server/services/billing-rules/revisions/index.ts`。
  医療保険は `MEDICAL_REVISIONS`、介護保険は `CARE_REVISIONS`、両方を合成した `ALL_REVISIONS` を公開する。
- 各改定は `revisions/medical/<年>.ts`（例: `2024.ts` / `2026.ts`）または `revisions/care/<年>.ts` に
  `BillingRevision`（`code` / `label` / `effectiveFrom` / `effectiveTo` / `source` / `status`）と
  `BillingRuleSeed[]` のペアとして定義する。`status` は `'draft' | 'confirmed'`（省略時 `confirmed` 扱い）。
- `resolveRevisionEntryForDate()` は `status !== 'draft'` の改定だけを対象に、`effectiveFrom` が新しい順にソートして
  対象日を含む改定を1件返す（`includeDraft` を明示的に渡さない限り draft は選択されない。現状 `includeDraft: true` を
  渡す呼び出し元はコード上に存在しないため、`status: 'draft'` の改定は本番導線では常に無効）。
- 改定 config（`revisions/medical/site-config-2024.ts` / `site-config-2026.ts`、`care/site-config-2024.ts`）は
  調剤基本料・地域支援体制加算・後発品調剤体制加算・在宅薬学総合体制加算など、薬局マスター
  （`PharmacySiteBillingConfig`）で管理する点数テーブルを保持する。official reference（`official-2024.ts` /
  `official-2026.ts`）と突合するテストが `__tests__/official-medical-2026.test.ts` などにある。
- `BillingRule` テーブルへの反映は **手動 DB 操作ではなく `ensureHomeCareBillingSsot()`（`revisions/../seeder.ts`）が
  リクエスト時に自動で行う**。`buildBillingCandidateSpecs()`（`rule-engine.ts`）が候補生成のたびに
  `context.asOfDate` で `ensureHomeCareBillingSsot(tx, orgId, { asOfDate })` を呼び、
  `resolveRevisionEntryForDate()` で解決した改定のルールを `is_system: true` として upsert し、
  対象外になった `ssot_key` を `deleteMany` で削除する。**改定レジストリへ登録してデプロイすれば
  DB 側は自動で追従する。改定ごとの手動マイグレーション／シードは不要。**

## (1) 点数改定（診療報酬改定・医療保険 / 2年周期: 2024, 2026, 2028, ...）

1. `revisions/medical/<西暦>.ts` を新規作成する。既存の `revisions/medical/2026.ts` を雛形にする。
   - `BillingRevision`: `code`（例 `'2028'`）、`label`（例 `'令和10年度 診療報酬改定'`）、
     `effectiveFrom`（施行日、通常 6/1）、`effectiveTo: null`（現行改定として登録）、
     `source`（厚労省の告示・通知ページ URL）、`status: 'draft'`（点数未確定の間はドラフトとして安全に隔離する）。
   - `BillingRuleSeed[]`: 既存改定の `ssot_key` を可能な限り引き継ぎ、点数・算定要件（`conditions` /
     `evidence_requirements` / `exclusion_rules`）が変わった項目だけを更新する。新設項目は新しい `ssot_key` /
     `code` を追加する。`source_url` / `source_note` に根拠 URL・点数を明記する（既存ファイルの形式に倣う）。
2. `revisions/medical/index.ts` に新ファイルの re-export を追加し（`MEDICAL_REVISION as MEDICAL_2028_REVISION`,
   `MEDICAL_RULES_2028` のように改名）、`revisions/index.ts` の import と `MEDICAL_REVISIONS` 配列に追記する。
3. 旧改定ファイル（例 `revisions/medical/2026.ts`）の `effectiveTo` を新改定の施行日前日（例 `2028-05-31`）に設定する。
   これにより `resolveRevisionEntryForDate()` が施行日境界で正しく切り替わる（`revision-resolution.test.ts` の
   `2026-05-31` / `2026-06-01` 境界テストと同じパターン）。
4. 公式点数突合テストを追加する。`revisions/medical/official-<西暦>.ts` に
   `MEDICAL_<年>_OFFICIAL_SOURCES`（厚労省 URL 一式）・`MEDICAL_<年>_OFFICIAL_SITE_CONFIG_POINTS`・
   `MEDICAL_<年>_OFFICIAL_RULE_POINTS`（`code` → `amount` のマップ）を定義し、
   `__tests__/official-medical-<西暦>.test.ts` を `official-medical-2026.test.ts` に倣って作成する
   （`MEDICAL_RULES_<年>` の `amountByCode` が `MEDICAL_<年>_OFFICIAL_RULE_POINTS` に `toMatchObject` することを検証）。
5. `revisions/index.ts` の re-export（`MedicalSiteConfig<年>` 型・`resolveHomeComprehensivePoints<年>` 等）を
   新改定分に合わせて追加する。site config を参照する薬局マスター側のロジック（`billing-evidence/core.ts` の
   在宅薬学総合体制加算候補生成など）が新 revision_code を判定できるよう確認する。
6. Focused vitest を実行する: `pnpm exec vitest run src/server/services/billing-rules/__tests__ --reporter=dot`。
7. 点数が公式に確定したら `status: 'draft'` を削除する（または `'confirmed'` に変更）。ドラフト段階でレビュー・
   テストを済ませ、施行日にこのコミットをデプロイすれば `ensureHomeCareBillingSsot()` が自動で新点数へ切り替える。

## (2) 薬価改定（MHLW importer 実行・経過措置の扱い）

薬価は診療報酬改定と別サイクルで、厚労省が随時公開する Excel（薬価基準収載品目リスト）を
`src/server/services/drug-master-import/mhlw.ts` の importer で取り込む。ソースコードは
レジストリに新ファイルを追加する形ではなく、`DrugMaster` テーブルへの upsert で運用する。

1. 実行導線: 管理者権限（`canAdmin`）で `POST /api/drug-master-imports/mhlw-price`
   （`src/app/api/drug-master-imports/mhlw-price/route.ts`）を呼ぶ。
   - `dryRun: true` を指定すると `previewMhlwPriceList()` が変更点（`price_changed` /
     `transitional_expiry_changed`）をプレビューする（DB 書き込みなし）。
   - `dryRun` を省略/`false` にすると `importMhlwPriceList()` が実インポートを行う。
   - `workbookUrl` を省略すると `MHLW_MASTER_INDEX_PAGE_URL` から最新の Excel URL を自動解決する
     （`resolveLatestMhlwPriceWorkbookUrls()`）。手動で URL を指定する場合は
     `isAllowedImportSourceUrl()` のポリシー（`MHLW_IMPORT_URL_POLICY`）を満たす厚労省ドメインの URL のみ許可される。
2. **経過措置 `transitional_expiry_date` の扱い**: Excel の「経過措置による使用期限」列
   （`readCell(row, headerMap, '経過措置による使用期限')`）を `parseDate()` でパースし、
   `DrugMaster.transitional_expiry_date` に upsert する。旧薬価が経過措置期間中の医薬品を示すフィールドで、
   価格改定時にこの日付が変わった場合は `transitional_expiry_changed` として
   `DrugMasterChangeEvent`（`source: 'mhlw_price'`）に記録される（`collectMhlwPriceChanges()`）。
   - インポート前に必ず `dryRun: true` でプレビューし、`change_event_types` に
     `transitional_expiry_changed` が含まれる件数・対象品目を確認してから本実行する。
   - `transitional_expiry_date` は実装上バリデーションや業務ロジックでの自動的な使用期限超過アラートは
     import 処理自体には含まれない（`mhlw.ts` の範囲では DB へ保存するのみ）。期限管理・アラートが必要な場合は
     別途 `DrugMaster.transitional_expiry_date` を参照する仕組みの有無を確認すること（本 runbook の対象外）。
3. 実行後、`DrugMasterImportLog`（`source: 'mhlw_price'`）に成功件数・`sourceFileHash` /
   `sourcePublishedAt` が記録されることを確認する（`withImportLog()` 経由）。
4. 一般名処方マスタ（generic name mapping）は別 importer
   （`importGenericNameMappings()` / `previewGenericNameMappings()`、同じく `mhlw.ts`）で、
   `一般名処方マスタ（R8.4.1版） 全体` シートを読む。年1回の更新サイクルに合わせて別途実行する
   （`resolveLatestGenericNameWorkbookUrl()` が index ページから最新 Excel を解決）。
5. 後発品フラグ更新のみ行いたい場合は `importMhlwGenericFlags()` / `previewMhlwGenericFlags()` を使う
   （`drug_price` は更新せず `is_generic` のみ upsert）。
6. 定期ジョブ経路: `src/server/jobs/drug-master.ts` が `mhlw_price` の鮮度しきい値（120日）を管理し、
   古くなった場合に管理者通知を出す（`FRESHNESS_THRESHOLDS.mhlw_price = 120`）。手動実行後もこのジョブが
   最終更新日を追跡する前提のため、インポート成功時に `DrugMasterImportLog` が正しく残ることが重要。

## (3) 介護改定（介護報酬改定・3年周期: 2024, 2027, 2030, ...）

医療保険改定と手順はほぼ同じだが、周期が3年である点とファイル配置が異なる。

1. `revisions/care/<西暦>.ts` を新規作成する（`revisions/care/2024.ts` を雛形にする）。
   `BillingRevision.code` / `label`（例 `'令和9年度 介護報酬改定'`）/ `effectiveFrom` / `effectiveTo: null` /
   `source` / `status: 'draft'` を設定し、`BillingRuleSeed[]`（`CARE_RULES_<年>`）を定義する。
2. `revisions/care/index.ts` に re-export を追加する。
3. `revisions/index.ts` の `CARE_REVISIONS` 配列に追記する。同ファイルのコメントに
   `// { revision: CARE_2027, rules: CARE_RULES_2027 },  // ← 2027年改定時に追加` という該当箇所の
   プレースホルダが既にあるので、そこを実体に置き換える。
4. 旧介護改定（`revisions/care/2024.ts`）の `effectiveTo` を新改定の施行日前日に設定する。
5. `revisions/care/official-<西暦>.ts` に公式点数参照を追加し、`__tests__/official-care-<西暦>.test.ts` を
   `official-care-2024.test.ts` に倣って作成する。
6. Focused vitest（`src/server/services/billing-rules/__tests__`）を実行し、点数確定後に `status: 'draft'` を外す。

## (4) 注意: 請求エンジンの二重化（billing-rules ↔ `src/phos/domain/claim`）

- 現状、請求ロジックは `src/server/services/billing-rules/`（本 runbook の対象、`BillingRule` / SSOT レジストリ方式）と
  `src/phos/domain/claim/`（`claimCandidateLifecycle.ts` / `feeRuleDsl.ts`、別体系の請求候補・フィールールDSL）に
  **二重に存在する**。この収束（どちらに一本化するか）は `Plans.md` の **W1-13**
  （「請求エンジン二重化の収束決定（billing-rules ↔ `src/phos/domain/claim`）。**W2-B1 の前提**」）で
  決定待ちの未解決事項として管理されている。
- **W1-13 が決定されるまでは、点数改定・薬価改定・介護改定はすべて本 runbook の billing-rules 側
  （`revisions/`）へ載せること**。`src/phos/domain/claim` 側への改定反映は行わない
  （二重メンテナンスによる不整合を避けるため）。

## (5) レジストリ外ハードコード点数（W3-C2 で吸収されるまでの手動確認箇所）

改定レジストリ（`billing-rules/revisions/`）の外に、点数がハードコードされている箇所が存在する。
これらはレジストリに登録されていないため、**改定時に自動追従しない**。`Plans.md` の
**W3-C2「レジストリ外ハードコード点数吸収（旧C-2）」**でレジストリへ統合されるまでは、
改定のたびに以下を手動で確認・修正すること。

- `src/server/services/conference-sync.ts` の `CONFERENCE_BILLING_CONFIG`
  （カンファレンス種別ごとの `billing_code` / `billing_name` / `points` / `ssot_ref`）:
  - `pre_discharge`: `B011-6` 退院時共同指導料 600点
  - `service_manager`: `MED_INFO_PROVISION_2_HA` 服薬情報等提供料2 ハ 20点
  - `death_conference`: `C013` ターミナルケア管理料（在宅ターミナルケア加算）2500点
  - これらは `revisions/medical/<年>.ts` の対応する `ssot_key`（`medical.discharge_joint_guidance` /
    `medical.information_provision.2_care_manager` / `medical.addition.terminal_care`）の `amount` と
    値が重複しているため、改定でこれらの点数が変わった場合は `CONFERENCE_BILLING_CONFIG` も
    同じ値へ手動で更新する必要がある。
- 上記以外にもハードコード点数が残っている可能性があるため、改定作業時は
  `grep -rn "points:\s*[0-9]\+" src/server/services/` 等で `billing-rules/revisions/` 外の
  点数リテラルを洗い出し、レジストリの新点数と食い違っていないか確認すること
  （本 runbook 作成時点で確認できたのは `conference-sync.ts` のみ。W3-C2 実施までは新規箇所が
  増えていないか都度確認する）。

## 検証コマンド

```bash
pnpm exec vitest run src/server/services/billing-rules/__tests__ --reporter=dot --testTimeout=60000
pnpm exec vitest run src/server/services/drug-master-import/mhlw.test.ts --reporter=dot --testTimeout=60000
```

## 完了条件

- 新改定ファイルが `revisions/index.ts`（医療）または `revisions/care/index.ts` 経由で登録され、
  旧改定の `effectiveTo` が施行日前日に設定されている。
- 公式点数突合テスト（`official-medical-<年>.test.ts` / `official-care-<年>.test.ts`）が追加され green。
- 点数確定後、新改定の `status: 'draft'` が外れている（未確定のまま `confirmed` にしない）。
- 薬価改定の場合、`dryRun` プレビューで `transitional_expiry_changed` 件数を確認したうえで本実行し、
  `DrugMasterImportLog` に成功記録が残っている。
- `CONFERENCE_BILLING_CONFIG`（`conference-sync.ts`）など既知のレジストリ外ハードコード点数が
  新点数と一致している。
