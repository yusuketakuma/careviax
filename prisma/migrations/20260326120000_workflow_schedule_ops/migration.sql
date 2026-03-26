-- CreateEnum
CREATE TYPE "HolidayType" AS ENUM ('public_holiday', 'site_closure', 'org_event');

-- CreateEnum
CREATE TYPE "UserAccountStatus" AS ENUM ('invited', 'active', 'suspended', 'retired');

-- CreateEnum
CREATE TYPE "ManagementPlanStatus" AS ENUM ('draft', 'approved', 'superseded', 'archived');

-- CreateEnum
CREATE TYPE "VisitPriority" AS ENUM ('normal', 'urgent', 'emergency');

-- CreateEnum
CREATE TYPE "VisitProposalStatus" AS ENUM ('proposed', 'patient_contact_pending', 'confirmed', 'rejected', 'superseded', 'expired', 'reschedule_pending');

-- CreateEnum
CREATE TYPE "PatientContactStatus" AS ENUM ('pending', 'attempted', 'confirmed', 'declined', 'unreachable');

-- CreateEnum
CREATE TYPE "VisitAssignmentMode" AS ENUM ('primary', 'fallback');

-- CreateEnum
CREATE TYPE "VisitScheduleOverrideStatus" AS ENUM ('pending', 'completed', 'cancelled');

-- AlterTable
ALTER TABLE "BillingCandidate" ADD COLUMN     "dedupe_key" TEXT,
ADD COLUMN     "evidence_id" TEXT;

-- AlterTable
ALTER TABLE "BillingEvidence" ADD COLUMN     "billing_month" DATE,
ADD COLUMN     "cycle_id" TEXT,
ADD COLUMN     "patient_id" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupe_key" TEXT,
ADD COLUMN     "event_type" TEXT,
ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "IntegrationJob" ADD COLUMN     "dedupe_key" TEXT,
ADD COLUMN     "locked_at" TIMESTAMP(3),
ADD COLUMN     "run_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "dedupe_key" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "sla_due_at" TIMESTAMP(3),
ADD COLUMN     "task_type" TEXT NOT NULL DEFAULT 'general';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "account_status" "UserAccountStatus" NOT NULL DEFAULT 'invited',
ADD COLUMN     "activated_at" TIMESTAMP(3),
ADD COLUMN     "can_accept_emergency" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cognito_username" TEXT,
ADD COLUMN     "coverage_area" JSONB,
ADD COLUMN     "deactivated_at" TIMESTAMP(3),
ADD COLUMN     "deactivation_reason" TEXT,
ADD COLUMN     "default_site_id" TEXT,
ADD COLUMN     "invited_at" TIMESTAMP(3),
ADD COLUMN     "invited_by" TEXT,
ADD COLUMN     "last_invited_at" TIMESTAMP(3),
ADD COLUMN     "max_daily_visits" INTEGER,
ADD COLUMN     "max_travel_minutes" INTEGER,
ADD COLUMN     "max_weekly_visits" INTEGER,
ADD COLUMN     "visit_specialties" JSONB;

-- AlterTable
ALTER TABLE "Residence" ADD COLUMN     "geocode_accuracy" TEXT,
ADD COLUMN     "geocode_source" TEXT,
ADD COLUMN     "geocode_status" TEXT,
ADD COLUMN     "geocoded_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CareCase" ADD COLUMN     "backup_pharmacist_id" TEXT,
ADD COLUMN     "required_visit_support" JSONB;

-- AlterTable
ALTER TABLE "ManagementPlan" ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "effective_from" DATE,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by" TEXT,
ADD COLUMN     "source_plan_id" TEXT,
ADD COLUMN     "status" "ManagementPlanStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '訪問薬剤管理指導計画書';

-- AlterTable
ALTER TABLE "VisitSchedule" ADD COLUMN     "assignment_mode" "VisitAssignmentMode" NOT NULL DEFAULT 'primary',
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_by" TEXT,
ADD COLUMN     "escalation_reason" TEXT,
ADD COLUMN     "priority" "VisitPriority" NOT NULL DEFAULT 'normal',
ADD COLUMN     "site_id" TEXT;

-- CreateTable
CREATE TABLE "PharmacistShiftTemplate" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "available_from" TIME,
    "available_to" TIME,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacistShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessHoliday" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "site_id" TEXT,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "holiday_type" "HolidayType" NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientSchedulePreference" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "preferred_weekdays" JSONB,
    "preferred_time_from" TIME,
    "preferred_time_to" TIME,
    "phone_contact_from" TIME,
    "phone_contact_to" TIME,
    "facility_time_from" TIME,
    "facility_time_to" TIME,
    "family_presence_required" BOOLEAN NOT NULL DEFAULT false,
    "visit_buffer_minutes" INTEGER,
    "preferred_contact_name" TEXT,
    "preferred_contact_phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientSchedulePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitScheduleProposal" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cycle_id" TEXT,
    "case_id" TEXT NOT NULL,
    "site_id" TEXT,
    "visit_type" "VisitType" NOT NULL,
    "priority" "VisitPriority" NOT NULL DEFAULT 'normal',
    "proposal_status" "VisitProposalStatus" NOT NULL DEFAULT 'proposed',
    "patient_contact_status" "PatientContactStatus" NOT NULL DEFAULT 'pending',
    "proposed_date" DATE NOT NULL,
    "time_window_start" TIME,
    "time_window_end" TIME,
    "proposed_pharmacist_id" TEXT NOT NULL,
    "assignment_mode" "VisitAssignmentMode" NOT NULL DEFAULT 'primary',
    "route_order" INTEGER,
    "route_distance_score" DOUBLE PRECISION,
    "medication_end_date" DATE,
    "visit_deadline_date" DATE,
    "proposal_reason" TEXT,
    "escalation_reason" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "patient_contacted_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "finalized_schedule_id" TEXT,
    "reschedule_source_schedule_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitScheduleProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitScheduleContactLog" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "schedule_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "outcome" "PatientContactStatus" NOT NULL,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "note" TEXT,
    "callback_due_at" TIMESTAMP(3),
    "called_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitScheduleContactLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitScheduleOverride" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "source_schedule_id" TEXT NOT NULL,
    "replacement_schedule_id" TEXT,
    "status" "VisitScheduleOverrideStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "before_snapshot" JSONB NOT NULL,
    "impact_summary" JSONB,
    "after_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitScheduleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PharmacistShiftTemplate_org_id_weekday_idx" ON "PharmacistShiftTemplate"("org_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacistShiftTemplate_user_id_weekday_key" ON "PharmacistShiftTemplate"("user_id", "weekday");

-- CreateIndex
CREATE INDEX "BusinessHoliday_org_id_date_idx" ON "BusinessHoliday"("org_id", "date");

-- CreateIndex
CREATE INDEX "BusinessHoliday_site_id_date_idx" ON "BusinessHoliday"("site_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PatientSchedulePreference_patient_id_key" ON "PatientSchedulePreference"("patient_id");

-- CreateIndex
CREATE INDEX "PatientSchedulePreference_org_id_idx" ON "PatientSchedulePreference"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "VisitScheduleProposal_finalized_schedule_id_key" ON "VisitScheduleProposal"("finalized_schedule_id");

-- CreateIndex
CREATE INDEX "VisitScheduleProposal_org_id_proposal_status_idx" ON "VisitScheduleProposal"("org_id", "proposal_status");

-- CreateIndex
CREATE INDEX "VisitScheduleProposal_case_id_proposed_date_idx" ON "VisitScheduleProposal"("case_id", "proposed_date");

-- CreateIndex
CREATE INDEX "VisitScheduleProposal_site_id_proposed_date_idx" ON "VisitScheduleProposal"("site_id", "proposed_date");

-- CreateIndex
CREATE INDEX "VisitScheduleContactLog_org_id_proposal_id_idx" ON "VisitScheduleContactLog"("org_id", "proposal_id");

-- CreateIndex
CREATE INDEX "VisitScheduleContactLog_org_id_schedule_id_idx" ON "VisitScheduleContactLog"("org_id", "schedule_id");

-- CreateIndex
CREATE INDEX "VisitScheduleContactLog_org_id_patient_id_idx" ON "VisitScheduleContactLog"("org_id", "patient_id");

-- CreateIndex
CREATE INDEX "VisitScheduleContactLog_called_at_idx" ON "VisitScheduleContactLog"("called_at");

-- CreateIndex
CREATE UNIQUE INDEX "VisitScheduleOverride_source_schedule_id_key" ON "VisitScheduleOverride"("source_schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "VisitScheduleOverride_replacement_schedule_id_key" ON "VisitScheduleOverride"("replacement_schedule_id");

-- CreateIndex
CREATE INDEX "VisitScheduleOverride_org_id_status_idx" ON "VisitScheduleOverride"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCandidate_org_id_dedupe_key_key" ON "BillingCandidate"("org_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "BillingEvidence_billing_month_idx" ON "BillingEvidence"("billing_month");

-- CreateIndex
CREATE INDEX "BillingEvidence_cycle_id_idx" ON "BillingEvidence"("cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvidence_org_id_visit_record_id_key" ON "BillingEvidence"("org_id", "visit_record_id");

-- CreateIndex
CREATE INDEX "Notification_event_type_idx" ON "Notification"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_org_id_user_id_dedupe_key_key" ON "Notification"("org_id", "user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "IntegrationJob_run_at_idx" ON "IntegrationJob"("run_at");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationJob_job_type_org_id_dedupe_key_key" ON "IntegrationJob"("job_type", "org_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "Task_task_type_status_idx" ON "Task"("task_type", "status");

-- CreateIndex
CREATE INDEX "Task_sla_due_at_idx" ON "Task"("sla_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "Task_org_id_dedupe_key_key" ON "Task"("org_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "User_cognito_username_key" ON "User"("cognito_username");

-- CreateIndex
CREATE INDEX "User_account_status_idx" ON "User"("account_status");

-- CreateIndex
CREATE INDEX "ManagementPlan_status_idx" ON "ManagementPlan"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementPlan_case_id_version_key" ON "ManagementPlan"("case_id", "version");

-- CreateIndex
CREATE INDEX "VisitSchedule_site_id_scheduled_date_idx" ON "VisitSchedule"("site_id", "scheduled_date");

-- AddForeignKey
ALTER TABLE "PharmacistShiftTemplate" ADD CONSTRAINT "PharmacistShiftTemplate_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "PharmacySite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacistShiftTemplate" ADD CONSTRAINT "PharmacistShiftTemplate_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessHoliday" ADD CONSTRAINT "BusinessHoliday_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "PharmacySite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientSchedulePreference" ADD CONSTRAINT "PatientSchedulePreference_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitSchedule" ADD CONSTRAINT "VisitSchedule_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "CareCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitSchedule" ADD CONSTRAINT "VisitSchedule_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "PharmacySite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitScheduleProposal" ADD CONSTRAINT "VisitScheduleProposal_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "MedicationCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitScheduleProposal" ADD CONSTRAINT "VisitScheduleProposal_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "CareCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitScheduleProposal" ADD CONSTRAINT "VisitScheduleProposal_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "PharmacySite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitScheduleProposal" ADD CONSTRAINT "VisitScheduleProposal_finalized_schedule_id_fkey" FOREIGN KEY ("finalized_schedule_id") REFERENCES "VisitSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitScheduleProposal" ADD CONSTRAINT "VisitScheduleProposal_reschedule_source_schedule_id_fkey" FOREIGN KEY ("reschedule_source_schedule_id") REFERENCES "VisitSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitScheduleContactLog" ADD CONSTRAINT "VisitScheduleContactLog_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "VisitScheduleProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitScheduleContactLog" ADD CONSTRAINT "VisitScheduleContactLog_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "VisitSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitScheduleOverride" ADD CONSTRAINT "VisitScheduleOverride_source_schedule_id_fkey" FOREIGN KEY ("source_schedule_id") REFERENCES "VisitSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitScheduleOverride" ADD CONSTRAINT "VisitScheduleOverride_replacement_schedule_id_fkey" FOREIGN KEY ("replacement_schedule_id") REFERENCES "VisitSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- RLS additions for workflow scheduling entities
ALTER TABLE "PatientSchedulePreference" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientSchedulePreference"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
ALTER TABLE "PatientSchedulePreference" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacistShiftTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PharmacistShiftTemplate"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
ALTER TABLE "PharmacistShiftTemplate" FORCE ROW LEVEL SECURITY;
