# Phase 5 データマイグレーション検証フレームワーク (PRE-03)

## 目的

Phase 5 の各スキーマ変更（Json フィールド → 正規化テーブル）について、カットオーバー前後で
「移行漏れ」「NULL 不整合」「参照ズレ」を機械的に検知するための共通スクリプト。
`tools/scripts/migration-verify-template.ts` がフレームワーク本体、本ドキュメントはその使い方と
拡張手順の SSOT。

対象は **検証（pre-check / post-check）とバックフィル**であり、実 DB への実行は本番カットオーバー
作業の一部として別途行う。本ドキュメント自体は文書のみで、実 DB 操作は含まない。

---

## フェーズ一覧

| フェーズ | 対象                 | Json フィールド (旧)                                           | 正規化テーブル (新)                       | 現行 schema で実行可能か                                         |
| -------- | -------------------- | -------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| P-01     | アレルギー情報       | `"Patient".allergy_info`                                       | （`PatientAllergy` テーブルは存在しない） | ❌ stale                                                         |
| P-03     | 検査値 (lab_values)  | `"VisitRecord".structured_soap.objective.lab_values`           | `"PatientLabObservation"`                 | ✅ runnable                                                      |
| P-04     | 保険情報             | `"Patient".medical_insurance_number` / `care_insurance_number` | `"PatientInsurance"`                      | ❌ stale（カラム名不一致: 実体は `number`/`is_active`）          |
| P-06     | 性別 enum 正規化     | `"Patient".gender`                                             | — (in-place 正規化)                       | ❌ stale（20260404100100 で `"Gender"` enum 化・正規化適用済み） |
| P-07     | パッケージング設定   | `"Patient".packaging_preferences`                              | `"PatientPackagingProfile"`               | ❌ stale（20260404100200 で統合済み・元カラムは drop 済み）      |
| P-08     | アーカイブフィールド | — (新規カラム追加)                                             | `"Patient".archived_at`/`archived_by`     | ❌ stale（`is_archived`/`archive_reason` は実在しない）          |

> **重要（2026-07-03 監査）**: テーブル名は Prisma デフォルト命名の quoted PascalCase（例 `"VisitRecord"`）、
> カラム名は snake_case が実 DB の物理名。テンプレート内の SQL はこの実名で記述する（旧 snake_case テーブル名は
> 実 DB で即エラーになるため 2026-07-03 に全フェーズ修正済み）。
> P-01/P-04/P-06/P-07/P-08 は 2026-04-04 に本体 migration が適用完了した際の歴史的記録であり、
> 上表の理由により現行 schema に対しては実行できない（テンプレート構造の参考として保持）。
> 現行 schema で runnable なのは P-03 のみ。**新フェーズは必ず現行 schema（prisma/migrations の実 CREATE TABLE）
> に対して SQL を検証してから追加すること。**

### P-03 の analyte コード

`patient_lab_observations.analyte_code` の値一覧は **`prisma/schema/patient.prisma` の
`LabAnalyteCode` enum が正本**（wbc/neut/hb/plt/pt_inr/ast/alt/t_bil/scr/egfr/ck/crp/k/hba1c/tp/alb/
na/cl/bun/bnp/nt_pro_bnp/blood_glucose）。フレームワーク側は `Object.values(LabAnalyteCode)` で
機械的に導出しており、手書きの固定リストを持たない。enum の追加・削除は自動的に P-03 の集計・
バックフィル対象に反映される。

アプリ側の同期ロジック（`src/server/services/visit-record-derived-data.ts` の
`syncVisitRecordLabObservations`）は訪問記録の作成・更新のたびに `structured_soap.objective.lab_values`
を `patient_lab_observations` へ delete-then-insert で反映する。P-03 のバックフィルはこれと同じ抽出
ロジックを SQL で再現し、**その同期がまだ走っていない過去分の visit_record を追いバックフィル**する
位置づけ。

---

## 各フェーズの構成

`MigrationPhase` は 4 メソッドで構成される（`tools/scripts/migration-verify-template.ts`）。

1. **preCheck**: 移行前の母数を数える（対象患者数・対象レコード数など）。P-03 では
   訪問記録の総数・lab_values を含む件数・analyte 別件数を集計する。
2. **backfill**: Json → 正規化テーブルへの展開 SQL。二重挿入を避けるため、一意制約が
   無いテーブルに対しては `NOT EXISTS` ガードを入れる（P-03 は
   `source_visit_record_id + analyte_code + source_type='visit_record'` の組で判定）。
3. **postCheck**: バックフィル後の整合性検証。P-03 では以下の 3 点を検証する。
   - **件数一致**: Json から抽出できる analyte 件数 vs `patient_lab_observations` の
     `source_type='visit_record'` 実データ件数
   - **NULL integrity**: `value_numeric` / `source_visit_record_id` が NULL になっていないか
   - **source_visit_record_id 対応**: 参照する `visit_record` が実在するか
     （`source_visit_record_id` に外部キー制約が無いため明示チェックが必要）
4. **rollbackSql**: `--rollback` 指定時に backfill を巻き戻す SQL。**全 truncate ではなく
   由来（`source_type` 等）で範囲を絞る**のが原則。P-03 は
   `source_type = 'visit_record'` の行のみ削除し、manual/import 由来の検査値は保持する。

---

## 実行方法

```bash
# Pre-check のみ（SQL 実行なし）
pnpm tsx tools/scripts/migration-verify-template.ts --phase p03-lab-values --dry-run

# Backfill 実行 + Post-check
pnpm tsx tools/scripts/migration-verify-template.ts --phase p03-lab-values

# ロールバック（backfill の逆実行）
pnpm tsx tools/scripts/migration-verify-template.ts --phase p03-lab-values --rollback
```

`--phase` に指定できる値は `p01-allergy` / `p03-lab-values` / `p04-insurance` / `p06-gender` /
`p07-packaging` / `p08-archive`。

Post-check が失敗した場合はスクリプトが非ゼロ終了コードで終了する（`process.exit(1)`）。
CI/カットオーバー手順に組み込む場合はこの終了コードをゲートとして扱う。

---

## 新フェーズを追加する手順

1. `tools/scripts/migration-verify-template.ts` に `MigrationPhase` を満たすオブジェクトを追加
   （既存フェーズと同じ 4 メソッド構成、コメントスタイルを踏襲）。
2. コード一覧・enum 値など医療的に load-bearing な定数は、Prisma スキーマや既存アプリコードの
   定義から**機械的に導出**する（手書きリスト禁止）。P-03 の `LabAnalyteCode` がその例。
3. `phases` レコード（ファイル末尾のフェーズマップ）にキーを追加。
4. ファイル冒頭の JSDoc 使用例コメントに `--phase` の新しい値を追記。
5. 本ドキュメントの「フェーズ一覧」表と該当セクションを更新。
6. 巻き戻しが必要な変更であれば `docs/phase5-rollback-playbook.md` にもフェーズ別ロールバック
   SQL とロールバック順序を追記する（下記関係を参照）。

---

## `docs/phase5-rollback-playbook.md` との関係

- 本ドキュメント（検証フレームワーク）は **pre-check → backfill → post-check** の平時の検証手順。
- `phase5-rollback-playbook.md` は **本番カットオーバー失敗時に 30 分以内で復旧する**ための
  インシデント対応手順書（ロールバック順序・判断基準・SQL 抜粋）。
- 両者の `rollbackSql` は同じ意図（由来限定の巻き戻し）を共有するが、プレイブック側は
  インシデント対応の文脈でフェーズ逆順（P-08 → P-07 → P-04 → P-01 → P-06 …）の実行手順として
  整理されている。フェーズを追加した場合は両ドキュメントの整合を確認すること。
