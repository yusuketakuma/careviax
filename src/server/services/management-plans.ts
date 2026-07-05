import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { formatUtcDateKey } from '@/lib/date-key';
import { buildPatientHref } from '@/lib/patient/navigation';
import { addUtcDays, japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
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
type OnboardingRenewalDb = {
  patient: {
    findMany(args: unknown): Promise<unknown[]>;
  };
  task: {
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
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

export type OnboardingRenewalIssue =
  | 'missing_visit_consent'
  | 'visit_consent_expired'
  | 'visit_consent_expiring'
  | 'missing_management_plan'
  | 'management_plan_review_overdue'
  | 'management_plan_review_due';

export type OnboardingRenewalSeverity = 'blocking' | 'urgent' | 'warning';

export type OnboardingRenewalBoardItem = {
  key: string;
  issue: OnboardingRenewalIssue;
  severity: OnboardingRenewalSeverity;
  title: string;
  description: string;
  patient: {
    id: string;
    display_id: string | null;
    name: string;
  };
  case: {
    id: string;
    display_id: string | null;
    status: string;
  } | null;
  consent_id: string | null;
  management_plan_id: string | null;
  due_at: string | null;
  assigned_to: string | null;
  task_type: string;
  dedupe_key: string;
  action_href: string;
};

export type OnboardingRenewalBoard = {
  generated_at: string;
  as_of: string;
  window_days: number;
  summary: Record<OnboardingRenewalIssue, number> & {
    total: number;
    blocking: number;
    urgent: number;
    warning: number;
  };
  items: OnboardingRenewalBoardItem[];
};

type OnboardingRenewalPatientRow = {
  id: string;
  display_id: string | null;
  name: string;
  primary_pharmacist_id: string | null;
  primary_staff_id: string | null;
  consents: Array<{
    id: string;
    expiry_date: Date | null;
    obtained_date: Date;
  }>;
  cases: Array<{
    id: string;
    display_id: string | null;
    status: string;
    primary_pharmacist_id: string | null;
    primary_staff_id: string | null;
    management_plans: Array<{
      id: string;
      next_review_date: Date | null;
      effective_from: Date | null;
      version: number;
      approved_at: Date | null;
    }>;
  }>;
};

function isDateActive(date: Date | null | undefined, asOf: Date) {
  return !date || date >= asOf;
}

function isReviewDateOverdue(nextReviewDate: Date | null | undefined, asOf: Date) {
  if (!nextReviewDate) return false;
  return formatUtcDateKey(nextReviewDate) < japanDateKey(asOf);
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
    reviewOverdue: isReviewDateOverdue(approvedPlan.next_review_date, asOf),
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
      reviewOverdue: isReviewDateOverdue(currentPlan?.next_review_date, asOf),
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

const ACTIVE_ONBOARDING_CASE_STATUSES = [
  'referral_received',
  'assessment',
  'active',
  'on_hold',
] as const;
const DEFAULT_RENEWAL_WINDOW_DAYS = 30;
const MAX_RENEWAL_WINDOW_DAYS = 180;
const DEFAULT_RENEWAL_BOARD_LIMIT = 250;
const MAX_RENEWAL_BOARD_LIMIT = 500;

const EMPTY_RENEWAL_ISSUE_COUNTS: Record<OnboardingRenewalIssue, number> = {
  missing_visit_consent: 0,
  visit_consent_expired: 0,
  visit_consent_expiring: 0,
  missing_management_plan: 0,
  management_plan_review_overdue: 0,
  management_plan_review_due: 0,
};

function normalizePositiveInteger(value: number | null | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || value == null) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

export function normalizeRenewalBoardWindowDays(value?: number | null) {
  return normalizePositiveInteger(value, DEFAULT_RENEWAL_WINDOW_DAYS, MAX_RENEWAL_WINDOW_DAYS);
}

export function normalizeRenewalBoardLimit(value?: number | null) {
  return normalizePositiveInteger(value, DEFAULT_RENEWAL_BOARD_LIMIT, MAX_RENEWAL_BOARD_LIMIT);
}

function dateKey(date: Date | null | undefined) {
  return date ? formatUtcDateKey(date) : null;
}

function isBeforeDateKey(date: Date | null | undefined, key: string) {
  const candidateKey = dateKey(date);
  return candidateKey != null && candidateKey < key;
}

function isOnOrBeforeDateKey(date: Date | null | undefined, key: string) {
  const candidateKey = dateKey(date);
  return candidateKey != null && candidateKey <= key;
}

function consentRenewalTaskKey(patientId: string) {
  return `onboarding-renewal:visit-consent:${patientId}`;
}

function managementPlanMissingTaskKey(caseId: string) {
  return `onboarding-renewal:management-plan:${caseId}`;
}

function chooseRenewalAssignee(
  patient: Pick<OnboardingRenewalPatientRow, 'primary_pharmacist_id' | 'primary_staff_id'>,
  careCase?: Pick<
    OnboardingRenewalPatientRow['cases'][number],
    'primary_pharmacist_id' | 'primary_staff_id'
  > | null,
) {
  return (
    careCase?.primary_pharmacist_id ??
    patient.primary_pharmacist_id ??
    careCase?.primary_staff_id ??
    patient.primary_staff_id ??
    null
  );
}

function buildRenewalSummary(
  items: OnboardingRenewalBoardItem[],
): OnboardingRenewalBoard['summary'] {
  const counts = { ...EMPTY_RENEWAL_ISSUE_COUNTS };
  let blocking = 0;
  let urgent = 0;
  let warning = 0;

  for (const item of items) {
    counts[item.issue] += 1;
    if (item.severity === 'blocking') blocking += 1;
    if (item.severity === 'urgent') urgent += 1;
    if (item.severity === 'warning') warning += 1;
  }

  return {
    ...counts,
    total: items.length,
    blocking,
    urgent,
    warning,
  };
}

function consentRenewalItem(args: {
  patient: OnboardingRenewalPatientRow;
  consentId: string | null;
  expiryDate: Date | null;
  issue: Extract<
    OnboardingRenewalIssue,
    'missing_visit_consent' | 'visit_consent_expired' | 'visit_consent_expiring'
  >;
  severity: OnboardingRenewalSeverity;
}) {
  const dueAt = dateKey(args.expiryDate);
  const assignedTo = chooseRenewalAssignee(args.patient);
  const titles: Record<typeof args.issue, string> = {
    missing_visit_consent: '訪問同意が未整備です',
    visit_consent_expired: '訪問同意の期限が切れています',
    visit_consent_expiring: '訪問同意の更新期限が近づいています',
  };
  const descriptions: Record<typeof args.issue, string> = {
    missing_visit_consent: '訪問薬剤管理指導の同意がないため、訪問準備と請求根拠が止まります。',
    visit_consent_expired:
      '訪問薬剤管理指導の同意期限を超過しています。更新後に訪問準備へ戻してください。',
    visit_consent_expiring:
      '訪問薬剤管理指導の同意期限が近づいています。期限前に更新してください。',
  };

  return {
    key: `${args.issue}:${args.patient.id}`,
    issue: args.issue,
    severity: args.severity,
    title: titles[args.issue],
    description: descriptions[args.issue],
    patient: {
      id: args.patient.id,
      display_id: args.patient.display_id,
      name: args.patient.name,
    },
    case: null,
    consent_id: args.consentId,
    management_plan_id: null,
    due_at: dueAt,
    assigned_to: assignedTo,
    task_type: 'visit_consent_renewal',
    dedupe_key: consentRenewalTaskKey(args.patient.id),
    action_href: `${buildPatientHref(args.patient.id)}/consent`,
  } satisfies OnboardingRenewalBoardItem;
}

function managementPlanRenewalItem(args: {
  patient: OnboardingRenewalPatientRow;
  careCase: OnboardingRenewalPatientRow['cases'][number];
  planId: string | null;
  reviewDate: Date | null;
  issue: Extract<
    OnboardingRenewalIssue,
    'missing_management_plan' | 'management_plan_review_overdue' | 'management_plan_review_due'
  >;
  severity: OnboardingRenewalSeverity;
}) {
  const dueAt = dateKey(args.reviewDate);
  const assignedTo = chooseRenewalAssignee(args.patient, args.careCase);
  const titles: Record<typeof args.issue, string> = {
    missing_management_plan: '管理計画書が未承認です',
    management_plan_review_overdue: '管理計画書の見直し期限を超過しています',
    management_plan_review_due: '管理計画書の見直し期限が近づいています',
  };
  const descriptions: Record<typeof args.issue, string> = {
    missing_management_plan:
      '承認済みの訪問薬剤管理指導計画書がないため、訪問業務フローを開始できません。',
    management_plan_review_overdue:
      '承認済み管理計画書の見直し期限を超過しています。次回訪問前に更新してください。',
    management_plan_review_due:
      '承認済み管理計画書の見直し期限が近づいています。期限前に更新してください。',
  };
  const isMissingPlan = args.issue === 'missing_management_plan';

  return {
    key: `${args.issue}:${args.careCase.id}:${args.planId ?? 'missing'}`,
    issue: args.issue,
    severity: args.severity,
    title: titles[args.issue],
    description: descriptions[args.issue],
    patient: {
      id: args.patient.id,
      display_id: args.patient.display_id,
      name: args.patient.name,
    },
    case: {
      id: args.careCase.id,
      display_id: args.careCase.display_id,
      status: args.careCase.status,
    },
    consent_id: null,
    management_plan_id: args.planId,
    due_at: dueAt,
    assigned_to: assignedTo,
    task_type: isMissingPlan ? 'management_plan_missing' : 'management_plan_review',
    dedupe_key: isMissingPlan
      ? managementPlanMissingTaskKey(args.careCase.id)
      : buildManagementPlanReviewTaskKey(args.planId ?? args.careCase.id),
    action_href: `${buildPatientHref(args.patient.id)}/management-plan`,
  } satisfies OnboardingRenewalBoardItem;
}

function buildOnboardingRenewalItems(args: {
  patients: OnboardingRenewalPatientRow[];
  todayKey: string;
  windowEndKey: string;
}) {
  const items: OnboardingRenewalBoardItem[] = [];

  for (const patient of args.patients) {
    const consent = patient.consents[0] ?? null;
    if (!consent) {
      items.push(
        consentRenewalItem({
          patient,
          consentId: null,
          expiryDate: null,
          issue: 'missing_visit_consent',
          severity: 'blocking',
        }),
      );
    } else if (isBeforeDateKey(consent.expiry_date, args.todayKey)) {
      items.push(
        consentRenewalItem({
          patient,
          consentId: consent.id,
          expiryDate: consent.expiry_date,
          issue: 'visit_consent_expired',
          severity: 'blocking',
        }),
      );
    } else if (isOnOrBeforeDateKey(consent.expiry_date, args.windowEndKey)) {
      items.push(
        consentRenewalItem({
          patient,
          consentId: consent.id,
          expiryDate: consent.expiry_date,
          issue: 'visit_consent_expiring',
          severity: 'warning',
        }),
      );
    }

    for (const careCase of patient.cases) {
      const plan = careCase.management_plans[0] ?? null;
      if (!plan) {
        items.push(
          managementPlanRenewalItem({
            patient,
            careCase,
            planId: null,
            reviewDate: null,
            issue: 'missing_management_plan',
            severity: 'blocking',
          }),
        );
      } else if (isBeforeDateKey(plan.next_review_date, args.todayKey)) {
        items.push(
          managementPlanRenewalItem({
            patient,
            careCase,
            planId: plan.id,
            reviewDate: plan.next_review_date,
            issue: 'management_plan_review_overdue',
            severity: 'urgent',
          }),
        );
      } else if (isOnOrBeforeDateKey(plan.next_review_date, args.windowEndKey)) {
        items.push(
          managementPlanRenewalItem({
            patient,
            careCase,
            planId: plan.id,
            reviewDate: plan.next_review_date,
            issue: 'management_plan_review_due',
            severity: 'warning',
          }),
        );
      }
    }
  }

  return items.sort((left, right) => {
    const severityWeight: Record<OnboardingRenewalSeverity, number> = {
      blocking: 0,
      urgent: 1,
      warning: 2,
    };
    const severityDiff = severityWeight[left.severity] - severityWeight[right.severity];
    if (severityDiff !== 0) return severityDiff;
    const leftDue = left.due_at ?? '9999-12-31';
    const rightDue = right.due_at ?? '9999-12-31';
    if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
    return left.patient.name.localeCompare(right.patient.name, 'ja');
  });
}

export async function buildOnboardingRenewalBoard(
  tx: OnboardingRenewalDb,
  args: { orgId: string; now?: Date; windowDays?: number | null; limit?: number | null },
): Promise<OnboardingRenewalBoard> {
  const now = args.now ?? new Date();
  const todayKey = japanDateKey(now);
  const today = utcDateFromLocalKey(todayKey);
  const windowDays = normalizeRenewalBoardWindowDays(args.windowDays);
  const windowEnd = addUtcDays(today, windowDays);
  const windowEndKey = formatUtcDateKey(windowEnd);
  const limit = normalizeRenewalBoardLimit(args.limit);

  const patients = (await tx.patient.findMany({
    where: {
      org_id: args.orgId,
      archived_at: null,
      cases: {
        some: {
          org_id: args.orgId,
          status: { in: ACTIVE_ONBOARDING_CASE_STATUSES },
        },
      },
    },
    orderBy: [{ name_kana: 'asc' }, { name: 'asc' }],
    take: limit,
    select: {
      id: true,
      display_id: true,
      name: true,
      primary_pharmacist_id: true,
      primary_staff_id: true,
      consents: {
        where: {
          org_id: args.orgId,
          consent_type: 'visit_medication_management',
          is_active: true,
          revoked_date: null,
        },
        orderBy: [{ obtained_date: 'desc' }],
        take: 1,
        select: {
          id: true,
          expiry_date: true,
          obtained_date: true,
        },
      },
      cases: {
        where: {
          org_id: args.orgId,
          status: { in: ACTIVE_ONBOARDING_CASE_STATUSES },
        },
        orderBy: [{ updated_at: 'desc' }],
        select: {
          id: true,
          display_id: true,
          status: true,
          primary_pharmacist_id: true,
          primary_staff_id: true,
          management_plans: {
            where: {
              org_id: args.orgId,
              status: 'approved',
              approved_at: { not: null },
              OR: [{ effective_from: null }, { effective_from: { lte: today } }],
            },
            orderBy: [{ effective_from: 'desc' }, { version: 'desc' }, { approved_at: 'desc' }],
            take: 1,
            select: {
              id: true,
              next_review_date: true,
              effective_from: true,
              version: true,
              approved_at: true,
            },
          },
        },
      },
    },
  })) as OnboardingRenewalPatientRow[];

  const items = buildOnboardingRenewalItems({ patients, todayKey, windowEndKey });
  return {
    generated_at: now.toISOString(),
    as_of: todayKey,
    window_days: windowDays,
    summary: buildRenewalSummary(items),
    items,
  };
}

async function syncRenewalItem(
  tx: OnboardingRenewalDb,
  orgId: string,
  item: OnboardingRenewalBoardItem,
) {
  const dueDate = item.due_at ? utcDateFromLocalKey(item.due_at) : null;

  if (
    item.issue === 'management_plan_review_due' ||
    item.issue === 'management_plan_review_overdue'
  ) {
    if (!item.management_plan_id || !item.case) return;
    await scheduleManagementPlanReviewAlert(tx as Tx, {
      orgId,
      planId: item.management_plan_id,
      caseId: item.case.id,
      patientId: item.patient.id,
      dueDate: dueDate ?? new Date(),
      assignedTo: item.assigned_to,
    });
    return;
  }

  await upsertOperationalTask(tx, {
    orgId,
    taskType: item.task_type,
    title: item.title,
    description: item.description,
    priority: item.severity === 'blocking' ? 'high' : 'normal',
    assignedTo: item.assigned_to,
    dueDate,
    slaDueAt: dueDate,
    dedupeKey: item.dedupe_key,
    relatedEntityType: item.case ? 'case' : 'patient',
    relatedEntityId: item.case?.id ?? item.patient.id,
    metadata: {
      issue: item.issue,
      patient_id: item.patient.id,
      case_id: item.case?.id ?? null,
      consent_id: item.consent_id,
      management_plan_id: item.management_plan_id,
      action_href: item.action_href,
    } satisfies Prisma.InputJsonValue,
  });
}

async function resolveRenewalTask(
  tx: OnboardingRenewalDb,
  orgId: string,
  args: { taskType: string; dedupeKey: string },
) {
  const result = await resolveOperationalTasks(tx, {
    orgId,
    taskType: args.taskType,
    dedupeKey: args.dedupeKey,
    status: 'completed',
  });
  return typeof result === 'object' &&
    result !== null &&
    'count' in result &&
    typeof result.count === 'number'
    ? result.count
    : 0;
}

export async function syncOnboardingRenewalTasks(
  tx: OnboardingRenewalDb,
  args: { orgId: string; now?: Date; windowDays?: number | null; limit?: number | null },
) {
  const board = await buildOnboardingRenewalBoard(tx, args);
  const openKeys = new Set(board.items.map((item) => item.dedupe_key));
  let upserted = 0;
  let resolved = 0;

  for (const item of board.items) {
    await syncRenewalItem(tx, args.orgId, item);
    upserted += 1;
  }

  const patients = (await tx.patient.findMany({
    where: {
      org_id: args.orgId,
      archived_at: null,
      cases: {
        some: {
          org_id: args.orgId,
          status: { in: ACTIVE_ONBOARDING_CASE_STATUSES },
        },
      },
    },
    take: normalizeRenewalBoardLimit(args.limit),
    select: {
      id: true,
      cases: {
        where: {
          org_id: args.orgId,
          status: { in: ACTIVE_ONBOARDING_CASE_STATUSES },
        },
        select: {
          id: true,
          management_plans: {
            where: {
              org_id: args.orgId,
              status: 'approved',
              approved_at: { not: null },
            },
            orderBy: [{ effective_from: 'desc' }, { version: 'desc' }, { approved_at: 'desc' }],
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  })) as Array<{
    id: string;
    cases: Array<{ id: string; management_plans: Array<{ id: string }> }>;
  }>;

  for (const patient of patients) {
    const consentKey = consentRenewalTaskKey(patient.id);
    if (!openKeys.has(consentKey)) {
      resolved += await resolveRenewalTask(tx, args.orgId, {
        taskType: 'visit_consent_renewal',
        dedupeKey: consentKey,
      });
    }

    for (const careCase of patient.cases) {
      const missingPlanKey = managementPlanMissingTaskKey(careCase.id);
      if (!openKeys.has(missingPlanKey)) {
        resolved += await resolveRenewalTask(tx, args.orgId, {
          taskType: 'management_plan_missing',
          dedupeKey: missingPlanKey,
        });
      }

      const planId = careCase.management_plans[0]?.id;
      if (planId) {
        const reviewKey = buildManagementPlanReviewTaskKey(planId);
        if (!openKeys.has(reviewKey)) {
          resolved += await resolveRenewalTask(tx, args.orgId, {
            taskType: 'management_plan_review',
            dedupeKey: reviewKey,
          });
        }
      }
    }
  }

  return {
    board,
    synced: {
      upserted,
      resolved,
    },
  };
}
