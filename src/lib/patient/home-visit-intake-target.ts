import type { Prisma } from '@prisma/client';

export const HOME_VISIT_INTAKE_OPEN_CASE_STATUSES = [
  'referral_received',
  'assessment',
  'active',
  'on_hold',
] as const;

export const HOME_VISIT_INTAKE_CASE_ORDER_BY = [
  { updated_at: 'desc' },
  { created_at: 'desc' },
  { id: 'desc' },
] as const satisfies Prisma.CareCaseOrderByWithRelationInput[];

const HOME_VISIT_INTAKE_OPEN_CASE_STATUS_SET = new Set<string>(
  HOME_VISIT_INTAKE_OPEN_CASE_STATUSES,
);

export type HomeVisitIntakeEditTarget = {
  care_case_id: string;
  expected_care_case_version: number;
};

export function selectCanonicalHomeVisitIntakeCase<T extends { status?: string | null }>(
  orderedCases: readonly T[],
): T | null {
  return (
    orderedCases.find((careCase) =>
      careCase.status ? HOME_VISIT_INTAKE_OPEN_CASE_STATUS_SET.has(careCase.status) : false,
    ) ??
    orderedCases[0] ??
    null
  );
}

type CareCaseTargetDb = Pick<Prisma.TransactionClient, 'careCase'>;

type TargetScope = {
  orgId: string;
  patientId: string;
  assignedCareCaseWhere?: Prisma.CareCaseWhereInput | null;
};

function scopedWhere(args: TargetScope): Prisma.CareCaseWhereInput {
  return {
    org_id: args.orgId,
    patient_id: args.patientId,
    ...(args.assignedCareCaseWhere ? { AND: [args.assignedCareCaseWhere] } : {}),
  };
}

export async function findCanonicalHomeVisitIntakeCase(db: CareCaseTargetDb, args: TargetScope) {
  const where = scopedWhere(args);
  const select = {
    id: true,
    version: true,
    required_visit_support: true,
  } as const;

  return (
    (await db.careCase.findFirst({
      where: {
        ...where,
        status: { in: [...HOME_VISIT_INTAKE_OPEN_CASE_STATUSES] },
      },
      orderBy: HOME_VISIT_INTAKE_CASE_ORDER_BY,
      select,
    })) ??
    db.careCase.findFirst({
      where,
      orderBy: HOME_VISIT_INTAKE_CASE_ORDER_BY,
      select,
    })
  );
}

export function toHomeVisitIntakeEditTarget(
  careCase: { id: string; version: number } | null,
): HomeVisitIntakeEditTarget | null {
  return careCase
    ? {
        care_case_id: careCase.id,
        expected_care_case_version: careCase.version,
      }
    : null;
}

export function buildExactHomeVisitIntakeCaseWhere(
  args: TargetScope & { careCaseId: string; expectedVersion?: number },
): Prisma.CareCaseWhereInput {
  return {
    ...scopedWhere(args),
    id: args.careCaseId,
    ...(args.expectedVersion === undefined ? {} : { version: args.expectedVersion }),
  };
}
