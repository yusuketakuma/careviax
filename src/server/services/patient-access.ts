import type { Prisma } from '@prisma/client';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';

type PatientAccessDb = {
  patient: {
    findFirst(args: {
      where: Prisma.PatientWhereInput;
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  careCase?: {
    findFirst(args: {
      where: Prisma.CareCaseWhereInput;
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

type PatientCaseListDb = PatientAccessDb & {
  careCase: NonNullable<PatientAccessDb['careCase']> & {
    findMany(args: {
      where: Prisma.CareCaseWhereInput;
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
};

export async function canAccessPatient(args: {
  db: PatientAccessDb;
  orgId: string;
  patientId: string;
  accessContext: VisitScheduleAccessContext;
}) {
  const patient = await args.db.patient.findFirst({
    where: applyPatientAssignmentWhere(
      {
        id: args.patientId,
        org_id: args.orgId,
      },
      args.accessContext,
    ),
    select: { id: true },
  });

  return patient !== null;
}

export async function canAccessCareCase(args: {
  db: PatientAccessDb & Required<Pick<PatientAccessDb, 'careCase'>>;
  orgId: string;
  caseId: string;
  patientId?: string;
  accessContext: VisitScheduleAccessContext;
}) {
  const caseAssignmentWhere = buildCareCaseAssignmentWhere(args.accessContext);
  const careCase = await args.db.careCase.findFirst({
    where: {
      id: args.caseId,
      org_id: args.orgId,
      ...(args.patientId ? { patient_id: args.patientId } : {}),
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
    select: { id: true },
  });

  return careCase !== null;
}

export async function canAccessCaseScopedPatientResource(args: {
  db: PatientAccessDb & Required<Pick<PatientAccessDb, 'careCase'>>;
  orgId: string;
  patientId: string;
  caseId?: string | null;
  accessContext: VisitScheduleAccessContext;
}) {
  if (args.caseId) {
    return canAccessCareCase({
      db: args.db,
      orgId: args.orgId,
      caseId: args.caseId,
      patientId: args.patientId,
      accessContext: args.accessContext,
    });
  }

  return canAccessPatient({
    db: args.db,
    orgId: args.orgId,
    patientId: args.patientId,
    accessContext: args.accessContext,
  });
}

export async function listAccessiblePatientCaseIds(args: {
  db: PatientCaseListDb;
  orgId: string;
  patientId: string;
  accessContext: VisitScheduleAccessContext;
}) {
  const caseAssignmentWhere = buildCareCaseAssignmentWhere(args.accessContext);
  const careCases = await args.db.careCase.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
    select: { id: true },
  });

  return careCases.map((careCase) => careCase.id);
}
