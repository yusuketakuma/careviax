import type { Gender, Prisma } from '@prisma/client';
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

export type CareReportSourcePatient = {
  id: string;
  name: string;
  birth_date: Date;
  gender: Gender;
};

export type CareReportSourceMedicationCycle = {
  id: string;
};

export type CareReportSourceResidualMedication = {
  drug_name: string;
  remaining_quantity: number;
  excess_days: number | null;
  is_reduction_target: boolean;
};

export type CareReportSourceCareTeamLink = {
  role: string;
  name: string;
  organization_name: string | null;
};

export async function getCareReportSourcePatient(
  db: CareReportSourcePatientDb,
  args: { orgId: string; patientId: string },
): Promise<CareReportSourcePatient | null> {
  return db.patient.findFirst({
    where: { id: args.patientId, org_id: args.orgId },
    select: { id: true, name: true, birth_date: true, gender: true },
  });
}

export async function getCareReportSourceMedicationCycle(
  db: CareReportSourceMedicationCycleDb,
  args: { orgId: string; cycleId: string },
): Promise<CareReportSourceMedicationCycle | null> {
  return db.medicationCycle.findFirst({
    where: { id: args.cycleId, org_id: args.orgId },
    orderBy: { created_at: 'desc' },
    select: { id: true },
  });
}

export async function listCareReportSourceResidualMedications(
  db: CareReportSourceResidualMedicationDb,
  args: { orgId: string; visitRecordId: string },
): Promise<CareReportSourceResidualMedication[]> {
  return db.residualMedication.findMany({
    where: { org_id: args.orgId, visit_record_id: args.visitRecordId },
    select: {
      drug_name: true,
      remaining_quantity: true,
      excess_days: true,
      is_reduction_target: true,
    },
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
    select: { role: true, name: true, organization_name: true },
    orderBy: { is_primary: 'desc' },
  });
}
