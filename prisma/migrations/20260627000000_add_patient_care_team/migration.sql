-- 担当チームを患者単位に一本化する移行の第1段階（基盤・非破壊）。
-- Patient に担当4名（主/副 薬剤師・スタッフ）の user_id 列を追加し、
-- 既存の CareCase 上の割当を Patient へ backfill する。CareCase 列は変更しない。

-- 1) Patient へ担当4列を追加（nullable・FK なし、CareCase の担当列と同方針）。冪等。
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "primary_pharmacist_id" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "backup_pharmacist_id" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "primary_staff_id" TEXT;
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "backup_staff_id" TEXT;

-- 2) 既存 CareCase の割当を Patient へ backfill。
--    採用ルール: 患者ごとに最新ケース（updated_at DESC, created_at DESC, id DESC）。
--    これは getPatientHeaderSummary の tie-break と一致させ、表示と保存の担当を揃える。
--    冪等性: Patient 側が全て NULL の行のみ更新（再実行や手動設定済みの値は上書きしない）。
--    非破壊: CareCase は読むだけで変更しない。patient_id は一意なので org をまたがない。
UPDATE "Patient" p
SET
  "primary_pharmacist_id" = c."primary_pharmacist_id",
  "backup_pharmacist_id"  = c."backup_pharmacist_id",
  "primary_staff_id"      = c."primary_staff_id",
  "backup_staff_id"       = c."backup_staff_id"
FROM (
  SELECT DISTINCT ON ("patient_id")
    "patient_id",
    "primary_pharmacist_id",
    "backup_pharmacist_id",
    "primary_staff_id",
    "backup_staff_id"
  FROM "CareCase"
  ORDER BY "patient_id", "updated_at" DESC, "created_at" DESC, "id" DESC
) c
WHERE p."id" = c."patient_id"
  AND p."primary_pharmacist_id" IS NULL
  AND p."backup_pharmacist_id" IS NULL
  AND p."primary_staff_id" IS NULL
  AND p."backup_staff_id" IS NULL;
