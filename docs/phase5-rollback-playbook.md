# Phase 5 ロールバックプレイブック (PRE-05)

## 概要

Phase 5 カットオーバー失敗時に 30 分以内に旧状態へ復旧するための手順書。
各スキーマ変更（P-01/P-04/P-06/P-07/P-08）ごとのロールバック SQL と判断基準を定義する。

---

## 即時ロールバック判断基準

以下のいずれかが確認された時点でロールバックを開始する：

| 条件 | 閾値 | 優先度 |
|---|---|---|
| API 5xx エラーレート | デプロイ後 5 分で > 1% | 最高 |
| 請求関連 API エラー | 任意の 5xx（件数不問） | 最高（請求データ最優先） |
| Backfill integrity check 失敗 | 患者数不一致 or NOT NULL 制約違反 | 高 |
| 患者詳細画面が表示不能 | 全患者で再現 | 高 |
| DB 接続エラー | migration 後に Prisma クライアント接続不可 | 最高 |
| `pnpm build` 失敗 | ビルドエラー | 高（デプロイ中止） |

> **原則**: 請求・保険情報に影響する異常は即時ロールバック。UI のみの軽微な表示崩れは段階対応可。

---

## ロールバック全体手順（30 分以内）

```
[0:00] 異常検知・判断
[0:05] Amplify で前バージョン Redeploy 開始
[0:10] アプリ旧バージョン起動確認（ヘルスチェック）
[0:12] ロールバック SQL 実行開始（フェーズ逆順: P-08 → P-07 → P-04 → P-01 → P-06）
[0:25] 全 SQL 完了・integrity check
[0:28] CloudWatch エラーレート正常化確認
[0:30] インシデントログ記録
```

---

## フェーズ別ロールバック SQL

### P-08: アーカイブフィールド削除

```sql
-- アーカイブ状態を CaseStatus に反映してから削除（データ損失防止）
UPDATE care_cases cc
SET status = 'terminated'
FROM patients p
WHERE cc.patient_id = p.id
  AND p.is_archived = true
  AND cc.status NOT IN ('discharged', 'terminated');

-- カラム削除
ALTER TABLE patients DROP COLUMN IF EXISTS is_archived;
ALTER TABLE patients DROP COLUMN IF EXISTS archived_at;
ALTER TABLE patients DROP COLUMN IF EXISTS archive_reason;
ALTER TABLE patients DROP COLUMN IF EXISTS archived_by;
```

### P-07: パッケージングプロファイル正規化の巻き戻し

```sql
-- PackagingProfile テーブルのデータを Json フィールドに書き戻す
UPDATE patients p
SET packaging_preferences = jsonb_build_object(
  'default_method', pp.default_packaging_method,
  'medication_box_color', pp.medication_box_color,
  'notes', pp.notes
)
FROM patient_packaging_profiles pp
WHERE pp.patient_id = p.id;

-- 新テーブル削除（外部キー順）
DROP TABLE IF EXISTS patient_packaging_profiles CASCADE;
```

> **注意**: `PatientPackagingProfile` は既存スキーマに存在するため、Phase 5 で新たに追加した拡張フィールドのみを対象とする。

### P-04: 保険情報の巻き戻し

```sql
-- PatientInsurance テーブルの primary レコードを patients へ書き戻す
UPDATE patients p
SET
  medical_insurance_number = pi.insurance_number,
  care_insurance_number    = pi.care_insurance_number
FROM patient_insurances pi
WHERE pi.patient_id = p.id
  AND pi.is_primary = true;

-- 新テーブル削除
DROP TABLE IF EXISTS patient_insurances CASCADE;
```

### P-01: アレルギー情報の巻き戻し

```sql
-- PatientAllergy テーブルを Json に集約して書き戻す
UPDATE patients p
SET allergy_info = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'substance', pa.substance,
      'reaction', pa.reaction,
      'severity', pa.severity,
      'notes', pa.notes
    )
  )
  FROM patient_allergies pa
  WHERE pa.patient_id = p.id
)
WHERE EXISTS (SELECT 1 FROM patient_allergies pa WHERE pa.patient_id = p.id);

-- 新テーブル削除
DROP TABLE IF EXISTS patient_allergies CASCADE;
```

### P-06: Gender Enum の巻き戻し

```sql
-- enum → String に戻す（値は既存のまま維持）
-- Prisma の enum を DROP するには text キャストが必要
ALTER TABLE patients
  ALTER COLUMN gender TYPE TEXT USING gender::TEXT;

-- enum 型削除
DROP TYPE IF EXISTS "PatientGender";

-- 旧形式の値に正規化（'unknown' → 'other'）
UPDATE patients SET gender = 'other' WHERE gender = 'unknown';
```

---

## 整合性チェック SQL（ロールバック後）

```sql
-- 患者数の確認
SELECT COUNT(*) AS total_patients FROM patients;

-- gender フィールドが既知の値のみであること
SELECT gender, COUNT(*) FROM patients GROUP BY gender;

-- allergy_info が存在する患者数
SELECT COUNT(*) FROM patients WHERE allergy_info IS NOT NULL;

-- 保険番号が存在する患者数
SELECT COUNT(*) FROM patients
WHERE medical_insurance_number IS NOT NULL
   OR care_insurance_number IS NOT NULL;

-- アーカイブフィールドが存在しないこと
SELECT column_name FROM information_schema.columns
WHERE table_name = 'patients'
  AND column_name IN ('is_archived', 'archived_at', 'archive_reason');
-- → 0 行であれば OK
```

---

## ロールバック後のインシデント記録テンプレート

```
日時: YYYY-MM-DD HH:MM JST
実施者:
承認者:

異常検知:
  - 検知時刻:
  - 検知内容（エラーレート/ログ等）:

ロールバック実行:
  - 開始時刻:
  - 完了時刻:
  - 実行 SQL フェーズ: P-08 / P-07 / P-04 / P-01 / P-06（該当に○）

復旧確認:
  - CloudWatch エラーレート: % → %
  - 患者詳細画面表示確認: OK / NG
  - 請求 API 確認: OK / NG

根本原因（判明後記載）:

次回対応方針:
```
