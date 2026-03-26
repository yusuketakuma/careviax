import { addDays } from 'date-fns';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

type DbClient = typeof prisma | Prisma.TransactionClient;
type RiskLevel = 'stable' | 'watch' | 'high';

export type PatientRiskSummary = {
  patient_id: string;
  patient_name: string;
  score: number;
  level: RiskLevel;
  reasons: string[];
  unresolved_self_reports: number;
  open_issues: number;
  disrupted_visits_30d: number;
  pending_reports: number;
  open_tasks: number;
  missing_visit_consent: boolean;
  missing_management_plan: boolean;
};

function riskLevel(score: number): RiskLevel {
  if (score >= 7) return 'high';
  if (score >= 4) return 'watch';
  return 'stable';
}

export async function listPatientRiskSummaries(
  db: DbClient,
  args: {
    orgId: string;
    patientIds?: string[];
    limit?: number;
    includeStable?: boolean;
  }
): Promise<PatientRiskSummary[]> {
  const now = new Date();
  const recentWindow = addDays(now, -30);
  const activeCaseStatuses = ['assessment', 'active', 'on_hold'] as const;

  const patients = await db.patient.findMany({
    where: {
      org_id: args.orgId,
      ...(args.patientIds?.length ? { id: { in: args.patientIds } } : {}),
      ...(args.patientIds?.length
        ? {}
        : {
            cases: {
              some: {
                status: { in: [...activeCaseStatuses] },
              },
            },
          }),
    },
    select: {
      id: true,
      name: true,
      billing_support_flag: true,
    },
    take: args.patientIds?.length ? undefined : 80,
    orderBy: { name_kana: 'asc' },
  });

  if (patients.length === 0) return [];

  const patientIds = patients.map((patient) => patient.id);
  const cases = await db.careCase.findMany({
    where: {
      org_id: args.orgId,
      patient_id: { in: patientIds },
      status: { in: [...activeCaseStatuses] },
    },
    select: {
      id: true,
      patient_id: true,
    },
  });
  const caseIds = cases.map((item) => item.id);
  const caseIdToPatientId = new Map(cases.map((item) => [item.id, item.patient_id]));

  const [
    selfReports,
    medicationIssues,
    tasks,
    schedules,
    careReports,
    visitConsents,
    managementPlans,
  ] = await Promise.all([
    db.patientSelfReport.findMany({
      where: {
        org_id: args.orgId,
        patient_id: { in: patientIds },
        status: {
          in: ['submitted', 'triaged', 'converted_to_task'],
        },
      },
      select: {
        patient_id: true,
        requested_callback: true,
      },
    }),
    db.medicationIssue.findMany({
      where: {
        org_id: args.orgId,
        patient_id: { in: patientIds },
        status: {
          in: ['open', 'in_progress'],
        },
      },
      select: {
        patient_id: true,
        priority: true,
      },
    }),
    db.task.findMany({
      where: {
        org_id: args.orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
        OR: [
          {
            related_entity_type: 'patient',
            related_entity_id: { in: patientIds },
          },
          ...(caseIds.length > 0
            ? [
                {
                  related_entity_type: 'case',
                  related_entity_id: { in: caseIds },
                },
              ]
            : []),
        ],
      },
      select: {
        related_entity_type: true,
        related_entity_id: true,
        priority: true,
      },
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.visitSchedule.findMany({
          where: {
            org_id: args.orgId,
            case_id: { in: caseIds },
            scheduled_date: {
              gte: recentWindow,
            },
          },
          select: {
            case_id: true,
            schedule_status: true,
            priority: true,
            scheduled_date: true,
          },
        }),
    db.careReport.findMany({
      where: {
        org_id: args.orgId,
        patient_id: { in: patientIds },
        status: {
          in: ['draft', 'failed', 'response_waiting'],
        },
      },
      select: {
        patient_id: true,
      },
    }),
    db.consentRecord.findMany({
      where: {
        org_id: args.orgId,
        patient_id: { in: patientIds },
        consent_type: 'visit_medication_management',
        is_active: true,
        revoked_date: null,
        OR: [{ expiry_date: null }, { expiry_date: { gte: now } }],
      },
      select: {
        patient_id: true,
      },
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.managementPlan.findMany({
          where: {
            org_id: args.orgId,
            case_id: { in: caseIds },
            status: 'approved',
            approved_at: { not: null },
            OR: [{ next_review_date: null }, { next_review_date: { gte: now } }],
          },
          select: {
            case_id: true,
          },
        }),
  ]);

  const visitConsentPatientIds = new Set(visitConsents.map((item) => item.patient_id));
  const activePlanCaseIds = new Set(managementPlans.map((item) => item.case_id));

  const selfReportMap = new Map<string, { count: number; callback: boolean }>();
  for (const report of selfReports) {
    const current = selfReportMap.get(report.patient_id) ?? { count: 0, callback: false };
    current.count += 1;
    current.callback ||= report.requested_callback;
    selfReportMap.set(report.patient_id, current);
  }

  const issueMap = new Map<string, { count: number; severe: boolean }>();
  for (const issue of medicationIssues) {
    const current = issueMap.get(issue.patient_id) ?? { count: 0, severe: false };
    current.count += 1;
    current.severe ||= issue.priority === 'critical' || issue.priority === 'high';
    issueMap.set(issue.patient_id, current);
  }

  const taskMap = new Map<string, { count: number; urgent: boolean }>();
  for (const task of tasks) {
    const patientId =
      task.related_entity_type === 'patient'
        ? task.related_entity_id
        : caseIdToPatientId.get(task.related_entity_id ?? '');
    if (!patientId) continue;
    const current = taskMap.get(patientId) ?? { count: 0, urgent: false };
    current.count += 1;
    current.urgent ||= task.priority === 'urgent' || task.priority === 'high';
    taskMap.set(patientId, current);
  }

  const scheduleMap = new Map<
    string,
    { disrupted: number; urgentUpcoming: number }
  >();
  for (const schedule of schedules) {
    const patientId = caseIdToPatientId.get(schedule.case_id);
    if (!patientId) continue;
    const current = scheduleMap.get(patientId) ?? { disrupted: 0, urgentUpcoming: 0 };
    if (['postponed', 'cancelled', 'rescheduled', 'no_show'].includes(schedule.schedule_status)) {
      current.disrupted += 1;
    }
    if (
      schedule.scheduled_date >= now &&
      (schedule.priority === 'urgent' || schedule.priority === 'emergency')
    ) {
      current.urgentUpcoming += 1;
    }
    scheduleMap.set(patientId, current);
  }

  const pendingReportMap = new Map<string, number>();
  for (const report of careReports) {
    pendingReportMap.set(report.patient_id, (pendingReportMap.get(report.patient_id) ?? 0) + 1);
  }

  const activeCaseIdsByPatient = new Map<string, string[]>();
  for (const careCase of cases) {
    const existing = activeCaseIdsByPatient.get(careCase.patient_id);
    if (existing) existing.push(careCase.id);
    else activeCaseIdsByPatient.set(careCase.patient_id, [careCase.id]);
  }

  const summaries = patients.map((patient) => {
    let score = 0;
    const reasons: string[] = [];
    const selfReportState = selfReportMap.get(patient.id);
    const issueState = issueMap.get(patient.id);
    const taskState = taskMap.get(patient.id);
    const scheduleState = scheduleMap.get(patient.id);
    const pendingReportsCount = pendingReportMap.get(patient.id) ?? 0;
    const activeCaseIdsForPatient = activeCaseIdsByPatient.get(patient.id) ?? [];
    const hasConsent = visitConsentPatientIds.has(patient.id);
    const hasPlan =
      activeCaseIdsForPatient.length === 0 ||
      activeCaseIdsForPatient.some((caseId) => activePlanCaseIds.has(caseId));

    if (!hasConsent && activeCaseIdsForPatient.length > 0) {
      score += 2;
      reasons.push('訪問同意が未整備です');
    }
    if (!hasPlan && activeCaseIdsForPatient.length > 0) {
      score += 2;
      reasons.push('有効な管理計画書がありません');
    }
    if (selfReportState?.count) {
      score += selfReportState.callback ? 2 : 1;
      reasons.push(`患者・家族から ${selfReportState.count} 件の自己申告があります`);
    }
    if (issueState?.count) {
      score += issueState.severe ? 2 : 1;
      reasons.push(`薬学的課題が ${issueState.count} 件あります`);
    }
    if ((scheduleState?.disrupted ?? 0) > 0) {
      score += 2;
      reasons.push(`直近30日で訪問中断が ${scheduleState?.disrupted ?? 0} 件あります`);
    }
    if ((scheduleState?.urgentUpcoming ?? 0) > 0) {
      score += 1;
      reasons.push('緊急優先の訪問予定があります');
    }
    if (pendingReportsCount > 0) {
      score += 1;
      reasons.push(`送付待ちの報告書が ${pendingReportsCount} 件あります`);
    }
    if (taskState?.count) {
      score += taskState.urgent ? 2 : 1;
      reasons.push(`未完了タスクが ${taskState.count} 件あります`);
    }
    if (patient.billing_support_flag) {
      score += 1;
      reasons.push('請求支援フラグが設定されています');
    }

    return {
      patient_id: patient.id,
      patient_name: patient.name,
      score,
      level: riskLevel(score),
      reasons,
      unresolved_self_reports: selfReportState?.count ?? 0,
      open_issues: issueState?.count ?? 0,
      disrupted_visits_30d: scheduleState?.disrupted ?? 0,
      pending_reports: pendingReportsCount,
      open_tasks: taskState?.count ?? 0,
      missing_visit_consent: !hasConsent && activeCaseIdsForPatient.length > 0,
      missing_management_plan: !hasPlan && activeCaseIdsForPatient.length > 0,
    } satisfies PatientRiskSummary;
  });

  return summaries
    .filter((item) => args.includeStable || item.score > 0)
    .sort((left, right) => right.score - left.score || left.patient_name.localeCompare(right.patient_name, 'ja'))
    .slice(0, args.limit ?? summaries.length);
}

export async function getPatientRiskSummary(
  db: DbClient,
  args: {
    orgId: string;
    patientId: string;
  }
): Promise<PatientRiskSummary | null> {
  const [summary] = await listPatientRiskSummaries(db, {
    orgId: args.orgId,
    patientIds: [args.patientId],
    limit: 1,
    includeStable: true,
  });

  return summary ?? null;
}
