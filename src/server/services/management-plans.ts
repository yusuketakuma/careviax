import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { buildPatientHref } from '@/lib/patient/navigation';
import { dispatchNotificationEvent } from './notifications';
import { upsertOperationalTask, resolveOperationalTasks } from './operational-tasks';

type Tx = Prisma.TransactionClient | typeof prisma;
type FindFirstDelegate<T> = {
  findFirst(args: unknown): Promise<T | null>;
};
type FindManyDelegate<T> = {
  findMany(args: unknown): Promise<T[]>;
};
type ConsentGateRecord = { id: string; expiry_date?: Date | null; obtained_date?: Date | null };
type ManagementPlanGateRecord = {
  id: string;
  status?: string;
  next_review_date: Date | null;
  effective_from?: Date | null;
  version?: number;
  approved_at?: Date | null;
};
type GateDb = {
  consentRecord: FindFirstDelegate<ConsentGateRecord>;
  managementPlan: FindFirstDelegate<ManagementPlanGateRecord>;
};
type BatchGateDb = {
  consentRecord: FindManyDelegate<ConsentGateRecord>;
  managementPlan: FindManyDelegate<ManagementPlanGateRecord>;
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

function compareConsentRecords(left: ConsentGateRecord, right: ConsentGateRecord) {
  return (right.obtained_date?.getTime() ?? 0) - (left.obtained_date?.getTime() ?? 0);
}

function compareManagementPlans(left: ManagementPlanGateRecord, right: ManagementPlanGateRecord) {
  const effectiveDiff =
    (right.effective_from?.getTime() ?? 0) - (left.effective_from?.getTime() ?? 0);
  if (effectiveDiff !== 0) return effectiveDiff;

  const versionDiff = (right.version ?? 0) - (left.version ?? 0);
  if (versionDiff !== 0) return versionDiff;

  return (right.approved_at?.getTime() ?? 0) - (left.approved_at?.getTime() ?? 0);
}

function buildVisitWorkflowGateResult(args: {
  consent: ConsentGateRecord | null;
  plan: {
    current: ManagementPlanGateRecord | null;
    reviewOverdue: boolean;
  };
}): VisitWorkflowGateResult {
  const issues: VisitWorkflowGateIssue[] = [];

  if (!args.consent) {
    issues.push('missing_visit_consent');
  }
  if (!args.plan.current) {
    issues.push('missing_management_plan');
  } else if (args.plan.reviewOverdue) {
    issues.push('management_plan_review_overdue');
  }

  return {
    ok: issues.length === 0,
    issues,
    consentId: args.consent?.id ?? null,
    managementPlanId: args.plan.current?.id ?? null,
  };
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

  return buildVisitWorkflowGateResult({ consent, plan });
}

export async function evaluateVisitWorkflowGates(
  tx: BatchGateDb,
  args: {
    orgId: string;
    patientId: string;
    caseId: string;
    asOfDates: Date[];
  },
): Promise<VisitWorkflowGateResult[]> {
  if (args.asOfDates.length === 0) return [];

  const minAsOf = new Date(Math.min(...args.asOfDates.map((date) => date.getTime())));
  const maxAsOf = new Date(Math.max(...args.asOfDates.map((date) => date.getTime())));
  const [consents, plans] = await Promise.all([
    tx.consentRecord.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        consent_type: 'visit_medication_management',
        is_active: true,
        revoked_date: null,
        OR: [{ expiry_date: null }, { expiry_date: { gte: minAsOf } }],
      },
      orderBy: [{ obtained_date: 'desc' }],
      select: {
        id: true,
        expiry_date: true,
        obtained_date: true,
      },
    }),
    tx.managementPlan.findMany({
      where: {
        org_id: args.orgId,
        case_id: args.caseId,
        status: 'approved',
        approved_at: { not: null },
        OR: [{ effective_from: null }, { effective_from: { lte: maxAsOf } }],
      },
      orderBy: [{ effective_from: 'desc' }, { version: 'desc' }, { approved_at: 'desc' }],
      select: {
        id: true,
        next_review_date: true,
        effective_from: true,
        version: true,
        approved_at: true,
      },
    }),
  ]);

  const orderedConsents = [...consents].sort(compareConsentRecords);
  const orderedPlans = [...plans].sort(compareManagementPlans);

  return args.asOfDates.map((asOf) => {
    const consent =
      orderedConsents.find((candidate) => isDateActive(candidate.expiry_date, asOf)) ?? null;
    const currentPlan =
      orderedPlans.find(
        (candidate) => candidate.effective_from == null || candidate.effective_from <= asOf,
      ) ?? null;
    const plan = {
      current: currentPlan,
      reviewOverdue:
        currentPlan?.next_review_date != null && !isDateActive(currentPlan.next_review_date, asOf),
    };

    return buildVisitWorkflowGateResult({ consent, plan });
  });
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
  const patientHref = buildPatientHref(args.patientId);

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
    link: patientHref,
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
