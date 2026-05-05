import type { Prisma } from '@prisma/client';
import { canBypassVisitScheduleAssignmentAccess } from '@/lib/auth/visit-schedule-access';
import type { VisitScheduleAccessContext } from '@/lib/auth/visit-schedule-access';
import {
  canAccessCareCase,
  canAccessPatient,
  listAccessiblePatientIds,
  listAccessibleCareCaseIds,
} from '@/server/services/patient-access';

type CommunicationScopeDb = Parameters<typeof listAccessibleCareCaseIds>[0]['db'] &
  Parameters<typeof listAccessiblePatientIds>[0]['db'];

type CommunicationRecordAccessDb = Parameters<typeof canAccessPatient>[0]['db'] &
  Parameters<typeof canAccessCareCase>[0]['db'];

export async function buildCommunicationRequestAssignmentWhere(args: {
  db: CommunicationScopeDb;
  orgId: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<Prisma.CommunicationRequestWhereInput | null> {
  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return null;

  const [caseIds, patientIds] = await Promise.all([
    listAccessibleCareCaseIds({
      db: args.db,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
    listAccessiblePatientIds({
      db: args.db,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
  ]);

  return {
    OR: [
      { case_id: { in: caseIds } },
      {
        AND: [{ case_id: null }, { patient_id: { in: patientIds } }],
      },
      {
        AND: [{ case_id: null }, { patient_id: null }],
      },
    ],
  };
}

export async function buildCommunicationEventAssignmentWhere(args: {
  db: CommunicationScopeDb;
  orgId: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<Prisma.CommunicationEventWhereInput | null> {
  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return null;

  const [caseIds, patientIds] = await Promise.all([
    listAccessibleCareCaseIds({
      db: args.db,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
    listAccessiblePatientIds({
      db: args.db,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
  ]);

  return {
    OR: [
      { case_id: { in: caseIds } },
      {
        AND: [{ case_id: null }, { patient_id: { in: patientIds } }],
      },
      {
        AND: [{ case_id: null }, { patient_id: null }],
      },
    ],
  };
}

export async function canAccessCommunicationRequestRecord(args: {
  db: CommunicationRecordAccessDb;
  orgId: string;
  patientId?: string | null;
  caseId?: string | null;
  accessContext: VisitScheduleAccessContext;
}) {
  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return true;

  if (args.caseId) {
    return canAccessCareCase({
      db: args.db,
      orgId: args.orgId,
      caseId: args.caseId,
      patientId: args.patientId ?? undefined,
      accessContext: args.accessContext,
    });
  }

  if (args.patientId) {
    return canAccessPatient({
      db: args.db,
      orgId: args.orgId,
      patientId: args.patientId,
      accessContext: args.accessContext,
    });
  }

  return true;
}
