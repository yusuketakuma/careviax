import type { MemberRole, Prisma } from '@prisma/client';

export type VisitScheduleAccessContext = {
  userId: string;
  role: MemberRole;
};

type VisitScheduleAssignmentSubject = {
  pharmacist_id: string | null;
  case_?: {
    primary_pharmacist_id: string | null;
    backup_pharmacist_id: string | null;
  } | null;
};

export function canBypassVisitScheduleAssignmentAccess(
  ctx: Pick<VisitScheduleAccessContext, 'role'>,
) {
  return ctx.role === 'owner' || ctx.role === 'admin';
}

export function canAccessVisitScheduleAssignment(
  ctx: VisitScheduleAccessContext,
  schedule: VisitScheduleAssignmentSubject | null | undefined,
) {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return true;
  if (!schedule) return false;

  return (
    schedule.pharmacist_id === ctx.userId ||
    schedule.case_?.primary_pharmacist_id === ctx.userId ||
    schedule.case_?.backup_pharmacist_id === ctx.userId
  );
}

export function buildVisitScheduleAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.VisitScheduleWhereInput | null {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return null;

  return {
    OR: [
      { pharmacist_id: ctx.userId },
      { case_: { primary_pharmacist_id: ctx.userId } },
      { case_: { backup_pharmacist_id: ctx.userId } },
    ],
  };
}

export function buildVisitRecordScheduleAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.VisitRecordWhereInput | null {
  const scheduleWhere = buildVisitScheduleAssignmentWhere(ctx);
  return scheduleWhere ? { schedule: scheduleWhere } : null;
}
