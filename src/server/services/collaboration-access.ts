import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { buildVisitRecordScheduleAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';

export const collaborationEntityTypeSchema = z.enum(['dispense_task', 'visit_record']);

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
