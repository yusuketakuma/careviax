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

// アクセス（need-to-know）ポリシー:
// 薬剤師(pharmacist / pharmacist_trainee)は組織内の全患者・全業務にフルアクセスでき、
// 事務(clerk)も組織内の全臨床データを参照できる。よって担当割当(assignment)による
// 行スコープは owner/admin と同様にこれらのロールでも撤廃する（org 単位アクセス）。
// 書き込みの可否はこの述語ではなく権限マトリクス(permissions.ts)で制御するため、
// clerk が薬剤師専門業務を書き込めるわけではない（canDispense 等が false）。
// driver / external_viewer は canViewDashboard を持たずこの経路に到達しない。
const ORG_WIDE_ACCESS_ROLES: ReadonlySet<MemberRole> = new Set([
  'owner',
  'admin',
  'pharmacist',
  'pharmacist_trainee',
  'clerk',
]);

const VISIT_HANDOFF_CONFIRM_ROLES: ReadonlySet<MemberRole> = new Set([
  'owner',
  'admin',
  'pharmacist',
]);

export function canBypassVisitScheduleAssignmentAccess(
  ctx: Pick<VisitScheduleAccessContext, 'role'>,
) {
  return ORG_WIDE_ACCESS_ROLES.has(ctx.role);
}

// ダッシュボードの「自分の担当」既定表示は上記アクセス境界とは別概念。
// フルアクセスでも個人の作業キューは担当中心に保つため、ダッシュボードの
// 無スコープ表示は従来どおり owner/admin のみとする（薬剤師は担当を既定表示しつつ
// 任意の患者へアクセス可能）。
export function canViewAllDashboardWork(ctx: Pick<VisitScheduleAccessContext, 'role'>) {
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

function isAssignedToVisitSchedule(
  userId: string,
  schedule: VisitScheduleAssignmentSubject | null | undefined,
) {
  if (!schedule) return false;

  return (
    schedule.pharmacist_id === userId ||
    schedule.case_?.primary_pharmacist_id === userId ||
    schedule.case_?.backup_pharmacist_id === userId
  );
}

export function canConfirmVisitHandoff(
  ctx: VisitScheduleAccessContext,
  schedule: VisitScheduleAssignmentSubject | null | undefined,
) {
  if (!VISIT_HANDOFF_CONFIRM_ROLES.has(ctx.role)) return false;
  return isAssignedToVisitSchedule(ctx.userId, schedule);
}

export function selectVisitHandoffConfirmationAssignee(
  schedule: VisitScheduleAssignmentSubject | null | undefined,
) {
  return (
    schedule?.pharmacist_id ??
    schedule?.case_?.primary_pharmacist_id ??
    schedule?.case_?.backup_pharmacist_id ??
    null
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

// 担当割当(自分が primary/backup/訪問担当の case)を表す素の where。
// アクセス bypass の有無に関係なく「自分の担当」を厳密に絞るため、
// ダッシュボードの個人作業キューなど "mine" 表示で使う。
export function buildPersonalCareCaseAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.CareCaseWhereInput {
  return {
    OR: [
      { primary_pharmacist_id: ctx.userId },
      { backup_pharmacist_id: ctx.userId },
      { visit_schedules: { some: { pharmacist_id: ctx.userId } } },
    ],
  };
}

export function buildCareCaseAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.CareCaseWhereInput | null {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return null;

  return buildPersonalCareCaseAssignmentWhere(ctx);
}

export function buildPersonalPatientAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.PatientWhereInput {
  return {
    OR: [
      { primary_pharmacist_id: ctx.userId },
      { backup_pharmacist_id: ctx.userId },
      { primary_staff_id: ctx.userId },
      { backup_staff_id: ctx.userId },
      { cases: { some: { visit_schedules: { some: { pharmacist_id: ctx.userId } } } } },
    ],
  };
}

export function buildVisitScheduleProposalAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.VisitScheduleProposalWhereInput | null {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return null;

  return {
    OR: [
      { proposed_pharmacist_id: ctx.userId },
      { case_: { primary_pharmacist_id: ctx.userId } },
      { case_: { backup_pharmacist_id: ctx.userId } },
      { case_: { visit_schedules: { some: { pharmacist_id: ctx.userId } } } },
    ],
  };
}

export function buildVisitScheduleProposalCaseAccessWhere(
  ctx: VisitScheduleAccessContext,
  proposedPharmacistId?: string | null,
): Prisma.CareCaseWhereInput | null {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return null;
  if (proposedPharmacistId && proposedPharmacistId === ctx.userId) return null;

  return buildCareCaseAssignmentWhere(ctx);
}

export function buildPatientAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.PatientWhereInput | null {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return null;

  return buildPersonalPatientAssignmentWhere(ctx);
}

export function applyPatientAssignmentWhere(
  where: Prisma.PatientWhereInput,
  ctx: VisitScheduleAccessContext,
): Prisma.PatientWhereInput {
  const patientAssignmentWhere = buildPatientAssignmentWhere(ctx);
  if (!patientAssignmentWhere) return where;

  const existingAnd = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];

  return {
    ...where,
    AND: [...existingAnd, patientAssignmentWhere],
  };
}

export function buildVisitRecordScheduleAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.VisitRecordWhereInput | null {
  const scheduleWhere = buildVisitScheduleAssignmentWhere(ctx);
  return scheduleWhere ? { schedule: scheduleWhere } : null;
}

export function buildVisitHandoffConfirmationWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.VisitRecordWhereInput | null {
  if (!VISIT_HANDOFF_CONFIRM_ROLES.has(ctx.role)) return null;

  return {
    schedule: {
      OR: [
        { pharmacist_id: ctx.userId },
        { case_: { primary_pharmacist_id: ctx.userId } },
        { case_: { backup_pharmacist_id: ctx.userId } },
      ],
    },
  };
}
