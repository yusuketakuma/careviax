import { buildExternalHref, buildTasksHref } from '@/lib/dashboard/home-link-builders';
import { formatDateKey } from '@/lib/date-key';
import { deriveFacilityLabel } from '@/lib/utils/facility';
import {
  getVisitWorkflowGuidance,
  type VisitWorkflowGateIssue,
} from '@/server/services/management-plans';
import type { RemediationGuidanceItem } from '@/types/api/workflow-dashboard';
import type { WorkflowCoreData } from './workflow-dashboard-queries';

type PatientReadinessIssueHref =
  | Exclude<VisitWorkflowGateIssue, 'management_plan_review_overdue'>
  | 'missing_first_visit_doc'
  | 'missing_emergency_contact'
  | 'missing_primary_physician';

function buildPatientsReadinessIssueHref(issue: PatientReadinessIssueHref) {
  const params = new URLSearchParams([['readiness_issue', issue]]);
  return `/patients?${params.toString()}`;
}

export function buildVisitIntakeLinkageTaskHref() {
  return buildTasksHref({ status: '', taskType: 'visit_intake_linkage' });
}

function groupRouteOrders(values: Array<number | null | undefined>) {
  const sorted = values
    .filter((value): value is number => typeof value === 'number')
    .sort((left, right) => left - right);
  if (sorted.length === 0) return '未設定';
  if (sorted.length === 1) return `${sorted[0]}`;
  return `${sorted[0]}-${sorted[sorted.length - 1]}`;
}

export function buildRemediationGuidance(
  missingVisitConsentCount: number,
  missingManagementPlanCount: number,
  missingFirstVisitDocCount: number,
  missingEmergencyContactCount: number,
  missingPrimaryPhysicianCount: number,
  taskCountByType: Record<string, number>,
  triageSelfReportsCount: number,
): RemediationGuidanceItem[] {
  const guidanceCounts = new Map<VisitWorkflowGateIssue, number>([
    ['missing_visit_consent', missingVisitConsentCount],
    ['missing_management_plan', missingManagementPlanCount],
    ['management_plan_review_overdue', taskCountByType.management_plan_review ?? 0],
  ]);

  return [
    ...Array.from(guidanceCounts.entries())
      .filter(([, count]) => count > 0)
      .map(([issue, count]) => {
        const guidance = getVisitWorkflowGuidance(issue);
        const action =
          issue === 'management_plan_review_overdue'
            ? {
                action_href: buildTasksHref({ status: '', taskType: 'management_plan_review' }),
                action_label: '計画レビューを確認',
              }
            : {
                action_href: buildPatientsReadinessIssueHref(issue),
                action_label: '患者一覧で確認',
              };
        return {
          id: issue,
          title: guidance.title,
          description: guidance.description,
          severity: guidance.severity,
          count,
          action_href: action.action_href,
          action_label: action.action_label,
        } satisfies RemediationGuidanceItem;
      }),
    ...(missingFirstVisitDocCount > 0
      ? [
          {
            id: 'missing_first_visit_doc',
            title: '初回訪問文書の交付確認が必要です',
            description:
              '初回訪問文書が未交付のケースがあります。交付日時と文書控えを確認してください。',
            severity: 'high' as const,
            count: missingFirstVisitDocCount,
            action_href: buildPatientsReadinessIssueHref('missing_first_visit_doc'),
            action_label: '患者一覧で確認',
          } satisfies RemediationGuidanceItem,
        ]
      : []),
    ...(missingEmergencyContactCount > 0
      ? [
          {
            id: 'missing_emergency_contact',
            title: '緊急連絡先の整備が必要です',
            description: '緊急連絡先が不足しているため、初回訪問文書や緊急連携の運用が不完全です。',
            severity: 'high' as const,
            count: missingEmergencyContactCount,
            action_href: buildPatientsReadinessIssueHref('missing_emergency_contact'),
            action_label: '患者一覧で確認',
          } satisfies RemediationGuidanceItem,
        ]
      : []),
    ...(missingPrimaryPhysicianCount > 0
      ? [
          {
            id: 'missing_primary_physician',
            title: '主治医連携の登録が必要です',
            description:
              '主治医が未登録のケースがあります。初回訪問判断、疑義照会、報告導線が不完全です。',
            severity: 'high' as const,
            count: missingPrimaryPhysicianCount,
            action_href: buildPatientsReadinessIssueHref('missing_primary_physician'),
            action_label: '患者一覧で確認',
          } satisfies RemediationGuidanceItem,
        ]
      : []),
    ...(taskCountByType.visit_intake_linkage
      ? [
          {
            id: 'visit_intake_linkage',
            title: '処方受付から訪問導線への接続が必要です',
            description: '受付済み処方が訪問候補・架電・確定フローへ接続されていません。',
            severity: 'high' as const,
            count: taskCountByType.visit_intake_linkage,
            action_href: buildVisitIntakeLinkageTaskHref(),
            action_label: '未接続の処方を確認',
          } satisfies RemediationGuidanceItem,
        ]
      : []),
    ...(triageSelfReportsCount > 0
      ? [
          {
            id: 'self_report_triage',
            title: '患者・家族セルフレポートの確認が必要です',
            description: '患者または家族からの申告が triage 待ちまたは triage 中です。',
            severity: 'high' as const,
            count: triageSelfReportsCount,
            action_href: buildExternalHref({ focus: 'self_reports' }),
            action_label: 'セルフレポートを確認',
          } satisfies RemediationGuidanceItem,
        ]
      : []),
  ];
}

export function buildFacilityVisibility(
  upcomingSchedules: WorkflowCoreData['upcomingSchedules'],
  userNameById: Map<string, string>,
) {
  const facilityGroups = new Map<
    string,
    {
      id: string;
      date: string;
      site_name: string | null;
      pharmacist_id: string;
      label: string;
      patient_names: string[];
      route_orders: Array<number | null | undefined>;
    }
  >();
  for (const schedule of upcomingSchedules) {
    const residence = schedule.case_.patient.residences[0];
    const facilityLabel = deriveFacilityLabel(residence ?? null);
    if (!facilityLabel) continue;
    const scheduleDateKey = formatDateKey(schedule.scheduled_date);
    const groupKey = [
      scheduleDateKey,
      schedule.site?.id ?? 'site:none',
      schedule.pharmacist_id,
      facilityLabel,
    ].join(':');
    const existing = facilityGroups.get(groupKey);
    if (existing) {
      existing.patient_names.push(schedule.case_.patient.name);
      existing.route_orders.push(schedule.route_order);
      continue;
    }
    facilityGroups.set(groupKey, {
      id: groupKey,
      date: schedule.scheduled_date.toISOString(),
      site_name: schedule.site?.name ?? null,
      pharmacist_id: schedule.pharmacist_id,
      label: facilityLabel,
      patient_names: [schedule.case_.patient.name],
      route_orders: [schedule.route_order],
    });
  }

  const clusters = Array.from(facilityGroups.values())
    .filter((group) => group.patient_names.length > 1)
    .sort((left, right) => right.patient_names.length - left.patient_names.length)
    .slice(0, 6)
    .map((group) => ({
      id: group.id,
      date: group.date,
      label: group.label,
      site_name: group.site_name,
      pharmacist_name: userNameById.get(group.pharmacist_id) ?? null,
      patient_count: group.patient_names.length,
      patient_names: group.patient_names,
      route_window: groupRouteOrders(group.route_orders),
    }));

  return { clusters, facilityGroups };
}

export function buildWorkloadMetrics(
  upcomingSchedules: WorkflowCoreData['upcomingSchedules'],
  pendingTasks: WorkflowCoreData['pendingTasks'],
  facilityVisibility: ReturnType<typeof buildFacilityVisibility>,
  userNameById: Map<string, string>,
) {
  const workloadByPharmacist = new Map<
    string,
    {
      pharmacist_id: string;
      confirmed_visits: number;
      pending_tasks: number;
      urgent_items: number;
      callback_followups: number;
      facility_clusters: number;
    }
  >();

  const ensureWorkload = (pharmacistId: string) => {
    const existing = workloadByPharmacist.get(pharmacistId);
    if (existing) return existing;
    const created = {
      pharmacist_id: pharmacistId,
      confirmed_visits: 0,
      pending_tasks: 0,
      urgent_items: 0,
      callback_followups: 0,
      facility_clusters: 0,
    };
    workloadByPharmacist.set(pharmacistId, created);
    return created;
  };

  for (const schedule of upcomingSchedules) {
    const workload = ensureWorkload(schedule.pharmacist_id);
    workload.confirmed_visits += 1;
    if (schedule.priority === 'urgent' || schedule.priority === 'emergency') {
      workload.urgent_items += 1;
    }
  }
  for (const task of pendingTasks) {
    if (!task.assigned_to) continue;
    const workload = ensureWorkload(task.assigned_to);
    workload.pending_tasks += 1;
    if (task.priority === 'urgent') workload.urgent_items += 1;
    if (task.task_type === 'visit_contact_followup') {
      workload.callback_followups += 1;
    }
  }
  for (const group of facilityVisibility.clusters) {
    const pharmacistId = Array.from(facilityVisibility.facilityGroups.values()).find(
      (entry) => entry.id === group.id,
    )?.pharmacist_id;
    if (!pharmacistId) continue;
    ensureWorkload(pharmacistId).facility_clusters += 1;
  }

  return Array.from(workloadByPharmacist.values())
    .sort((left, right) => {
      const leftScore = left.urgent_items * 10 + left.pending_tasks * 3 + left.confirmed_visits;
      const rightScore = right.urgent_items * 10 + right.pending_tasks * 3 + right.confirmed_visits;
      return rightScore - leftScore;
    })
    .slice(0, 6)
    .map((workload) => ({
      pharmacist_id: workload.pharmacist_id,
      pharmacist_name: userNameById.get(workload.pharmacist_id) ?? '薬剤師未登録',
      confirmed_visits: workload.confirmed_visits,
      pending_tasks: workload.pending_tasks,
      urgent_items: workload.urgent_items,
      callback_followups: workload.callback_followups,
      facility_clusters: workload.facility_clusters,
    }));
}
