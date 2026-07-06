import type { Prisma, PrismaClient } from '@prisma/client';
import type { AuthContext } from '@/lib/auth/context';
import { buildVisitRecordScheduleAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import type { CollaborationAccessProvider } from '@/core/collaboration/registry';
import { canAccessPatient } from '@/server/services/patient-access';
import {
  buildCareReportAccessWhere,
  getCareReportAccessScope,
} from '@/server/services/care-report-access';

type CoreCollaborationAccessDb = Pick<
  PrismaClient,
  'patient' | 'visitRecord' | 'careReport' | 'careCase'
>;

export type CoreCollaborationEntityType = 'patient' | 'visit_record' | 'care_report';
export type CoreCollaborationAccessProvider = CollaborationAccessProvider<
  AuthContext,
  CoreCollaborationAccessDb,
  CoreCollaborationEntityType
>;

const patientCollaborationAccessProvider: CoreCollaborationAccessProvider = {
  entityType: 'patient',
  async canAccess({ ctx, db, entityId, orgScoped }) {
    if (orgScoped) {
      const patient = await db.patient.findFirst({
        where: { id: entityId, org_id: ctx.orgId },
        select: { id: true },
      });
      return Boolean(patient);
    }

    return canAccessPatient({
      db,
      orgId: ctx.orgId,
      patientId: entityId,
      accessContext: ctx,
    });
  },
};

const visitRecordCollaborationAccessProvider: CoreCollaborationAccessProvider = {
  entityType: 'visit_record',
  async canAccess({ ctx, db, entityId, orgScoped }) {
    const visitRecordAssignmentWhere = orgScoped
      ? null
      : buildVisitRecordScheduleAssignmentWhere(ctx);
    const where: Prisma.VisitRecordWhereInput = {
      id: entityId,
      org_id: ctx.orgId,
      ...(visitRecordAssignmentWhere ? { AND: [visitRecordAssignmentWhere] } : {}),
    };
    const record = await db.visitRecord.findFirst({
      where,
      select: { id: true },
    });
    return Boolean(record);
  },
};

const careReportCollaborationAccessProvider: CoreCollaborationAccessProvider = {
  entityType: 'care_report',
  async canAccess({ ctx, db, entityId, orgScoped }) {
    if (orgScoped) {
      const report = await db.careReport.findFirst({
        where: { id: entityId, org_id: ctx.orgId },
        select: { id: true },
      });
      return Boolean(report);
    }

    const scope = await getCareReportAccessScope(db, ctx.orgId, ctx);
    const reportWhere = buildCareReportAccessWhere(scope);
    const report = await db.careReport.findFirst({
      where: { id: entityId, org_id: ctx.orgId, ...(reportWhere ?? {}) },
      select: { id: true },
    });
    return Boolean(report);
  },
};

export function createCoreCollaborationAccessProviders() {
  return [
    patientCollaborationAccessProvider,
    visitRecordCollaborationAccessProvider,
    careReportCollaborationAccessProvider,
  ] as const;
}
