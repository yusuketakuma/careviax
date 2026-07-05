import type { MemberRole, Prisma, PrismaClient } from '@prisma/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { buildPatientHref } from '@/lib/patient/navigation';
import {
  RISK_DOMAIN_LABELS,
  RISK_DOMAIN_ORDER,
  RISK_SEVERITY_RANK,
  createRiskFinding,
  statusFromRiskFindings,
  summarizeRiskFindings,
} from '@/lib/risk/risk-finding';
import { japanDateKey } from '@/lib/utils/date-boundary';
import { describeBillingEvidenceBlockers } from '@/server/services/billing-evidence/core';
import {
  adaptBillingEvidenceBlockerToRiskFinding,
  adaptCareReportToRiskFinding,
  adaptOperationalTaskToRiskFinding,
} from '@/server/services/risk-finding-registry';
import type {
  CaseRiskCockpitResponse,
  CaseRiskCockpitSection,
  CaseRiskFinding,
  CaseRiskNextAction,
} from '@/types/case-risk-cockpit';

type FindFirstDelegate<T> = {
  findFirst(args: unknown): Promise<T | null>;
};

type FindManyDelegate<T> = {
  findMany(args: unknown): Promise<T[]>;
};

type CaseRiskCockpitDbReader = {
  careCase: FindFirstDelegate<CaseRiskCaseRow>;
  consentRecord: FindFirstDelegate<ConsentRow>;
  firstVisitDocument: FindFirstDelegate<FirstVisitDocumentRow>;
  managementPlan: FindFirstDelegate<ManagementPlanRow>;
  visitSchedule: FindManyDelegate<VisitScheduleRow>;
  careReport: FindManyDelegate<CareReportRow>;
  task: FindManyDelegate<TaskRow>;
  billingEvidence: FindManyDelegate<BillingEvidenceRow>;
};

export type CaseRiskCockpitDb = PrismaClient | Prisma.TransactionClient | CaseRiskCockpitDbReader;

type CaseRiskCaseRow = {
  id: string;
  display_id: string | null;
  status: string;
  patient_id: string;
  primary_pharmacist_id: string | null;
  primary_staff_id: string | null;
  patient: {
    id: string;
    display_id: string | null;
    name: string;
  };
};

type ConsentRow = {
  id: string;
  expiry_date: Date | null;
};

type ManagementPlanRow = {
  id: string;
  next_review_date: Date | null;
};

type FirstVisitDocumentRow = {
  id: string;
  delivered_at: Date | null;
};

type VisitScheduleRow = {
  id: string;
  display_id: string | null;
  schedule_status: string;
  scheduled_date: Date;
  carry_items_status: string | null;
  preparation: {
    id: string;
    medication_changes_reviewed: boolean;
    carry_items_confirmed: boolean;
    previous_issues_reviewed: boolean;
    route_confirmed: boolean;
    offline_synced: boolean;
  } | null;
  visit_record: {
    id: string;
  } | null;
};

type CareReportRow = {
  id: string;
  display_id: string | null;
  status: string;
  updated_at: Date;
};

type TaskRow = {
  id: string;
  task_type: string;
  title: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  status: string;
  assigned_to: string | null;
  due_date: Date | null;
  sla_due_at: Date | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
};

type BillingEvidenceRow = {
  id: string;
  patient_id: string | null;
  visit_record_id: string | null;
  claimable: boolean;
  exclusion_reason: string | null;
  same_month_exclusion_flags: Prisma.JsonValue | null;
  validation_notes: Prisma.JsonValue | null;
};

type GetCaseRiskCockpitArgs = {
  orgId: string;
  caseId: string;
  userId: string;
  role: MemberRole;
  now?: Date;
};

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function isBeforeDay(left: Date | null | undefined, right: Date) {
  if (!left) return false;
  return japanDateKey(left) < japanDateKey(right);
}

function priorityFromSeverity(
  severity: CaseRiskFinding['severity'],
): CaseRiskNextAction['priority'] {
  if (severity === 'blocking' || severity === 'urgent') return 'urgent';
  if (severity === 'warning') return 'high';
  return 'normal';
}

function addFinding(
  findings: CaseRiskFinding[],
  input: Omit<CaseRiskFinding, 'resolution_state' | 'source'> &
    Partial<Pick<CaseRiskFinding, 'resolution_state' | 'source'>>,
) {
  findings.push(createRiskFinding(input));
}

function buildSections(findings: CaseRiskFinding[]): CaseRiskCockpitSection[] {
  const byDomain = new Map<CaseRiskFinding['domain'], CaseRiskFinding[]>();
  for (const finding of findings) {
    const bucket = byDomain.get(finding.domain) ?? [];
    bucket.push(finding);
    byDomain.set(finding.domain, bucket);
  }

  return RISK_DOMAIN_ORDER.map((domain) => {
    const sectionFindings = (byDomain.get(domain) ?? []).sort(
      (left, right) =>
        RISK_SEVERITY_RANK[left.severity] - RISK_SEVERITY_RANK[right.severity] ||
        left.key.localeCompare(right.key),
    );
    return {
      domain,
      label: RISK_DOMAIN_LABELS[domain],
      status: statusFromRiskFindings(sectionFindings),
      findings: sectionFindings,
    };
  });
}

function buildNextActions(findings: readonly CaseRiskFinding[]): CaseRiskNextAction[] {
  return findings
    .filter((finding) => finding.resolution_state === 'open' && finding.severity !== 'info')
    .sort((left, right) => {
      const severityDiff = RISK_SEVERITY_RANK[left.severity] - RISK_SEVERITY_RANK[right.severity];
      if (severityDiff !== 0) return severityDiff;
      return (
        (left.due_at ?? '').localeCompare(right.due_at ?? '') || left.key.localeCompare(right.key)
      );
    })
    .slice(0, 8)
    .map((finding) => ({
      task_id: finding.related_entity_type === 'task' ? finding.related_entity_id : null,
      label: finding.action_label,
      priority: priorityFromSeverity(finding.severity),
      due_at: finding.due_at ?? null,
      action_href: finding.action_href,
    }));
}

function pushConsentPlanFindings(args: {
  findings: CaseRiskFinding[];
  patientHref: string;
  patientId: string;
  caseId: string;
  consent: ConsentRow | null;
  managementPlan: ManagementPlanRow | null;
  firstVisitDocument: FirstVisitDocumentRow | null;
  now: Date;
}) {
  const base = { patient_id: args.patientId, case_id: args.caseId };
  if (!args.consent) {
    addFinding(args.findings, {
      key: 'missing_visit_consent',
      domain: 'consent_plan',
      severity: 'blocking',
      title: '訪問同意の取得が必要です',
      detail: '訪問薬剤管理の有効同意がないため、訪問・算定の前提を満たしていません。',
      ...base,
      related_entity_type: 'consent_record',
      related_entity_id: null,
      action_href: `${args.patientHref}/consent`,
      action_label: '同意を整備',
    });
  }

  if (!args.managementPlan) {
    addFinding(args.findings, {
      key: 'missing_management_plan',
      domain: 'consent_plan',
      severity: 'blocking',
      title: '承認済み管理計画書がありません',
      detail: '管理計画書が未承認のため、訪問準備と請求根拠を確定できません。',
      ...base,
      related_entity_type: 'management_plan',
      related_entity_id: null,
      action_href: `${args.patientHref}/management-plan`,
      action_label: '計画書を確認',
    });
  } else if (isBeforeDay(args.managementPlan.next_review_date, args.now)) {
    addFinding(args.findings, {
      key: 'management_plan_review_overdue',
      domain: 'consent_plan',
      severity: 'blocking',
      title: '管理計画書の見直し期限超過',
      detail: '承認済み管理計画書の見直し期限を超過しています。',
      ...base,
      related_entity_type: 'management_plan',
      related_entity_id: args.managementPlan.id,
      due_at: toIso(args.managementPlan.next_review_date),
      action_href: `${args.patientHref}/management-plan`,
      action_label: '計画書を見直す',
    });
  }

  if (!args.firstVisitDocument?.delivered_at) {
    addFinding(args.findings, {
      key: 'first_visit_document_not_delivered',
      domain: 'patient_foundation',
      severity: 'warning',
      title: '初回訪問説明書の交付が未完了です',
      detail: '初回訪問の説明書交付履歴が確認できません。',
      ...base,
      related_entity_type: 'first_visit_document',
      related_entity_id: args.firstVisitDocument?.id ?? null,
      action_href: args.patientHref,
      action_label: '患者正本を確認',
    });
  }
}

function pushVisitFindings(args: {
  findings: CaseRiskFinding[];
  patientHref: string;
  patientId: string;
  caseId: string;
  schedules: VisitScheduleRow[];
}) {
  const schedule = args.schedules[0] ?? null;
  if (!schedule) {
    addFinding(args.findings, {
      key: 'no_upcoming_visit_schedule',
      domain: 'visit_preparation',
      severity: 'info',
      title: '予定中の訪問がありません',
      detail: 'このケースに予定中または準備中の訪問予定はありません。',
      patient_id: args.patientId,
      case_id: args.caseId,
      related_entity_type: 'case',
      related_entity_id: args.caseId,
      action_href: `${args.patientHref}?tab=visits`,
      action_label: '訪問予定を確認',
    });
    return;
  }

  if (schedule.carry_items_status === 'blocked') {
    addFinding(args.findings, {
      key: `visit_carry_items_blocked:${schedule.id}`,
      domain: 'visit_preparation',
      severity: 'blocking',
      title: '訪問持参物がブロック中です',
      detail: '訪問前に持参物の未解決項目を確認してください。',
      patient_id: args.patientId,
      case_id: args.caseId,
      related_entity_type: 'visit_schedule',
      related_entity_id: schedule.id,
      due_at: toIso(schedule.scheduled_date),
      action_href: `/visits/${encodeURIComponent(schedule.id)}/preparation`,
      action_label: '訪問準備を確認',
    });
  }

  if (!schedule.preparation) {
    addFinding(args.findings, {
      key: `visit_preparation_missing:${schedule.id}`,
      domain: 'visit_preparation',
      severity: 'warning',
      title: '訪問準備チェックが未作成です',
      detail: '訪問準備チェックリストを作成し、出発前確認を完了してください。',
      patient_id: args.patientId,
      case_id: args.caseId,
      related_entity_type: 'visit_schedule',
      related_entity_id: schedule.id,
      due_at: toIso(schedule.scheduled_date),
      action_href: `/visits/${encodeURIComponent(schedule.id)}/preparation`,
      action_label: '準備を開始',
    });
    return;
  }

  const missingChecklist = [
    ['medication_changes_reviewed', schedule.preparation.medication_changes_reviewed],
    ['carry_items_confirmed', schedule.preparation.carry_items_confirmed],
    ['previous_issues_reviewed', schedule.preparation.previous_issues_reviewed],
    ['route_confirmed', schedule.preparation.route_confirmed],
    ['offline_synced', schedule.preparation.offline_synced],
  ].filter(([, completed]) => !completed);

  if (missingChecklist.length > 0) {
    addFinding(args.findings, {
      key: `visit_preparation_incomplete:${schedule.id}`,
      domain: 'visit_preparation',
      severity: 'warning',
      title: '訪問準備チェックが未完了です',
      detail: '薬剤変更、持参物、前回課題、ルート、オフライン同期の確認が残っています。',
      patient_id: args.patientId,
      case_id: args.caseId,
      related_entity_type: 'visit_preparation',
      related_entity_id: schedule.preparation.id,
      due_at: toIso(schedule.scheduled_date),
      action_href: `/visits/${encodeURIComponent(schedule.id)}/preparation`,
      action_label: '未完了チェックを確認',
    });
  }
}

function pushReportFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  reports: CareReportRow[];
}) {
  for (const report of args.reports) {
    const finding = adaptCareReportToRiskFinding(report, {
      patientId: args.patientId,
      caseId: args.caseId,
    });
    if (finding) args.findings.push(finding);
  }
}

function pushTaskFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  tasks: TaskRow[];
  now: Date;
}) {
  for (const task of args.tasks) {
    args.findings.push(
      adaptOperationalTaskToRiskFinding(task, {
        patientId: args.patientId,
        caseId: args.caseId,
        now: args.now,
      }),
    );
  }
}

function pushBillingFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  visitRecordIds: Set<string>;
  billingEvidence: BillingEvidenceRow[];
}) {
  for (const evidence of args.billingEvidence) {
    if (!evidence.visit_record_id || !args.visitRecordIds.has(evidence.visit_record_id)) continue;
    if (evidence.patient_id && evidence.patient_id !== args.patientId) continue;

    const blockers = describeBillingEvidenceBlockers({
      claimable: evidence.claimable,
      exclusionReason: evidence.exclusion_reason,
      sameMonthExclusionFlags: evidence.same_month_exclusion_flags,
      patientId: args.patientId,
      visitRecordId: evidence.visit_record_id,
    });

    for (const blocker of blockers) {
      args.findings.push(
        adaptBillingEvidenceBlockerToRiskFinding(blocker, {
          patientId: args.patientId,
          caseId: args.caseId,
          visitRecordId: evidence.visit_record_id,
          billingEvidenceId: evidence.id,
        }),
      );
    }
  }
}

export async function getCaseRiskCockpit(
  db: CaseRiskCockpitDb,
  args: GetCaseRiskCockpitArgs,
): Promise<CaseRiskCockpitResponse | null> {
  const now = args.now ?? new Date();
  const assignmentWhere = buildCareCaseAssignmentWhere({
    userId: args.userId,
    role: args.role,
  });

  const careCase = (await db.careCase.findFirst({
    where: {
      id: args.caseId,
      org_id: args.orgId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    select: {
      id: true,
      display_id: true,
      status: true,
      patient_id: true,
      primary_pharmacist_id: true,
      primary_staff_id: true,
      patient: {
        select: {
          id: true,
          display_id: true,
          name: true,
        },
      },
    },
  })) as CaseRiskCaseRow | null;
  if (!careCase) return null;

  const patientHref = buildPatientHref(careCase.patient.id);

  const [consent, managementPlan, firstVisitDocument, schedules, reports, tasks] =
    await Promise.all([
      db.consentRecord.findFirst({
        where: {
          org_id: args.orgId,
          patient_id: careCase.patient_id,
          consent_type: 'visit_medication_management',
          is_active: true,
          revoked_date: null,
          OR: [{ expiry_date: null }, { expiry_date: { gte: now } }],
        },
        orderBy: [{ obtained_date: 'desc' }],
        select: {
          id: true,
          expiry_date: true,
        },
      }),
      db.managementPlan.findFirst({
        where: {
          org_id: args.orgId,
          case_id: careCase.id,
          status: 'approved',
          approved_at: { not: null },
          OR: [{ effective_from: null }, { effective_from: { lte: now } }],
        },
        orderBy: [{ effective_from: 'desc' }, { version: 'desc' }, { approved_at: 'desc' }],
        select: {
          id: true,
          next_review_date: true,
        },
      }),
      db.firstVisitDocument.findFirst({
        where: {
          org_id: args.orgId,
          patient_id: careCase.patient_id,
          case_id: careCase.id,
        },
        orderBy: [{ created_at: 'desc' }],
        select: {
          id: true,
          delivered_at: true,
        },
      }),
      db.visitSchedule.findMany({
        where: {
          org_id: args.orgId,
          case_id: careCase.id,
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
          },
        },
        orderBy: [{ scheduled_date: 'asc' }, { updated_at: 'desc' }],
        take: 5,
        select: {
          id: true,
          display_id: true,
          schedule_status: true,
          scheduled_date: true,
          carry_items_status: true,
          preparation: {
            select: {
              id: true,
              medication_changes_reviewed: true,
              carry_items_confirmed: true,
              previous_issues_reviewed: true,
              route_confirmed: true,
              offline_synced: true,
            },
          },
          visit_record: {
            select: {
              id: true,
            },
          },
        },
      }),
      db.careReport.findMany({
        where: {
          org_id: args.orgId,
          patient_id: careCase.patient_id,
          case_id: careCase.id,
          status: { in: ['failed', 'response_waiting'] },
        },
        orderBy: [{ updated_at: 'desc' }],
        take: 5,
        select: {
          id: true,
          display_id: true,
          status: true,
          updated_at: true,
        },
      }),
      db.task.findMany({
        where: {
          org_id: args.orgId,
          status: { in: ['pending', 'in_progress'] },
          OR: [
            { related_entity_type: 'case', related_entity_id: careCase.id },
            { related_entity_type: 'patient', related_entity_id: careCase.patient_id },
          ],
        },
        orderBy: [{ priority: 'asc' }, { sla_due_at: 'asc' }, { due_date: 'asc' }],
        take: 8,
        select: {
          id: true,
          task_type: true,
          title: true,
          priority: true,
          status: true,
          assigned_to: true,
          due_date: true,
          sla_due_at: true,
          related_entity_type: true,
          related_entity_id: true,
        },
      }),
    ]);

  const scopedConsent = consent as ConsentRow | null;
  const scopedManagementPlan = managementPlan as ManagementPlanRow | null;
  const scopedFirstVisitDocument = firstVisitDocument as FirstVisitDocumentRow | null;
  const selectedSchedules = schedules as VisitScheduleRow[];
  const selectedReports = reports as CareReportRow[];
  const selectedTasks = tasks as TaskRow[];

  const visitRecordIds = selectedSchedules
    .map((schedule) => schedule.visit_record?.id)
    .filter((id): id is string => Boolean(id));

  const billingEvidence =
    visitRecordIds.length === 0
      ? []
      : ((await db.billingEvidence.findMany({
          where: {
            org_id: args.orgId,
            claimable: false,
            OR: [{ patient_id: null }, { patient_id: careCase.patient_id }],
            visit_record_id: { in: visitRecordIds },
          },
          orderBy: [{ billing_month: 'desc' }, { updated_at: 'desc' }],
          take: 4,
          select: {
            id: true,
            patient_id: true,
            visit_record_id: true,
            claimable: true,
            exclusion_reason: true,
            same_month_exclusion_flags: true,
            validation_notes: true,
          },
        })) as BillingEvidenceRow[]);

  const findings: CaseRiskFinding[] = [];
  const scopedSchedules = selectedSchedules.filter((schedule) => schedule.id);
  const scopedReports = selectedReports.filter(
    (report) => report.status === 'failed' || report.status === 'response_waiting',
  );
  const scopedTasks = selectedTasks.filter(
    (task) =>
      (task.related_entity_type === 'case' && task.related_entity_id === careCase.id) ||
      (task.related_entity_type === 'patient' && task.related_entity_id === careCase.patient_id),
  );
  const scopedVisitRecordIds = new Set(visitRecordIds);

  pushConsentPlanFindings({
    findings,
    patientHref,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    consent: scopedConsent,
    managementPlan: scopedManagementPlan,
    firstVisitDocument: scopedFirstVisitDocument,
    now,
  });
  pushVisitFindings({
    findings,
    patientHref,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    schedules: scopedSchedules,
  });
  pushReportFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    reports: scopedReports,
  });
  pushTaskFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    tasks: scopedTasks,
    now,
  });
  pushBillingFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    visitRecordIds: scopedVisitRecordIds,
    billingEvidence,
  });

  const sections = buildSections(findings);
  const overall = summarizeRiskFindings(findings);

  return {
    generated_at: now.toISOString(),
    patient: {
      id: careCase.patient.id,
      display_id: careCase.patient.display_id,
      name: careCase.patient.name,
    },
    case: {
      id: careCase.id,
      display_id: careCase.display_id,
      status: careCase.status,
    },
    overall,
    sections,
    next_actions: buildNextActions(findings),
  };
}
