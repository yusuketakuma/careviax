import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { buildVisitRecordScheduleAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { canAccessPatient } from '@/server/services/patient-access';
import {
  buildMedicationCycleAssignmentWhere,
  buildSetPlanAssignmentWhere,
} from '@/server/services/prescription-access';
import {
  buildCareReportAccessWhere,
  getCareReportAccessScope,
} from '@/server/services/care-report-access';

// patient は P1-13「今だれが見ているか」(患者カード単位の presence)で使う。
// dispense_task/medication_cycle/set_plan/visit_record/care_report はコメント(多職種連携)の対象。
export const collaborationEntityTypeSchema = z.enum([
  'dispense_task',
  'medication_cycle',
  'set_plan',
  'visit_record',
  'care_report',
  'patient',
]);

export type CollaborationEntityType = z.infer<typeof collaborationEntityTypeSchema>;

export const collaborationEntityRefSchema = z.object({
  entity_type: collaborationEntityTypeSchema,
  entity_id: z.string().min(1),
});

export function buildCollaborationRoomName(args: {
  orgId: string;
  entityType: CollaborationEntityType;
  entityId: string;
}) {
  return `${args.orgId}:${args.entityType}:${args.entityId}`;
}

export async function canAccessCollaborationEntity(
  ctx: AuthContext,
  entityType: CollaborationEntityType,
  entityId: string,
) {
  if (entityType === 'dispense_task') {
    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);
    const where: Prisma.DispenseTaskWhereInput = {
      id: entityId,
      org_id: ctx.orgId,
      ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
    };
    const task = await prisma.dispenseTask.findFirst({
      where,
      select: { id: true },
    });
    return Boolean(task);
  }

  if (entityType === 'patient') {
    return canAccessPatient({
      db: prisma,
      orgId: ctx.orgId,
      patientId: entityId,
      accessContext: ctx,
    });
  }

  if (entityType === 'medication_cycle') {
    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);
    const cycle = await prisma.medicationCycle.findFirst({
      where: { id: entityId, org_id: ctx.orgId, ...(cycleAssignmentWhere ?? {}) },
      select: { id: true },
    });
    return Boolean(cycle);
  }

  if (entityType === 'set_plan') {
    const planAssignmentWhere = buildSetPlanAssignmentWhere(ctx);
    const plan = await prisma.setPlan.findFirst({
      where: { id: entityId, org_id: ctx.orgId, ...(planAssignmentWhere ?? {}) },
      select: { id: true },
    });
    return Boolean(plan);
  }

  if (entityType === 'care_report') {
    const scope = await getCareReportAccessScope(prisma, ctx.orgId, ctx);
    const reportWhere = buildCareReportAccessWhere(scope);
    const report = await prisma.careReport.findFirst({
      where: { id: entityId, org_id: ctx.orgId, ...(reportWhere ?? {}) },
      select: { id: true },
    });
    return Boolean(report);
  }

  const visitRecordAssignmentWhere = buildVisitRecordScheduleAssignmentWhere(ctx);
  const where: Prisma.VisitRecordWhereInput = {
    id: entityId,
    org_id: ctx.orgId,
    ...(visitRecordAssignmentWhere ? { AND: [visitRecordAssignmentWhere] } : {}),
  };
  const record = await prisma.visitRecord.findFirst({
    where,
    select: { id: true },
  });
  return Boolean(record);
}
