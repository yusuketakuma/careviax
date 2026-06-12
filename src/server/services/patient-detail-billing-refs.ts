import type { Prisma } from '@prisma/client';
import { buildVisitRecordCaseScope, type PatientDetailScopeArgs } from './patient-detail-scope';

export type PatientBillingRefsDb = {
  medicationCycle: Pick<Prisma.TransactionClient['medicationCycle'], 'findMany'>;
  visitRecord: Pick<Prisma.TransactionClient['visitRecord'], 'findMany'>;
};

export async function listPatientBillingCaseRefs(
  db: PatientBillingRefsDb,
  args: Pick<PatientDetailScopeArgs, 'orgId' | 'patientId'>,
  caseIds: string[],
) {
  if (caseIds.length === 0) {
    return { visitRecordIds: [] as string[], cycleIds: [] as string[] };
  }

  const [visitRecords, cycles] = await Promise.all([
    db.visitRecord.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        ...buildVisitRecordCaseScope(caseIds),
      },
      select: { id: true },
    }),
    db.medicationCycle.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        case_id: { in: caseIds },
      },
      select: { id: true },
    }),
  ]);

  return {
    visitRecordIds: visitRecords.map((item) => item.id),
    cycleIds: cycles.map((item) => item.id),
  };
}
