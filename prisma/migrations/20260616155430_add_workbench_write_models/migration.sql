-- 調剤ワークベンチ 書込モデル P0 (後方互換: 新列は default/null、既存列の型変更なし)
-- 注意: prisma migrate dev が検出した無関係なドリフト (phos_fee_rule_* テーブルの DROP、
-- DrugAlertRule FK の付け替え、FileAsset/VisitVehicleResource の updated_at DROP DEFAULT) は
-- 本マイグレーションには含めない。これらは Prisma 未モデルの手書き SQL テーブル/別系統のドリフトであり、
-- ここで実行すると他環境のデータを破壊するため意図的に除外している。

-- CreateEnum
CREATE TYPE "RejectCode" AS ENUM ('patient_mismatch', 'set_period_mismatch', 'date_mismatch', 'frequency_mismatch', 'drug_mismatch', 'quantity_short', 'quantity_over', 'discontinued_mixed', 'washout_missed', 'previous_drug_mixed', 'outside_med_missing', 'residual_instruction_missed', 'photo_unclear', 'undeterminable');

-- CreateEnum
CREATE TYPE "SetCellState" AS ENUM ('pending', 'set', 'hold');

-- CreateEnum
CREATE TYPE "SetAuditCellState" AS ENUM ('unaudited', 'ok', 'ng');

-- CreateEnum
CREATE TYPE "HoldScope" AS ENUM ('cycle', 'line', 'cell');

-- CreateEnum
CREATE TYPE "HoldReason" AS ENUM ('prescription_change_wait', 'doctor_confirm_wait', 'residual_confirm_wait', 'stock_shortage', 'family_facility_confirm_wait', 'onsite_set_at_visit', 'other');

-- AlterTable (SetBatch セル状態列。既存行は default/null で後方互換)
ALTER TABLE "SetBatch" ADD COLUMN     "audit_state" "SetAuditCellState" NOT NULL DEFAULT 'unaudited',
ADD COLUMN     "audited_at" TIMESTAMP(3),
ADD COLUMN     "audited_by" TEXT,
ADD COLUMN     "held_at" TIMESTAMP(3),
ADD COLUMN     "held_by" TEXT,
ADD COLUMN     "held_reason" TEXT,
ADD COLUMN     "ng_code" "RejectCode",
ADD COLUMN     "set_at" TIMESTAMP(3),
ADD COLUMN     "set_by" TEXT,
ADD COLUMN     "set_state" "SetCellState" NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "PackagingGroup" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "group_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slot" TEXT,
    "method" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleHold" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "scope" "HoldScope" NOT NULL,
    "line_id" TEXT,
    "day_number" INTEGER,
    "slot" TEXT,
    "reason" "HoldReason" NOT NULL,
    "reason_detail" TEXT,
    "due_at" TIMESTAMP(3),
    "assigned_to" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CycleHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackagingGroup_org_id_cycle_id_idx" ON "PackagingGroup"("org_id", "cycle_id");

-- CreateIndex
CREATE INDEX "CycleHold_org_id_cycle_id_idx" ON "CycleHold"("org_id", "cycle_id");

-- AddForeignKey
ALTER TABLE "PackagingGroup" ADD CONSTRAINT "PackagingGroup_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "MedicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleHold" ADD CONSTRAINT "CycleHold_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "MedicationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: org_id によるテナント分離 (withOrgContext の SET LOCAL app.current_org_id と対)。
-- 他患者ドメインと同形 (app_enforced_org_id failsafe + FORCE)。rls-policies.sql にも追記済み。
ALTER TABLE "PackagingGroup" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PackagingGroup";
CREATE POLICY tenant_isolation ON "PackagingGroup"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PackagingGroup" FORCE ROW LEVEL SECURITY;

ALTER TABLE "CycleHold" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CycleHold";
CREATE POLICY tenant_isolation ON "CycleHold"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "CycleHold" FORCE ROW LEVEL SECURITY;
