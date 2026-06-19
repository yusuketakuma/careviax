import type { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth/context';
import { canBypassVisitScheduleAssignmentAccess } from '@/lib/auth/visit-schedule-access';
import type { VisitScheduleAccessContext } from '@/lib/auth/visit-schedule-access';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import {
  canAccessCareCase,
  canAccessPatient,
  listAccessiblePatientIds,
  listAccessibleCareCaseIds,
} from '@/server/services/patient-access';
import { canOutputCareReport } from '@/server/services/care-report-output-policy';

type CommunicationScopeDb = Parameters<typeof listAccessibleCareCaseIds>[0]['db'] &
  Parameters<typeof listAccessiblePatientIds>[0]['db'];

type CommunicationRecordAccessDb = Parameters<typeof canAccessPatient>[0]['db'] &
  Parameters<typeof canAccessCareCase>[0]['db'];

type CommunicationWritablePatientDb = Parameters<typeof requireWritablePatient>[0] &
  Pick<Prisma.TransactionClient, 'careCase'>;

export function isCareReportCommunicationRequest(relatedEntityType?: string | null) {
  return relatedEntityType === 'care_report';
}

export function canAccessCareReportCommunication(role: AuthContext['role']) {
  return canOutputCareReport(role);
}

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

export async function requireWritableCommunicationRequestPatient(args: {
  db: CommunicationWritablePatientDb;
  ctx: AuthContext;
  scope: { patient_id: string | null; case_id: string | null };
}) {
  if (args.scope.patient_id) {
    return requireWritablePatient(args.db, args.ctx, args.scope.patient_id);
  }

  if (!args.scope.case_id) return null;

  const careCase = await args.db.careCase.findFirst({
    where: { id: args.scope.case_id, org_id: args.ctx.orgId },
    select: { patient_id: true },
  });
  if (!careCase) return null;

  return requireWritablePatient(args.db, args.ctx, careCase.patient_id);
}

export function resolveTracingReportCommunicationScope(args: {
  requestedPatientId?: string | null;
  requestedCaseId?: string | null;
  tracingReport: {
    patient_id: string;
    case_id: string | null;
  };
}): { patientId: string; caseId: string | null } | null {
  const requestedPatientId = args.requestedPatientId ?? null;
  const requestedCaseId = args.requestedCaseId ?? null;

  if (requestedPatientId && requestedPatientId !== args.tracingReport.patient_id) {
    return null;
  }

  if (requestedCaseId && requestedCaseId !== args.tracingReport.case_id) {
    return null;
  }

  return {
    patientId: requestedPatientId ?? args.tracingReport.patient_id,
    caseId: requestedCaseId ?? args.tracingReport.case_id ?? null,
  };
}

export function resolveCareReportCommunicationScope(args: {
  requestedPatientId?: string | null;
  requestedCaseId?: string | null;
  careReport: {
    patient_id: string;
    case_id: string | null;
  };
}): { patientId: string; caseId: string | null } | null {
  const requestedPatientId = args.requestedPatientId ?? null;
  const requestedCaseId = args.requestedCaseId ?? null;

  if (requestedPatientId && requestedPatientId !== args.careReport.patient_id) {
    return null;
  }

  if (requestedCaseId && requestedCaseId !== args.careReport.case_id) {
    return null;
  }

  return {
    patientId: requestedPatientId ?? args.careReport.patient_id,
    caseId: requestedCaseId ?? args.careReport.case_id ?? null,
  };
}
