import type { MemberRole, Prisma, PrismaClient } from '@prisma/client';
import {
  buildCareCaseAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';

type DbClient = Pick<PrismaClient, 'careCase'>;

export type PrescriptionAccessContext = {
  userId: string;
  role: MemberRole;
};

export function buildMedicationCycleAssignmentWhere(
  ctx: PrescriptionAccessContext,
): Prisma.MedicationCycleWhereInput | null {
  const careCaseWhere = buildCareCaseAssignmentWhere(ctx);
  return careCaseWhere ? { case_: careCaseWhere } : null;
}

export function buildPrescriptionIntakeAssignmentWhere(
  ctx: PrescriptionAccessContext,
): Prisma.PrescriptionIntakeWhereInput | null {
  const cycleWhere = buildMedicationCycleAssignmentWhere(ctx);
  return cycleWhere ? { cycle: cycleWhere } : null;
}

export function buildQrDraftAssignmentWhere(
  ctx: PrescriptionAccessContext,
  patientIds: string[],
): Prisma.QrScanDraftWhereInput | null {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return null;

  return {
    OR: [
      { scanned_by: ctx.userId },
      ...(patientIds.length > 0 ? [{ patient_id: { in: patientIds } }] : []),
    ],
  };
}

export async function getAssignedPatientIds(
  db: DbClient,
  orgId: string,
  ctx: PrescriptionAccessContext,
) {
  const careCaseWhere = buildCareCaseAssignmentWhere(ctx);
  if (!careCaseWhere) return null;

  const cases = await db.careCase.findMany({
    where: {
      org_id: orgId,
      AND: [careCaseWhere],
    },
    select: { patient_id: true },
  });

  return Array.from(new Set(cases.map((careCase) => careCase.patient_id)));
}

export async function canAccessPrescriptionPatient(
  db: DbClient,
  orgId: string,
  ctx: PrescriptionAccessContext,
  patientId: string,
) {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return true;
  const careCaseWhere = buildCareCaseAssignmentWhere(ctx);
  if (!careCaseWhere) return true;

  const careCase = await db.careCase.findFirst({
    where: {
      org_id: orgId,
      patient_id: patientId,
      AND: [careCaseWhere],
    },
    select: { id: true },
  });

  return Boolean(careCase);
}
