import type { Prisma, ReportType as PrismaReportType } from '@prisma/client';
import { prisma } from '@/lib/db/client';

export type CareReportSourcePatientDb = Pick<typeof prisma | Prisma.TransactionClient, 'patient'>;
export type CareReportSourceMedicationCycleDb = Pick<
  typeof prisma | Prisma.TransactionClient,
  'medicationCycle'
>;
export type CareReportSourceResidualMedicationDb = Pick<
  typeof prisma | Prisma.TransactionClient,
  'residualMedication'
>;
export type CareReportSourceCareTeamLinkDb = Pick<
  typeof prisma | Prisma.TransactionClient,
  'careTeamLink'
>;
export type CareReportSourceVisitRecordDb = Pick<
  typeof prisma | Prisma.TransactionClient,
  'visitRecord'
>;
export type CareReportSourceVisitScheduleDb = Pick<
  typeof prisma | Prisma.TransactionClient,
  'visitSchedule'
>;
export type CareReportSourcePharmacistUserDb = Pick<
  typeof prisma | Prisma.TransactionClient,
  'user'
>;
export type CareReportSourceBillingEvidenceDb = Pick<
  typeof prisma | Prisma.TransactionClient,
  'billingEvidence'
>;
export type CareReportSourceCareCaseDb = Pick<typeof prisma | Prisma.TransactionClient, 'careCase'>;
export type CareReportSourcePrescriptionLineDb = Pick<
  typeof prisma | Prisma.TransactionClient,
  'prescriptionLine'
>;
export type CareReportSourceExistingReportDb = Pick<
  typeof prisma | Prisma.TransactionClient,
  'careReport'
>;
export type CareReportSourceConferenceNoteDb = {
  conferenceNote?: {
    findMany?: (args: Record<string, unknown>) => Promise<CareReportSourceConferenceNote[]>;
  };
};

const careReportSourcePatientSelect = {
  id: true,
  name: true,
  birth_date: true,
  gender: true,
} satisfies Prisma.PatientSelect;

const careReportSourceMedicationCycleSelect = {
  id: true,
} satisfies Prisma.MedicationCycleSelect;

const careReportSourceResidualMedicationSelect = {
  drug_name: true,
  remaining_quantity: true,
  excess_days: true,
  is_reduction_target: true,
} satisfies Prisma.ResidualMedicationSelect;

const careReportSourceCareTeamLinkSelect = {
  role: true,
  name: true,
  organization_name: true,
} satisfies Prisma.CareTeamLinkSelect;

const careReportSourceVisitRecordSelect = {
  id: true,
  org_id: true,
  patient_id: true,
  pharmacist_id: true,
  visit_date: true,
  structured_soap: true,
  schedule_id: true,
  version: true,
  updated_at: true,
} satisfies Prisma.VisitRecordSelect;

const careReportSourceVisitScheduleSelect = {
  case_id: true,
  cycle_id: true,
  org_id: true,
} satisfies Prisma.VisitScheduleSelect;

const careReportSourcePharmacistUserSelect = {
  name: true,
} satisfies Prisma.UserSelect;

const careReportSourceBillingEvidenceSelect = {
  id: true,
  cycle_id: true,
  patient_id: true,
  claimable: true,
  exclusion_reason: true,
  report_delivery_ref: true,
  updated_at: true,
  payer_basis: true,
  applied_rule_keys: true,
  recommended_rule_keys: true,
  validation_notes: true,
  calculation_context: true,
} satisfies Prisma.BillingEvidenceSelect;

const careReportSourceCareCaseSelect = {
  required_visit_support: true,
} satisfies Prisma.CareCaseSelect;

const careReportSourceConferenceNoteSelect = {
  id: true,
  note_type: true,
  title: true,
  conference_date: true,
  structured_content: true,
  metadata: true,
  action_items: true,
} satisfies Prisma.ConferenceNoteSelect;

const careReportSourcePrescriptionLineSelect = {
  id: true,
  intake_id: true,
  drug_name: true,
  drug_code: true,
  dose: true,
  frequency: true,
  days: true,
  dosage_form: true,
  quantity: true,
  unit: true,
  route: true,
  dispensing_method: true,
  packaging_instructions: true,
  packaging_instruction_tags: true,
  notes: true,
  intake: {
    select: {
      prescribed_date: true,
    },
  },
} satisfies Prisma.PrescriptionLineSelect;

const careReportSourceExistingReportSelect = {
  id: true,
  report_type: true,
  status: true,
  updated_at: true,
} satisfies Prisma.CareReportSelect;

export type CareReportSourcePatient = Prisma.PatientGetPayload<{
  select: typeof careReportSourcePatientSelect;
}>;
export type CareReportSourceMedicationCycle = Prisma.MedicationCycleGetPayload<{
  select: typeof careReportSourceMedicationCycleSelect;
}>;
export type CareReportSourceResidualMedication = Prisma.ResidualMedicationGetPayload<{
  select: typeof careReportSourceResidualMedicationSelect;
}>;
export type CareReportSourceCareTeamLink = Prisma.CareTeamLinkGetPayload<{
  select: typeof careReportSourceCareTeamLinkSelect;
}>;
export type CareReportSourceVisitRecord = Prisma.VisitRecordGetPayload<{
  select: typeof careReportSourceVisitRecordSelect;
}>;
export type CareReportSourceVisitSchedule = Prisma.VisitScheduleGetPayload<{
  select: typeof careReportSourceVisitScheduleSelect;
}>;
export type CareReportSourcePharmacistUser = Prisma.UserGetPayload<{
  select: typeof careReportSourcePharmacistUserSelect;
}>;
export type CareReportSourceBillingEvidence = Prisma.BillingEvidenceGetPayload<{
  select: typeof careReportSourceBillingEvidenceSelect;
}>;
export type CareReportSourceCareCase = Prisma.CareCaseGetPayload<{
  select: typeof careReportSourceCareCaseSelect;
}>;
export type CareReportSourceConferenceNote = Prisma.ConferenceNoteGetPayload<{
  select: typeof careReportSourceConferenceNoteSelect;
}>;
export type CareReportSourcePrescriptionLine = Prisma.PrescriptionLineGetPayload<{
  select: typeof careReportSourcePrescriptionLineSelect;
}>;
export type CareReportSourceExistingReport = Prisma.CareReportGetPayload<{
  select: typeof careReportSourceExistingReportSelect;
}>;

export async function getCareReportSourcePatient(
  db: CareReportSourcePatientDb,
  args: { orgId: string; patientId: string },
): Promise<CareReportSourcePatient | null> {
  return db.patient.findFirst({
    where: { id: args.patientId, org_id: args.orgId },
    select: careReportSourcePatientSelect,
  });
}

export async function getCareReportSourceMedicationCycle(
  db: CareReportSourceMedicationCycleDb,
  args: { orgId: string; cycleId: string },
): Promise<CareReportSourceMedicationCycle | null> {
  return db.medicationCycle.findFirst({
    where: { id: args.cycleId, org_id: args.orgId },
    orderBy: { created_at: 'desc' },
    select: careReportSourceMedicationCycleSelect,
  });
}

export async function listCareReportSourceResidualMedications(
  db: CareReportSourceResidualMedicationDb,
  args: { orgId: string; visitRecordId: string },
): Promise<CareReportSourceResidualMedication[]> {
  return db.residualMedication.findMany({
    where: { org_id: args.orgId, visit_record_id: args.visitRecordId },
    select: careReportSourceResidualMedicationSelect,
  });
}

export async function listCareReportSourceCareTeamLinks(
  db: CareReportSourceCareTeamLinkDb,
  args: { orgId: string; caseId: string },
): Promise<CareReportSourceCareTeamLink[]> {
  return db.careTeamLink.findMany({
    where: {
      case_id: args.caseId,
      org_id: args.orgId,
      role: { in: ['physician', 'care_manager'] },
    },
    select: careReportSourceCareTeamLinkSelect,
    orderBy: { is_primary: 'desc' },
  });
}

export async function getCareReportSourceVisitRecord(
  db: CareReportSourceVisitRecordDb,
  args: { orgId: string; visitRecordId: string },
): Promise<CareReportSourceVisitRecord | null> {
  return db.visitRecord.findFirst({
    where: { id: args.visitRecordId, org_id: args.orgId },
    select: careReportSourceVisitRecordSelect,
  });
}

export async function getCareReportSourceVisitSchedule(
  db: CareReportSourceVisitScheduleDb,
  args: { scheduleId: string },
): Promise<CareReportSourceVisitSchedule | null> {
  return db.visitSchedule.findUnique({
    where: { id: args.scheduleId },
    select: careReportSourceVisitScheduleSelect,
  });
}

export async function getCareReportSourcePharmacistUser(
  db: CareReportSourcePharmacistUserDb,
  args: { pharmacistId: string },
): Promise<CareReportSourcePharmacistUser | null> {
  return db.user.findFirst({
    where: { id: args.pharmacistId },
    select: careReportSourcePharmacistUserSelect,
  });
}

export async function getCareReportSourceBillingEvidence(
  db: CareReportSourceBillingEvidenceDb,
  args: { orgId: string; visitRecordId: string },
): Promise<CareReportSourceBillingEvidence | null> {
  return db.billingEvidence.findFirst({
    where: { visit_record_id: args.visitRecordId, org_id: args.orgId },
    select: careReportSourceBillingEvidenceSelect,
    orderBy: { created_at: 'desc' },
  });
}

export async function getCareReportSourceCareCase(
  db: CareReportSourceCareCaseDb,
  args: { orgId: string; caseId: string },
): Promise<CareReportSourceCareCase | null> {
  return db.careCase.findFirst({
    where: { id: args.caseId, org_id: args.orgId },
    select: careReportSourceCareCaseSelect,
  });
}

export async function listCareReportSourceConferenceNotes(
  db: CareReportSourceConferenceNoteDb,
  args: { orgId: string; patientId: string; caseId: string },
): Promise<CareReportSourceConferenceNote[]> {
  return db.conferenceNote?.findMany
    ? db.conferenceNote.findMany({
        where: {
          org_id: args.orgId,
          OR: [{ patient_id: args.patientId }, { case_id: args.caseId }],
          note_type: { in: ['pre_discharge', 'service_manager'] },
        },
        orderBy: [{ conference_date: 'desc' }],
        take: 4,
        select: careReportSourceConferenceNoteSelect,
      })
    : Promise.resolve([]);
}

export async function listCareReportSourcePrescriptionLines(
  db: CareReportSourcePrescriptionLineDb,
  args: { orgId: string; medicationCycleId: string },
): Promise<CareReportSourcePrescriptionLine[]> {
  return db.prescriptionLine.findMany({
    where: { org_id: args.orgId, intake: { cycle_id: args.medicationCycleId } },
    select: careReportSourcePrescriptionLineSelect,
    orderBy: [{ intake: { prescribed_date: 'desc' } }, { line_number: 'asc' }],
  });
}

export async function listCareReportSourceExistingReports(
  db: CareReportSourceExistingReportDb,
  args: { orgId: string; visitRecordId: string; reportTypes: PrismaReportType[] },
): Promise<CareReportSourceExistingReport[]> {
  return db.careReport.findMany({
    where: {
      org_id: args.orgId,
      visit_record_id: args.visitRecordId,
      report_type: { in: args.reportTypes },
    },
    select: careReportSourceExistingReportSelect,
  });
}
