import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { dispatchNotificationEvent } from './notifications';
import { upsertOperationalTask, resolveOperationalTasks } from './operational-tasks';

type Tx = Prisma.TransactionClient | typeof prisma;
type FindFirstDelegate<T> = {
  findFirst(args: unknown): Promise<T | null>;
};
type GateDb = {
  consentRecord: FindFirstDelegate<{ id: string; expiry_date?: Date | null }>;
  managementPlan: FindFirstDelegate<{
    id: string;
    status?: string;
    next_review_date: Date | null;
  }>;
};

const VISIT_WORKFLOW_GATE_ISSUES = [
  'missing_visit_consent',
  'missing_management_plan',
  'management_plan_review_overdue',
] as const;

export const VISIT_WORKFLOW_GATE_ERROR_PREFIX = 'VISIT_WORKFLOW_GATE:';

export type VisitWorkflowGateIssue = (typeof VISIT_WORKFLOW_GATE_ISSUES)[number];

const VISIT_WORKFLOW_GATE_ISSUE_SET = new Set<string>(VISIT_WORKFLOW_GATE_ISSUES);

type VisitWorkflowGuidanceDefinition = {
  title: string;
  description: string;
  severity: 'urgent' | 'high' | 'normal';
  actionLabel: string;
  actionHref: string;
};

type VisitWorkflowGateResult = {
  ok: boolean;
  issues: VisitWorkflowGateIssue[];
  consentId: string | null;
  managementPlanId: string | null;
};

function isDateActive(date: Date | null | undefined, asOf: Date) {
  return !date || date >= asOf;
}

export async function findActiveVisitConsent(
  tx: GateDb,
  args: { orgId: string; patientId: string; asOf?: Date },
) {
  const asOf = args.asOf ?? new Date();

  return tx.consentRecord.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      consent_type: 'visit_medication_management',
      is_active: true,
      revoked_date: null,
      OR: [{ expiry_date: null }, { expiry_date: { gte: asOf } }],
    },
    orderBy: [{ obtained_date: 'desc' }],
  });
}

export async function findCurrentManagementPlan(
  tx: GateDb,
  args: { orgId: string; caseId: string; asOf?: Date },
) {
  const asOf = args.asOf ?? new Date();

  const approvedPlan = await tx.managementPlan.findFirst({
    where: {
      org_id: args.orgId,
      case_id: args.caseId,
      status: 'approved',
      approved_at: { not: null },
      OR: [{ effective_from: null }, { effective_from: { lte: asOf } }],
    },
    orderBy: [{ effective_from: 'desc' }, { version: 'desc' }, { approved_at: 'desc' }],
  });

  if (!approvedPlan) {
    return {
      current: null,
      reviewOverdue: false,
    };
  }

  return {
    current: approvedPlan,
    reviewOverdue:
      approvedPlan.next_review_date != null && !isDateActive(approvedPlan.next_review_date, asOf),
  };
}

export async function evaluateVisitWorkflowGate(
  tx: GateDb,
  args: {
    orgId: string;
    patientId: string;
    caseId: string;
    asOf?: Date;
  },
): Promise<VisitWorkflowGateResult> {
  const asOf = args.asOf ?? new Date();

  const [consent, plan] = await Promise.all([
    findActiveVisitConsent(tx, { orgId: args.orgId, patientId: args.patientId, asOf }),
    findCurrentManagementPlan(tx, { orgId: args.orgId, caseId: args.caseId, asOf }),
  ]);

  const issues: VisitWorkflowGateIssue[] = [];

  if (!consent) {
    issues.push('missing_visit_consent');
  }
  if (!plan.current) {
    issues.push('missing_management_plan');
  } else if (plan.reviewOverdue) {
    issues.push('management_plan_review_overdue');
  }

  return {
    ok: issues.length === 0,
    issues,
    consentId: consent?.id ?? null,
    managementPlanId: plan.current?.id ?? null,
  };
}

export function formatVisitWorkflowGateIssues(issues: VisitWorkflowGateIssue[]) {
  const labels: Record<VisitWorkflowGateIssue, string> = {
    missing_visit_consent: '訪問薬剤管理の有効同意がありません',
    missing_management_plan: '承認済みの管理計画書がありません',
    management_plan_review_overdue: '管理計画書の見直し期限を超過しています',
  };

  return issues.map((issue) => labels[issue]).join(' / ');
}

export function isVisitWorkflowGateIssue(value: string): value is VisitWorkflowGateIssue {
  return VISIT_WORKFLOW_GATE_ISSUE_SET.has(value);
}

export function parseVisitWorkflowGateErrorMessage(message: string): VisitWorkflowGateIssue[] {
  if (!message.startsWith(VISIT_WORKFLOW_GATE_ERROR_PREFIX)) return [];
  return message
    .slice(VISIT_WORKFLOW_GATE_ERROR_PREFIX.length)
    .split(',')
    .filter(isVisitWorkflowGateIssue);
}

export function getVisitWorkflowGuidance(
  issue: VisitWorkflowGateIssue,
): VisitWorkflowGuidanceDefinition {
  const definitions: Record<VisitWorkflowGateIssue, VisitWorkflowGuidanceDefinition> = {
    missing_visit_consent: {
      title: '訪問同意の取得が必要です',
      description: '訪問薬剤管理指導の有効同意がないため、候補生成と確定を進められません。',
      severity: 'urgent',
      actionLabel: '患者ワークフローで同意を整備',
      actionHref: '/workflow',
    },
    missing_management_plan: {
      title: '管理計画書の承認が必要です',
      description: '承認済み管理計画書がないため、訪問業務フローを開始できません。',
      severity: 'high',
      actionLabel: 'ワークフローで計画書を確認',
      actionHref: '/workflow',
    },
    management_plan_review_overdue: {
      title: '管理計画書の見直しが必要です',
      description: '見直し期限を超過した計画書があります。次回訪問前に更新してください。',
      severity: 'high',
      actionLabel: '見直し対象を確認',
      actionHref: '/workflow',
    },
  };

  return definitions[issue];
}

export function buildManagementPlanReviewTaskKey(planId: string) {
  return `management-plan-review:${planId}`;
}

export async function scheduleManagementPlanReviewAlert(
  tx: Tx,
  args: {
    orgId: string;
    planId: string;
    caseId: string;
    patientId: string;
    dueDate: Date;
    assignedTo?: string | null;
  },
) {
  const dedupeKey = buildManagementPlanReviewTaskKey(args.planId);

  await upsertOperationalTask(tx, {
    orgId: args.orgId,
    taskType: 'management_plan_review',
    title: '管理計画書の見直し期限',
    description: '承認済みの訪問薬剤管理指導計画書の見直し期限が近づいています。',
    priority: 'high',
    assignedTo: args.assignedTo ?? null,
    dueDate: args.dueDate,
    slaDueAt: args.dueDate,
    dedupeKey,
    relatedEntityType: 'management_plan',
    relatedEntityId: args.planId,
    metadata: {
      case_id: args.caseId,
      patient_id: args.patientId,
    } satisfies Prisma.InputJsonValue,
  });

  await dispatchNotificationEvent(tx, {
    orgId: args.orgId,
    eventType: 'management_plan_review_due',
    type: 'reminder',
    title: '管理計画書の見直し期限',
    message: '訪問薬剤管理指導計画書の見直し期限が到来しています。',
    link: `/patients/${args.patientId}`,
    explicitUserIds: args.assignedTo ? [args.assignedTo] : [],
    dedupeKey,
    metadata: {
      plan_id: args.planId,
      case_id: args.caseId,
      patient_id: args.patientId,
    } satisfies Prisma.InputJsonValue,
  });
}

export async function resolveManagementPlanReviewAlert(
  tx: Tx,
  args: { orgId: string; planId: string },
) {
  await resolveOperationalTasks(tx, {
    orgId: args.orgId,
    dedupeKey: buildManagementPlanReviewTaskKey(args.planId),
    status: 'completed',
  });
}
