import type { Prisma, PrismaClient } from '@prisma/client';
import { canViewAllDashboardWork } from '@/lib/auth/visit-schedule-access';
import { buildPersonalCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import type { VisitScheduleAccessContext } from '@/lib/auth/visit-schedule-access';

type DashboardAssignmentScopeDb = {
  careCase: {
    findMany(args: {
      where: Prisma.CareCaseWhereInput;
      select: { id: true; patient_id: true };
    }): Promise<Array<{ id: string; patient_id: string }>>;
  };
};

export type DashboardAssignmentScope = {
  caseIds?: string[];
  patientIds?: string[];
  caseIdsByPatient?: Record<string, string[]>;
  assignedToUserId?: string;
};

export async function resolveDashboardAssignmentScope(args: {
  db: DashboardAssignmentScopeDb | PrismaClient;
  orgId: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<DashboardAssignmentScope> {
  if (canViewAllDashboardWork(args.accessContext)) {
    return {
      caseIds: undefined,
      patientIds: undefined,
      caseIdsByPatient: undefined,
      assignedToUserId: undefined,
    };
  }

  // フルアクセス対象ロール(薬剤師等)でも、ダッシュボードは個人の担当を既定表示する。
  // アクセス bypass に依存しない buildPersonalCareCaseAssignmentWhere で厳密に絞る。
  const assignmentWhere = buildPersonalCareCaseAssignmentWhere(args.accessContext);
  const careCases = await args.db.careCase.findMany({
    where: {
      org_id: args.orgId,
      AND: [assignmentWhere],
    },
    select: { id: true, patient_id: true },
  });

  const caseIdsByPatient: Record<string, string[]> = {};
  for (const careCase of careCases) {
    caseIdsByPatient[careCase.patient_id] ??= [];
    caseIdsByPatient[careCase.patient_id].push(careCase.id);
  }

  return {
    caseIds: careCases.map((careCase) => careCase.id),
    patientIds: Array.from(new Set(careCases.map((careCase) => careCase.patient_id))),
    caseIdsByPatient,
    assignedToUserId: args.accessContext.userId,
  };
}

export function buildDashboardTaskAssignmentWhere(args: {
  caseIds?: string[];
  patientIds?: string[];
  assignedToUserId?: string;
}) {
  if (
    args.caseIds === undefined &&
    args.patientIds === undefined &&
    args.assignedToUserId === undefined
  ) {
    return {};
  }

  const relatedEntityScope = [
    ...(args.assignedToUserId
      ? [
          {
            assigned_to: args.assignedToUserId,
          },
        ]
      : []),
    ...(args.patientIds && args.patientIds.length > 0
      ? [
          {
            related_entity_type: 'patient',
            related_entity_id: { in: args.patientIds },
          },
        ]
      : []),
    ...(args.caseIds && args.caseIds.length > 0
      ? [
          {
            related_entity_type: 'case',
            related_entity_id: { in: args.caseIds },
          },
        ]
      : []),
  ];

  return relatedEntityScope.length > 0 ? { OR: relatedEntityScope } : { id: { in: [] } };
}
