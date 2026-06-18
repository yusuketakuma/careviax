import type { Prisma } from '@prisma/client';
import { buildVisitRecordCaseScope, type PatientDetailScopeArgs } from './patient-detail-scope';

export type PatientBillingRefsDb = {
  medicationCycle: Pick<Prisma.TransactionClient['medicationCycle'], 'findMany'>;
  visitRecord?: Pick<Prisma.TransactionClient['visitRecord'], 'findMany'>;
};

export async function listPatientBillingCaseRefs(
  db: PatientBillingRefsDb,
  args: Pick<PatientDetailScopeArgs, 'orgId' | 'patientId'>,
  caseIds: string[],
  options: { includeVisitRecordIds?: boolean } = {},
) {
  if (caseIds.length === 0) {
    return { visitRecordIds: [] as string[], cycleIds: [] as string[] };
  }

  const visitRecordIdsPromise =
    options.includeVisitRecordIds !== false && db.visitRecord
      ? db.visitRecord
          .findMany({
            where: {
              org_id: args.orgId,
              patient_id: args.patientId,
              ...buildVisitRecordCaseScope(caseIds),
            },
            select: { id: true },
          })
          .then((items) => items.map((item) => item.id))
      : Promise.resolve([] as string[]);

  const [visitRecordIds, cycles] = await Promise.all([
    visitRecordIdsPromise,
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
    visitRecordIds,
    cycleIds: cycles.map((item) => item.id),
  };
}
