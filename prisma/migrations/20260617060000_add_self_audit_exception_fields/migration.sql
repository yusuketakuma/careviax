-- 単独薬剤師の自己監査=限定例外 (D1=B)。
-- two-person rule の限定例外を新設: admin 承認 + same_operator_reason 必須 + サーバ時刻記録。
-- 既存行は NULL で後方互換 (非破壊・nullable)。

-- AlterTable
ALTER TABLE "DispenseAudit" ADD COLUMN     "same_operator_approved_by" TEXT,
ADD COLUMN     "same_operator_reason" TEXT;

-- AlterTable
ALTER TABLE "SetAudit" ADD COLUMN     "same_operator_approved_by" TEXT,
ADD COLUMN     "same_operator_reason" TEXT;
