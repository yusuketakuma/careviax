import { z } from 'zod';
import type { AuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { canBypassVisitScheduleAssignmentAccess } from '@/lib/auth/visit-schedule-access';
import {
  ACTIVE_COLLABORATION_ENTITY_TYPES,
  activeCollaborationAccessRegistry,
  type ActiveCollaborationEntityType,
} from '@/server/collaboration/active-access-registry';

// patient は P1-13「今だれが見ているか」(患者カード単位の presence)で使う。
// dispense_task/medication_cycle/set_plan/visit_record/care_report はコメント(多職種連携)の対象。
export const collaborationEntityTypeSchema = z.enum(ACTIVE_COLLABORATION_ENTITY_TYPES);

export type CollaborationEntityType = ActiveCollaborationEntityType;

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

// org-wide アクセスを持つロール(owner/admin/薬剤師/事務)は、連携エンティティの
// 認可も担当割当スコープを外して org 単位で判定する。これらのロールは
// canBypassVisitScheduleAssignmentAccess に集約済み（事務もここに含まれる）。
function usesOrgScopedCollaborationAccess(ctx: AuthContext): boolean {
  return canBypassVisitScheduleAssignmentAccess(ctx);
}

export async function canAccessCollaborationEntity(
  ctx: AuthContext,
  entityType: string,
  entityId: string,
) {
  const parsedEntityType = collaborationEntityTypeSchema.safeParse(entityType);
  if (!parsedEntityType.success) return false;

  const orgScoped = usesOrgScopedCollaborationAccess(ctx);
  return activeCollaborationAccessRegistry.canAccess({
    ctx,
    db: prisma,
    entityType: parsedEntityType.data,
    entityId,
    orgScoped,
  });
}
