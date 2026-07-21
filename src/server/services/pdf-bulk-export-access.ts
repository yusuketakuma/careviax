import { Prisma } from '@prisma/client';
import { hasPermission } from '@/lib/auth/permissions';
import {
  buildVisitScheduleAssignmentWhere,
  canAccessVisitScheduleAssignment,
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { MedicationHistoryBulkExportError } from './pdf-bulk-export-contract';

export type BulkExportAccessDb = Pick<
  Prisma.TransactionClient,
  'careCase' | 'patient' | 'visitSchedule'
>;
export type BulkExportJobRecoveryDb = Pick<Prisma.TransactionClient, 'integrationJob'>;

export async function assertPatientsExist(args: {
  db: BulkExportAccessDb;
  orgId: string;
  patientIds: string[];
}) {
  const existingPatientCount = await args.db.patient.count({
    where: {
      org_id: args.orgId,
      id: {
        in: args.patientIds,
      },
    },
  });

  if (existingPatientCount !== args.patientIds.length) {
    throw new MedicationHistoryBulkExportError(
      'WORKFLOW_NOT_FOUND',
      '指定された患者の一部が見つかりません',
      404,
    );
  }
}

export async function assertBulkExportPatientAccess(args: {
  db: BulkExportAccessDb;
  orgId: string;
  patientIds: string[];
  accessContext: VisitScheduleAccessContext;
}) {
  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) {
    return;
  }

  const scheduleAssignmentWhere = buildVisitScheduleAssignmentWhere(args.accessContext);
  const accessiblePatientIds = new Set<string>();

  if (scheduleAssignmentWhere) {
    const accessibleSchedules = await args.db.visitSchedule.findMany({
      where: {
        org_id: args.orgId,
        case_: {
          patient_id: {
            in: args.patientIds,
          },
        },
        AND: [scheduleAssignmentWhere],
      },
      select: {
        case_: {
          select: {
            patient_id: true,
          },
        },
      },
    });

    for (const schedule of accessibleSchedules) {
      accessiblePatientIds.add(schedule.case_.patient_id);
    }
  }

  const unresolvedPatientIds = args.patientIds.filter(
    (patientId) => !accessiblePatientIds.has(patientId),
  );

  if (unresolvedPatientIds.length > 0) {
    const accessibleCases = await args.db.careCase.findMany({
      where: {
        org_id: args.orgId,
        patient_id: {
          in: unresolvedPatientIds,
        },
        OR: [
          { primary_pharmacist_id: args.accessContext.userId },
          { backup_pharmacist_id: args.accessContext.userId },
        ],
      },
      select: {
        patient_id: true,
        primary_pharmacist_id: true,
        backup_pharmacist_id: true,
      },
    });

    for (const careCase of accessibleCases) {
      if (
        canAccessVisitScheduleAssignment(args.accessContext, {
          pharmacist_id: null,
          case_: careCase,
        })
      ) {
        accessiblePatientIds.add(careCase.patient_id);
      }
    }
  }

  const forbiddenPatientIds = args.patientIds.filter(
    (patientId) => !accessiblePatientIds.has(patientId),
  );

  if (forbiddenPatientIds.length > 0) {
    throw new MedicationHistoryBulkExportError(
      'AUTHORIZATION_ERROR',
      '一括出力対象にアクセス権限のない患者が含まれています',
      403,
    );
  }
}

export async function getRequesterAccessContext(args: {
  db: Pick<Prisma.TransactionClient, 'membership'>;
  orgId: string;
  requestedBy: string;
}): Promise<VisitScheduleAccessContext> {
  const membership = await args.db.membership.findFirst({
    where: {
      org_id: args.orgId,
      user_id: args.requestedBy,
      is_active: true,
    },
    select: {
      role: true,
    },
  });

  if (!membership || !hasPermission(membership.role, 'canVisit')) {
    throw new MedicationHistoryBulkExportError(
      'AUTHORIZATION_ERROR',
      '薬歴 PDF 一括出力の実行権限がありません',
      403,
    );
  }

  return {
    userId: args.requestedBy,
    role: membership.role,
  };
}
