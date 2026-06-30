import { isoOrNull } from '@/lib/utils/date';
import { formatDateKey } from '@/lib/date-key';
import { deriveFacilityLabel } from '@/lib/utils/facility';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { WORKBENCH_MAX_ITEMS } from '@/lib/constants/workflow';
import { readJsonObject } from '@/lib/db/json';
import {
  getVisitWorkflowGuidance,
  type VisitWorkflowGateIssue,
} from '@/server/services/management-plans';
import { describeOperationalTask } from '@/server/services/operational-tasks';
import type {
  QueuePriority,
  RemediationGuidanceItem,
  WorkbenchItem,
  RouteOperations,
  RoleInboxBucket,
  WorkflowDashboardResponse,
} from '@/types/api/workflow-dashboard';
import type { WorkflowCoreData, WorkflowDependentData } from './workflow-dashboard-queries';

type PatientReadinessIssueHref =
  | VisitWorkflowGateIssue
  | 'missing_first_visit_doc'
  | 'missing_emergency_contact';

function buildPatientsReadinessIssueHref(issue: PatientReadinessIssueHref) {
  const params = new URLSearchParams([['readiness_issue', issue]]);
  return `/patients?${params.toString()}`;
}

function priorityRank(priority: QueuePriority) {
  switch (priority) {
    case 'urgent':
      return 0;
    case 'high':
      return 1;
    case 'normal':
      return 2;
    default:
      return 3;
  }
}

function sortWorkbenchItems(left: WorkbenchItem, right: WorkbenchItem) {
  const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDelta !== 0) return priorityDelta;

  if (left.due_at && right.due_at) {
    return new Date(left.due_at).getTime() - new Date(right.due_at).getTime();
  }
  if (left.due_at) return -1;
  if (right.due_at) return 1;
  return left.title.localeCompare(right.title, 'ja');
}

function normalizeVisitPriority(priority: string): QueuePriority {
  switch (priority) {
    case 'emergency':
    case 'urgent':
      return 'urgent';
    case 'high':
      return 'high';
    case 'low':
      return 'low';
    default:
      return 'normal';
  }
}

function groupRouteOrders(values: Array<number | null | undefined>) {
  const sorted = values
    .filter((value): value is number => typeof value === 'number')
    .sort((left, right) => left - right);
  if (sorted.length === 0) return '未設定';
  if (sorted.length === 1) return `${sorted[0]}`;
  return `${sorted[0]}-${sorted[sorted.length - 1]}`;
}

export function buildCycleStatusSection(
  cycleCounts: WorkflowCoreData['cycleCounts'],
): Record<string, number> {
  const cycleStatusMap: Record<string, number> = {};
  for (const row of cycleCounts) {
    cycleStatusMap[row.overall_status] = row._count.id;
  }
  return cycleStatusMap;
}

export function buildVisitOperationsSection(
  overdueVisits: number,
  awaitingReports: number,
  missingVisitConsentCount: number,
  missingManagementPlanCount: number,
  missingFirstVisitDocCount: number,
  missingEmergencyContactCount: number,
  missingPrimaryPhysicianCount: number,
) {
  return {
    overdue: overdueVisits,
    awaiting_reports: awaitingReports,
    missing_visit_consent: missingVisitConsentCount,
    missing_management_plan: missingManagementPlanCount,
    missing_first_visit_doc: missingFirstVisitDocCount,
    missing_emergency_contact: missingEmergencyContactCount,
    missing_primary_physician: missingPrimaryPhysicianCount,
  };
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
        return {
          id: issue,
          title: guidance.title,
          description: guidance.description,
          severity: guidance.severity,
          count,
          action_href: buildPatientsReadinessIssueHref(issue),
          action_label: '患者一覧で確認',
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
            action_href: '/patients',
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
            action_href: '/workflow',
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
            action_href: '/workflow',
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

export function buildRoleInboxes(
  taskCountByType: Record<string, number>,
  awaitingReports: number,
  pendingProposals: WorkflowCoreData['pendingProposals'],
  communicationQueue: WorkflowCoreData['communicationQueue'],
  billingReviewTasks: number,
  routeControlMetrics: { pending_override_requests: number },
  upcomingHolidayGaps: unknown[],
  inventoryReadiness: { blocked: number },
  currentRole: string,
): { current_role: string; buckets: RoleInboxBucket[] } {
  const buckets: RoleInboxBucket[] = [
    {
      role: 'pharmacist',
      label: '薬剤師 inbox',
      open_items:
        (taskCountByType.visit_demand ?? 0) +
        (taskCountByType.visit_preparation ?? 0) +
        (taskCountByType.patient_self_report_followup ?? 0) +
        (taskCountByType.emergency_contact_review ?? 0) +
        (taskCountByType.dosage_form_support ?? 0) +
        (taskCountByType.inquiry_workbench ?? 0) +
        (taskCountByType.facility_batch_tracker ?? 0) +
        (taskCountByType.mobile_visit_mode ?? 0) +
        (taskCountByType.visit_carry_item_review ?? 0) +
        awaitingReports,
      urgent_items:
        pendingProposals.filter((proposal) => ['urgent', 'emergency'].includes(proposal.priority))
          .length + communicationQueue.summary.callback_followups,
      communication_items:
        communicationQueue.summary.self_reports + communicationQueue.summary.callback_followups,
      action_href: '/workflow',
    },
    {
      role: 'clerk',
      label: '事務 inbox',
      open_items:
        communicationQueue.summary.pending_count +
        billingReviewTasks +
        (taskCountByType.community_activity_followup ?? 0),
      urgent_items:
        communicationQueue.summary.overdue_count + communicationQueue.summary.delivery_backlog,
      communication_items:
        communicationQueue.summary.open_requests +
        communicationQueue.summary.expiring_external_shares,
      action_href: '/external',
    },
    {
      role: 'admin',
      label: '管理 inbox',
      open_items:
        routeControlMetrics.pending_override_requests +
        (taskCountByType.management_plan_review ?? 0) +
        (taskCountByType.emergency_coverage_gap ?? 0) +
        billingReviewTasks,
      urgent_items:
        upcomingHolidayGaps.length +
        routeControlMetrics.pending_override_requests +
        inventoryReadiness.blocked,
      communication_items: communicationQueue.summary.delivery_backlog,
      action_href: '/admin/realtime',
    },
  ];

  return { current_role: currentRole, buckets };
}

export function buildUnifiedWorkbench(
  pendingTasks: WorkflowCoreData['pendingTasks'],
  pendingProposals: WorkflowCoreData['pendingProposals'],
  upcomingSchedules: WorkflowCoreData['upcomingSchedules'],
  triageSelfReports: WorkflowCoreData['triageSelfReports'],
  awaitingReports: number,
  intakeLinkage: unknown[],
  communicationQueue: WorkflowCoreData['communicationQueue'],
  userNameById: Map<string, string>,
  patientNameById: Map<string, string>,
): WorkbenchItem[] {
  const taskItems: WorkbenchItem[] = pendingTasks.map((task) => {
    const presentation = describeOperationalTask(task);
    const taskMetadata = readJsonObject(task.metadata);
    const actionHref =
      typeof taskMetadata?.action_href === 'string'
        ? taskMetadata.action_href
        : presentation.actionHref;
    const actionLabel =
      typeof taskMetadata?.action_label === 'string'
        ? taskMetadata.action_label
        : presentation.actionLabel;
    return {
      id: `task:${task.id}`,
      item_type: 'task' as const,
      queue_label: presentation.queueLabel,
      title: task.title,
      summary: task.description ?? '担当者アクション待ちです。',
      priority: task.priority as QueuePriority,
      due_at: isoOrNull(task.sla_due_at ?? task.due_date),
      action_href: actionHref,
      action_label: actionLabel,
      owner_name: task.assigned_to ? (userNameById.get(task.assigned_to) ?? null) : null,
      patient_name:
        typeof taskMetadata?.patient_name === 'string' ? taskMetadata.patient_name : null,
      badges: [task.task_type, task.status],
    };
  });

  const proposalItems: WorkbenchItem[] = pendingProposals.map((proposal) => ({
    id: `proposal:${proposal.id}`,
    item_type: 'proposal' as const,
    queue_label: proposal.proposal_status === 'patient_contact_pending' ? '架電' : '訪問候補',
    title: `${proposal.case_.patient.name} の訪問候補を進めてください`,
    summary:
      proposal.proposal_reason ??
      (proposal.reschedule_source_schedule_id
        ? '確定済み訪問の再調整候補です。'
        : '自動提案された候補の承認または架電対応が必要です。'),
    priority: normalizeVisitPriority(proposal.priority),
    due_at: isoOrNull(proposal.visit_deadline_date ?? proposal.proposed_date),
    action_href: '/schedules',
    action_label:
      proposal.proposal_status === 'patient_contact_pending' ? '架電を記録' : '候補を確認',
    owner_name: userNameById.get(proposal.proposed_pharmacist_id) ?? null,
    patient_name: proposal.case_.patient.name,
    badges: [proposal.proposal_status, proposal.patient_contact_status].filter(
      (v): v is string => v != null,
    ),
  }));

  const visitItems: WorkbenchItem[] = upcomingSchedules
    .filter((schedule) => {
      const prep = schedule.preparation;
      const preparationReady =
        prep?.medication_changes_reviewed &&
        prep.carry_items_confirmed &&
        prep.previous_issues_reviewed &&
        prep.route_confirmed &&
        prep.offline_synced;
      return (
        !preparationReady ||
        schedule.assignment_mode === 'fallback' ||
        schedule.override_request?.status === 'pending'
      );
    })
    .slice(0, 6)
    .map((schedule) => {
      const reasons: string[] = [];
      const prep = schedule.preparation;
      if (!prep?.medication_changes_reviewed) reasons.push('薬歴確認');
      if (!prep?.carry_items_confirmed) reasons.push('持参薬確認');
      if (!prep?.previous_issues_reviewed) reasons.push('前回課題確認');
      if (!prep?.route_confirmed) reasons.push('ルート確認');
      if (!prep?.offline_synced) reasons.push('同期確認');
      if (schedule.assignment_mode === 'fallback') reasons.push('引継ぎ確認');
      if (schedule.override_request?.status === 'pending') reasons.push('変更承認待ち');
      if (schedule.cadence_preview?.next_billable_date) {
        reasons.push(`次回算定可 ${schedule.cadence_preview.next_billable_date}`);
      }
      if ((schedule.cadence_preview?.warning_messages.length ?? 0) > 0) {
        reasons.push(schedule.cadence_preview?.warning_messages[0] ?? '算定要件確認');
      }
      return {
        id: `visit:${schedule.id}`,
        item_type: 'visit' as const,
        queue_label: schedule.assignment_mode === 'fallback' ? '引継ぎ' : '訪問準備',
        title: `${schedule.case_.patient.name} の訪問前対応`,
        summary: reasons.join(' / '),
        priority: (schedule.priority === 'emergency' ? 'urgent' : 'high') as QueuePriority,
        due_at: isoOrNull(schedule.scheduled_date),
        action_href: '/schedules',
        action_label: '訪問予定を確認',
        owner_name: userNameById.get(schedule.pharmacist_id) ?? null,
        patient_name: schedule.case_.patient.name,
        badges: [schedule.schedule_status, schedule.assignment_mode],
      };
    });

  const selfReportItems: WorkbenchItem[] = triageSelfReports.map((report) => ({
    id: `self-report:${report.id}`,
    item_type: 'self_report' as const,
    queue_label: 'セルフレポート',
    title: `${patientNameById.get(report.patient_id) ?? '患者'} から申告があります`,
    summary: `${report.subject} / ${report.reported_by_name}${report.relation ? ` (${report.relation})` : ''}`,
    priority: (report.requested_callback ? 'urgent' : 'high') as QueuePriority,
    due_at: report.created_at.toISOString(),
    action_href: '/workflow',
    action_label: 'triage を進める',
    owner_name: null,
    patient_name: patientNameById.get(report.patient_id) ?? null,
    badges: [
      report.status,
      report.category,
      ...(report.requested_callback ? ['折返し希望'] : []),
    ].filter((v): v is string => v != null),
  }));

  const aggregateItems: WorkbenchItem[] = [
    ...(communicationQueue.summary.unconfirmed_count > 0
      ? [
          {
            id: 'aggregate:communication_unconfirmed',
            item_type: 'aggregate' as const,
            queue_label: '連携',
            title: '未確認の共有ドラフトまたは送達があります',
            summary: `${communicationQueue.summary.unconfirmed_count}件が未確認のまま残っています。`,
            priority: 'high' as const,
            due_at: communicationQueue.items[0]?.due_at ?? null,
            action_href: '/communications/requests',
            action_label: '未確認を確認',
            owner_name: null,
            patient_name: null,
            badges: ['communication_unconfirmed'],
          },
        ]
      : []),
    ...(communicationQueue.summary.reply_waiting_count > 0
      ? [
          {
            id: 'aggregate:communication_reply_waiting',
            item_type: 'aggregate' as const,
            queue_label: '返信待ち',
            title: '多職種連携の返信待ちがあります',
            summary: `${communicationQueue.summary.reply_waiting_count}件が返信待ちまたは未反映です。`,
            priority: 'high' as const,
            due_at: communicationQueue.items[0]?.due_at ?? null,
            action_href: buildCommunicationRequestsHref({ status: 'sent' }),
            action_label: '返信待ちを確認',
            owner_name: null,
            patient_name: null,
            badges: ['communication_reply_waiting'],
          },
        ]
      : []),
    ...(awaitingReports > 0
      ? [
          {
            id: 'aggregate:awaiting_reports',
            item_type: 'aggregate' as const,
            queue_label: '報告',
            title: '訪問後の報告待ちがあります',
            summary: `${awaitingReports}件の訪問サイクルが報告送信待ちです。`,
            priority: 'normal' as const,
            due_at: null,
            action_href: '/workflow',
            action_label: '報告待ちを確認',
            owner_name: null,
            patient_name: null,
            badges: ['visit_completed'],
          },
        ]
      : []),
    ...(intakeLinkage.length > 0
      ? [
          {
            id: 'aggregate:intake_linkage',
            item_type: 'aggregate' as const,
            queue_label: '処方受付',
            title: '訪問導線に未接続の処方受付があります',
            summary: `${intakeLinkage.length}件の処方が候補生成または架電フローへ未接続です。`,
            priority: 'high' as const,
            due_at: (intakeLinkage[0] as { due_at?: string | null })?.due_at ?? null,
            action_href: '/workflow',
            action_label: '未接続の処方を確認',
            owner_name: null,
            patient_name: null,
            badges: ['visit_intake_linkage'],
          },
        ]
      : []),
  ];

  return [...taskItems, ...proposalItems, ...visitItems, ...selfReportItems, ...aggregateItems]
    .sort(sortWorkbenchItems)
    .slice(0, WORKBENCH_MAX_ITEMS);
}

export function buildExceptionCommandCenter(
  openWorkflowExceptions: WorkflowCoreData['openWorkflowExceptions'],
  overdueVisits: number,
  awaitingReports: number,
  triageSelfReportsCount: number,
) {
  return [
    ...openWorkflowExceptions.map((exception) => ({
      id: exception.id,
      type: 'workflow_exception',
      severity: exception.severity,
      title: exception.exception_type,
      description: exception.description,
      patient_name: exception.cycle?.case_?.patient.name ?? null,
      created_at: exception.created_at.toISOString(),
      action_href: '/workflow',
      action_label: '例外を確認',
    })),
    ...(overdueVisits > 0
      ? [
          {
            id: 'aggregate:overdue_visits',
            type: 'overdue_visit',
            severity: 'high',
            title: '訪問期限超過',
            description: `${overdueVisits}件の訪問が期限を超えています。`,
            patient_name: null,
            created_at: null,
            action_href: '/workflow',
            action_label: '期限超過を確認',
          },
        ]
      : []),
    ...(awaitingReports > 0
      ? [
          {
            id: 'aggregate:awaiting_reports',
            type: 'report_backlog',
            severity: 'normal',
            title: '訪問後の報告待ち',
            description: `${awaitingReports}件が訪問後報告の送信待ちです。`,
            patient_name: null,
            created_at: null,
            action_href: '/workflow',
            action_label: '報告待ちを確認',
          },
        ]
      : []),
    ...(triageSelfReportsCount > 0
      ? [
          {
            id: 'aggregate:self_report_triage',
            type: 'self_report_triage',
            severity: 'high',
            title: '患者・家族セルフレポート',
            description: `${triageSelfReportsCount}件が triage 待ちです。`,
            patient_name: null,
            created_at: null,
            action_href: '/workflow',
            action_label: 'セルフレポートを確認',
          },
        ]
      : []),
  ].slice(0, 8);
}

export function buildOutcomeMetrics(
  recentSchedules: WorkflowCoreData['recentSchedules'],
  awaitingReports: number,
  exceptionCount: number,
) {
  const disruptedStatuses = new Set(['postponed', 'cancelled', 'rescheduled', 'no_show']);
  return {
    completed_last_7_days: recentSchedules.filter(
      (schedule) => schedule.schedule_status === 'completed',
    ).length,
    disrupted_last_7_days: recentSchedules.filter((schedule) =>
      disruptedStatuses.has(schedule.schedule_status),
    ).length,
    urgent_completed_last_7_days: recentSchedules.filter(
      (schedule) =>
        schedule.schedule_status === 'completed' &&
        (schedule.priority === 'urgent' || schedule.priority === 'emergency'),
    ).length,
    awaiting_reports: awaitingReports,
    open_exceptions: exceptionCount,
  };
}

export function buildRouteOperations(
  upcomingSchedules: WorkflowCoreData['upcomingSchedules'],
  pendingProposals: WorkflowCoreData['pendingProposals'],
): RouteOperations {
  return {
    locked_confirmed_visits: upcomingSchedules.filter((schedule) => schedule.confirmed_at != null)
      .length,
    fallback_assignments: upcomingSchedules.filter(
      (schedule) => schedule.assignment_mode === 'fallback',
    ).length,
    override_pending: upcomingSchedules.filter(
      (schedule) => schedule.override_request?.status === 'pending',
    ).length,
    emergency_candidates: pendingProposals.filter((proposal) => proposal.priority === 'emergency')
      .length,
  };
}

export function buildRouteControlMetrics(
  upcomingSchedules: WorkflowCoreData['upcomingSchedules'],
  pendingProposals: WorkflowCoreData['pendingProposals'],
) {
  return {
    locked_schedules: upcomingSchedules.filter((schedule) => Boolean(schedule.confirmed_at)).length,
    pending_override_requests: upcomingSchedules.filter(
      (schedule) => schedule.override_request?.status === 'pending',
    ).length,
    emergency_impact_items:
      upcomingSchedules.filter((schedule) => schedule.priority === 'emergency').length +
      pendingProposals.filter((proposal) => proposal.priority === 'emergency').length,
  };
}

export function buildAfterHoursReadiness(
  upcomingEmergencyShifts: WorkflowCoreData['upcomingEmergencyShifts'],
  upcomingHolidays: WorkflowCoreData['upcomingHolidays'],
) {
  const emergencyCoverageByDate = new Map<string, number>();
  for (const shift of upcomingEmergencyShifts) {
    const dateKey = formatDateKey(shift.date);
    emergencyCoverageByDate.set(dateKey, (emergencyCoverageByDate.get(dateKey) ?? 0) + 1);
  }
  const holidayGaps = upcomingHolidays
    .filter((holiday) => (emergencyCoverageByDate.get(formatDateKey(holiday.date)) ?? 0) === 0)
    .slice(0, 6)
    .map((holiday) => ({
      id: holiday.id,
      date: holiday.date.toISOString(),
      name: holiday.name,
      site_id: holiday.site_id,
    }));

  return {
    emergency_capable_shift_count: upcomingEmergencyShifts.length,
    holiday_gap_count: holidayGaps.length,
    holiday_gaps: holidayGaps,
  };
}

export function buildInquiryWorkbench(
  unresolvedInquiryRecords: WorkflowCoreData['unresolvedInquiryRecords'],
  openMedicationIssues: WorkflowCoreData['openMedicationIssues'],
  linkedInquiryRequests: WorkflowDependentData['linkedInquiryRequests'],
  latestCyclesForIssues: WorkflowDependentData['latestCyclesForIssues'],
  patientNameById: Map<string, string>,
) {
  const linkedIssueIds = new Set(
    unresolvedInquiryRecords
      .map((item) => item.issue_id)
      .filter((value): value is string => Boolean(value)),
  );
  const latestInquiryRequestByInquiryId = new Map(
    linkedInquiryRequests.map((request) => [request.related_entity_id ?? '', request]),
  );
  const latestCycleByCaseId = new Map<string, (typeof latestCyclesForIssues)[number]>();
  const latestCycleByPatientId = new Map<string, (typeof latestCyclesForIssues)[number]>();
  for (const cycle of latestCyclesForIssues) {
    if (cycle.case_id && !latestCycleByCaseId.has(cycle.case_id)) {
      latestCycleByCaseId.set(cycle.case_id, cycle);
    }
    if (!latestCycleByPatientId.has(cycle.patient_id)) {
      latestCycleByPatientId.set(cycle.patient_id, cycle);
    }
  }

  return [
    ...unresolvedInquiryRecords.map((item) => {
      const linkedRequest = latestInquiryRequestByInquiryId.get(item.id) ?? null;
      const queueState =
        linkedRequest?.status === 'responded'
          ? '未反映'
          : linkedRequest?.status === 'draft'
            ? '下書き'
            : '回答待ち';
      return {
        id: `inquiry:${item.id}`,
        item_type: 'inquiry' as const,
        inquiry_id: item.id,
        issue_id: item.issue_id,
        cycle_id: item.cycle_id,
        case_id: item.cycle.case_id,
        patient_id: item.cycle.patient_id,
        patient_name: patientNameById.get(item.cycle.patient_id) ?? item.cycle.case_.patient.name,
        title: item.issue?.title ?? item.reason,
        summary: item.inquiry_content,
        reason: item.reason,
        proposal_origin: item.proposal_origin === 'pre_issuance' ? 'pre_issuance' : 'post_inquiry',
        residual_adjustment: item.residual_adjustment,
        change_detail: item.change_detail,
        line_id: item.line_id,
        line: item.line
          ? {
              id: item.line.id,
              drug_name: item.line.drug_name,
              dose: item.line.dose,
              frequency: item.line.frequency,
              days: item.line.days,
            }
          : null,
        inquiry_to_physician:
          item.inquiry_to_physician ||
          item.cycle.prescription_intakes[0]?.prescriber_name ||
          '主治医',
        request_status: linkedRequest?.status ?? null,
        queue_state: queueState,
        due_at: isoOrNull(linkedRequest?.due_date ?? item.inquired_at),
        created_at: item.inquired_at.toISOString(),
        can_create: false,
      };
    }),
    ...openMedicationIssues
      .filter((issue) => !linkedIssueIds.has(issue.id))
      .slice(0, 8)
      .map((issue) => {
        const cycle =
          (issue.case_id ? latestCycleByCaseId.get(issue.case_id) : undefined) ??
          latestCycleByPatientId.get(issue.patient_id) ??
          null;
        return {
          id: `issue:${issue.id}`,
          item_type: 'issue' as const,
          inquiry_id: null,
          issue_id: issue.id,
          cycle_id: cycle?.id ?? null,
          case_id: issue.case_id ?? cycle?.case_id ?? null,
          patient_id: issue.patient_id,
          patient_name: patientNameById.get(issue.patient_id) ?? '患者未登録',
          title: issue.title,
          summary: issue.description,
          reason: issue.category ?? 'other',
          proposal_origin: null,
          residual_adjustment: null,
          change_detail: null,
          line_id: null,
          line: null,
          inquiry_to_physician: cycle?.prescription_intakes[0]?.prescriber_name ?? '主治医',
          request_status: null,
          queue_state: '起票待ち',
          due_at: isoOrNull(issue.identified_at),
          created_at: issue.identified_at.toISOString(),
          can_create: cycle != null,
        };
      }),
  ]
    .sort((left, right) => {
      const leftTime = new Date(left.due_at ?? left.created_at).getTime();
      const rightTime = new Date(right.due_at ?? right.created_at).getTime();
      return leftTime - rightTime;
    })
    .slice(0, 8);
}

export function buildIntakeLinkage(candidateIntakes: WorkflowCoreData['candidateIntakes']) {
  return candidateIntakes
    .filter(
      (intake) =>
        intake.cycle?.case_ &&
        intake.cycle.visit_schedules.length === 0 &&
        intake.cycle.visit_schedule_proposals.length === 0,
    )
    .slice(0, 6)
    .map((intake) => {
      const dueAt =
        intake.refill_next_dispense_date ??
        intake.prescription_expiry_date ??
        intake.prescribed_date;
      return {
        id: intake.id,
        patient_name: intake.cycle?.case_.patient.name ?? '患者未登録',
        reason:
          intake.source_type === 'refill'
            ? 'リフィル予定日に向けた訪問候補または架電導線が未作成です。'
            : '処方受付後の訪問候補または架電導線が未作成です。',
        due_at: isoOrNull(dueAt),
        action_href: '/workflow',
        action_label: '訪問導線を作成',
        category: intake.source_type === 'refill' ? 'リフィル' : '処方受付',
      };
    });
}

export function buildRefillUpcoming(
  candidateIntakes: WorkflowCoreData['candidateIntakes'],
  sevenDaysFromNow: Date,
  upcomingWindow: Date,
) {
  return candidateIntakes
    .filter(
      (intake) =>
        (intake.source_type === 'refill' &&
          (intake.refill_remaining_count ?? 0) > 0 &&
          intake.refill_next_dispense_date != null &&
          intake.refill_next_dispense_date <= sevenDaysFromNow) ||
        (intake.split_dispense_total != null &&
          intake.split_dispense_current != null &&
          intake.split_dispense_current < intake.split_dispense_total &&
          intake.split_next_dispense_date != null &&
          intake.split_next_dispense_date <= upcomingWindow),
    )
    .slice(0, 10)
    .map((intake) => {
      const suggestedStartDate =
        intake.split_next_dispense_date ??
        intake.refill_next_dispense_date ??
        intake.prescription_expiry_date ??
        intake.prescribed_date;
      return {
        ...intake,
        case_id: intake.cycle?.case_id ?? null,
        upcoming_kind: intake.source_type === 'refill' ? 'refill' : 'split',
        remaining_count:
          intake.source_type === 'refill'
            ? (intake.refill_remaining_count ?? 0)
            : Math.max(
                0,
                (intake.split_dispense_total ?? 0) - (intake.split_dispense_current ?? 0),
              ),
        next_dispense_date: isoOrNull(
          intake.source_type === 'refill'
            ? intake.refill_next_dispense_date
            : intake.split_next_dispense_date,
        ),
        suggested_start_date: isoOrNull(suggestedStartDate),
        has_existing_route:
          (intake.cycle?.visit_schedules.length ?? 0) > 0 ||
          (intake.cycle?.visit_schedule_proposals.length ?? 0) > 0,
      };
    });
}

export function buildWorkflowDashboardData(args: {
  core: WorkflowCoreData;
  dependent: WorkflowDependentData;
  currentRole: string;
  sevenDaysFromNow: Date;
  upcomingWindow: Date;
}): WorkflowDashboardResponse['data'] {
  const { core, dependent, currentRole, sevenDaysFromNow, upcomingWindow } = args;

  const patientNameById = new Map(
    dependent.patientsForReports.map((patient) => [patient.id, patient.name]),
  );
  const userNameById = new Map(dependent.users.map((user) => [user.id, user.name]));
  const consentedPatientIds = new Set(
    dependent.activeVisitConsents.map((consent) => consent.patient_id),
  );
  const activePlanCaseIds = new Set(dependent.activeManagementPlans.map((plan) => plan.case_id));
  const missingVisitConsentSchedules = core.upcomingSchedules.filter(
    (schedule) => !consentedPatientIds.has(schedule.case_.patient.id),
  );
  const missingManagementPlanSchedules = core.upcomingSchedules.filter(
    (schedule) => !activePlanCaseIds.has(schedule.case_id),
  );
  const taskCountByType = Object.fromEntries(
    core.taskBuckets.map((bucket) => [bucket.task_type, bucket._count.id]),
  );
  const intakeLinkage = buildIntakeLinkage(core.candidateIntakes);
  const facilityVisibility = buildFacilityVisibility(core.upcomingSchedules, userNameById);
  const routeControlMetrics = buildRouteControlMetrics(
    core.upcomingSchedules,
    core.pendingProposals,
  );
  const afterHoursReadiness = buildAfterHoursReadiness(
    core.upcomingEmergencyShifts,
    core.upcomingHolidays,
  );
  const inventoryReadiness = {
    blocked: core.upcomingSchedules.filter((schedule) => schedule.carry_items_status === 'blocked')
      .length,
    partial: core.upcomingSchedules.filter((schedule) => schedule.carry_items_status === 'partial')
      .length,
  };

  return {
    cycle_status_counts: buildCycleStatusSection(core.cycleCounts),
    workflow_exceptions: {
      open: core.exceptionCount,
      items: core.openWorkflowExceptions.map((exception) => ({
        id: exception.id,
        exception_type: exception.exception_type,
        description: exception.description,
        severity: exception.severity,
        patient_name: exception.cycle?.case_?.patient.name ?? null,
        created_at: exception.created_at.toISOString(),
      })),
    },
    communication_requests: {
      pending: core.pendingRequests,
      overdue: core.overdueRequests,
    },
    delivery: {
      failures: core.deliveryFailures,
    },
    visit_operations: buildVisitOperationsSection(
      core.overdueVisits,
      core.awaitingReports,
      missingVisitConsentSchedules.length,
      missingManagementPlanSchedules.length,
      dependent.missingFirstVisitDocCount,
      dependent.missingEmergencyContactCount,
      dependent.missingPrimaryPhysicianCount,
    ),
    operations_queue: {
      visit_demands: taskCountByType.visit_demand ?? 0,
      callback_followups: taskCountByType.visit_contact_followup ?? 0,
      management_plan_reviews: taskCountByType.management_plan_review ?? 0,
      preparation_pending: taskCountByType.visit_preparation ?? 0,
      geocode_reviews: taskCountByType.geocode_review ?? 0,
      intake_linkages: taskCountByType.visit_intake_linkage ?? 0,
      self_reports_triage: core.triageSelfReports.length,
    },
    role_inboxes: buildRoleInboxes(
      taskCountByType,
      core.awaitingReports,
      core.pendingProposals,
      core.communicationQueue,
      core.billingReviewTasks,
      routeControlMetrics,
      afterHoursReadiness.holiday_gaps,
      inventoryReadiness,
      currentRole,
    ),
    communication_queue: core.communicationQueue,
    patient_risk_queue: {
      high_risk_count: core.patientRiskQueue.filter((item) => item.level === 'high').length,
      items: core.patientRiskQueue,
    },
    inquiry_workbench: buildInquiryWorkbench(
      core.unresolvedInquiryRecords,
      core.openMedicationIssues,
      dependent.linkedInquiryRequests,
      dependent.latestCyclesForIssues,
      patientNameById,
    ),
    remediation_guidance: buildRemediationGuidance(
      missingVisitConsentSchedules.length,
      missingManagementPlanSchedules.length,
      dependent.missingFirstVisitDocCount,
      dependent.missingEmergencyContactCount,
      dependent.missingPrimaryPhysicianCount,
      taskCountByType,
      core.triageSelfReports.length,
    ),
    unified_workbench: buildUnifiedWorkbench(
      core.pendingTasks,
      core.pendingProposals,
      core.upcomingSchedules,
      core.triageSelfReports,
      core.awaitingReports,
      intakeLinkage,
      core.communicationQueue,
      userNameById,
      patientNameById,
    ),
    facility_visibility: {
      clusters: facilityVisibility.clusters,
    },
    exception_command_center: buildExceptionCommandCenter(
      core.openWorkflowExceptions,
      core.overdueVisits,
      core.awaitingReports,
      core.triageSelfReports.length,
    ),
    workload_metrics: {
      pharmacists: buildWorkloadMetrics(
        core.upcomingSchedules,
        core.pendingTasks,
        facilityVisibility,
        userNameById,
      ),
    },
    route_operations: buildRouteOperations(core.upcomingSchedules, core.pendingProposals),
    outcome_metrics: buildOutcomeMetrics(
      core.recentSchedules,
      core.awaitingReports,
      core.exceptionCount,
    ),
    route_control: routeControlMetrics,
    after_hours_readiness: afterHoursReadiness,
    inventory_readiness: inventoryReadiness,
    regional_pipeline: {
      follow_up_activities: core.communityFollowups.length,
      conference_action_items: taskCountByType.conference_action_item ?? 0,
      intake_cases: core.intakeCasesAwaitingStart,
      top_followups: core.communityFollowups.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        partner_name: item.partner_name,
        activity_type: item.activity_type,
        activity_date: item.activity_date.toISOString(),
        referrals_generated: item.referrals_generated,
      })),
    },
    billing_prevention: {
      previsit_blockers:
        missingVisitConsentSchedules.length + missingManagementPlanSchedules.length,
      review_tasks: core.billingReviewTasks,
      report_delivery_backlog: core.communicationQueue.summary.delivery_backlog,
    },
    home_care_feature_summary: core.homeCareFeatureSummary,
    intake_linkage: intakeLinkage,
    conference_follow_ups: {
      pending_tasks: core.conferencePendingTasks,
      undelivered_reports: core.conferenceUndeliveredReports,
    },
    self_reports: core.triageSelfReports.map((report) => ({
      id: report.id,
      patient_name: patientNameById.get(report.patient_id) ?? '患者未登録',
      reported_by_name: report.reported_by_name,
      relation: report.relation,
      subject: report.subject,
      category: report.category,
      requested_callback: report.requested_callback,
      preferred_contact_time: report.preferred_contact_time,
      status: report.status,
      created_at: report.created_at.toISOString(),
    })),
    refill_upcoming: buildRefillUpcoming(core.candidateIntakes, sevenDaysFromNow, upcomingWindow),
  };
}
