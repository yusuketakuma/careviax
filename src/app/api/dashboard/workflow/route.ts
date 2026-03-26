import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  getVisitWorkflowGuidance,
  type VisitWorkflowGateIssue,
} from '@/server/services/management-plans';
import { describeOperationalTask } from '@/server/services/operational-tasks';
import { listCommunicationQueue } from '@/server/services/communication-queue';
import { listPatientRiskSummaries } from '@/server/services/patient-risk';

type QueuePriority = 'urgent' | 'high' | 'normal' | 'low';

type RemediationGuidanceItem = {
  id: string;
  title: string;
  description: string;
  severity: 'urgent' | 'high' | 'normal';
  count: number;
  action_href: string;
  action_label: string;
};

type WorkbenchItem = {
  id: string;
  item_type: 'task' | 'proposal' | 'visit' | 'self_report' | 'aggregate';
  queue_label: string;
  title: string;
  summary: string;
  priority: QueuePriority;
  due_at: string | null;
  action_href: string;
  action_label: string;
  owner_name: string | null;
  patient_name: string | null;
  badges: string[];
};

type RouteOperations = {
  locked_confirmed_visits: number;
  fallback_assignments: number;
  override_pending: number;
  emergency_candidates: number;
};

type RoleInboxBucket = {
  role: 'pharmacist' | 'clerk' | 'admin';
  label: string;
  open_items: number;
  urgent_items: number;
  communication_items: number;
  action_href: string;
};

function startOfDay(value = new Date()) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function isoOrNull(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
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

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const today = startOfDay();
  const upcomingWindow = new Date(today);
  upcomingWindow.setDate(upcomingWindow.getDate() + 14);
  const sevenDaysFromNow = new Date(today);
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
  const recentOutcomeWindow = new Date(today);
  recentOutcomeWindow.setDate(recentOutcomeWindow.getDate() - 7);

  const [
    cycleCounts,
    exceptionCount,
    openWorkflowExceptions,
    pendingRequests,
    overdueRequests,
    taskBuckets,
    pendingTasks,
    overdueVisits,
    awaitingReports,
    upcomingSchedules,
    recentSchedules,
    pendingProposals,
    deliveryFailures,
    candidateIntakes,
    triageSelfReports,
    communityFollowups,
    intakeCasesAwaitingStart,
    upcomingEmergencyShifts,
    upcomingHolidays,
    communicationQueue,
    patientRiskQueue,
    billingReviewTasks,
  ] = await Promise.all([
    prisma.medicationCycle.groupBy({
      by: ['overall_status'],
      where: {
        org_id: req.orgId,
        overall_status: {
          notIn: ['cancelled', 'reported'],
        },
      },
      _count: { id: true },
    }),
    prisma.workflowException.count({
      where: {
        org_id: req.orgId,
        status: 'open',
      },
    }),
    prisma.workflowException.findMany({
      where: {
        org_id: req.orgId,
        status: 'open',
      },
      orderBy: [{ created_at: 'asc' }],
      take: 6,
      select: {
        id: true,
        exception_type: true,
        description: true,
        severity: true,
        created_at: true,
        cycle: {
          select: {
            case_id: true,
            case_: {
              select: {
                patient: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.communicationRequest.count({
      where: {
        org_id: req.orgId,
        status: { in: ['sent', 'received', 'in_progress'] },
      },
    }),
    prisma.communicationRequest.count({
      where: {
        org_id: req.orgId,
        status: { notIn: ['closed', 'cancelled', 'responded'] },
        due_date: { lt: new Date() },
      },
    }),
    prisma.task.groupBy({
      by: ['task_type'],
      where: {
        org_id: req.orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
      },
      _count: { id: true },
    }),
    prisma.task.findMany({
      where: {
        org_id: req.orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
      },
      orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
      take: 12,
      select: {
        id: true,
        task_type: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        assigned_to: true,
        due_date: true,
        sla_due_at: true,
        related_entity_type: true,
        related_entity_id: true,
        metadata: true,
      },
    }),
    prisma.visitSchedule.count({
      where: {
        org_id: req.orgId,
        scheduled_date: { lt: today },
        schedule_status: {
          notIn: ['completed', 'cancelled', 'postponed', 'rescheduled', 'no_show'],
        },
        visit_record: { is: null },
      },
    }),
    prisma.medicationCycle.count({
      where: {
        org_id: req.orgId,
        overall_status: 'visit_completed',
      },
    }),
    prisma.visitSchedule.findMany({
      where: {
        org_id: req.orgId,
        scheduled_date: {
          gte: today,
          lte: upcomingWindow,
        },
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready'],
        },
      },
      orderBy: [{ scheduled_date: 'asc' }, { time_window_start: 'asc' }],
      take: 48,
      select: {
        id: true,
        case_id: true,
        scheduled_date: true,
        time_window_start: true,
        time_window_end: true,
        confirmed_at: true,
        schedule_status: true,
        priority: true,
        pharmacist_id: true,
        assignment_mode: true,
        carry_items_status: true,
        route_order: true,
        escalation_reason: true,
        preparation: {
          select: {
            medication_changes_reviewed: true,
            carry_items_confirmed: true,
            previous_issues_reviewed: true,
            route_confirmed: true,
            offline_synced: true,
            prepared_at: true,
          },
        },
        override_request: {
          select: {
            id: true,
            status: true,
            reason: true,
          },
        },
        applied_override: {
          select: {
            id: true,
            reason: true,
          },
        },
        case_: {
          select: {
            patient: {
              select: {
                id: true,
                name: true,
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    building_id: true,
                  },
                },
              },
            },
          },
        },
        site: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.visitSchedule.findMany({
      where: {
        org_id: req.orgId,
        scheduled_date: {
          gte: recentOutcomeWindow,
          lt: today,
        },
        schedule_status: {
          in: ['completed', 'postponed', 'cancelled', 'rescheduled', 'no_show'],
        },
      },
      select: {
        id: true,
        schedule_status: true,
        priority: true,
      },
    }),
    prisma.visitScheduleProposal.findMany({
      where: {
        org_id: req.orgId,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
      },
      orderBy: [{ proposed_date: 'asc' }, { created_at: 'asc' }],
      take: 8,
      select: {
        id: true,
        proposal_status: true,
        patient_contact_status: true,
        priority: true,
        proposed_date: true,
        visit_deadline_date: true,
        proposed_pharmacist_id: true,
        proposal_reason: true,
        reschedule_source_schedule_id: true,
        case_: {
          select: {
            patient: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.deliveryRecord.count({
      where: {
        org_id: req.orgId,
        status: 'failed',
      },
    }),
    prisma.prescriptionIntake.findMany({
      where: {
        org_id: req.orgId,
        OR: [
          {
            source_type: 'refill',
            refill_remaining_count: { gt: 0 },
            refill_next_dispense_date: {
              gte: today,
              lte: upcomingWindow,
            },
          },
          {
            prescription_expiry_date: {
              gte: today,
              lte: sevenDaysFromNow,
            },
          },
        ],
      },
      orderBy: [
        { refill_next_dispense_date: 'asc' },
        { prescription_expiry_date: 'asc' },
        { prescribed_date: 'asc' },
      ],
      take: 20,
      select: {
        id: true,
        cycle_id: true,
        source_type: true,
        refill_remaining_count: true,
        prescribed_date: true,
        prescription_expiry_date: true,
        refill_next_dispense_date: true,
        cycle: {
          select: {
            id: true,
            patient_id: true,
            case_id: true,
            case_: {
              select: {
                id: true,
                primary_pharmacist_id: true,
                patient: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            visit_schedules: {
              where: {
                schedule_status: {
                  in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
                },
                scheduled_date: { gte: today },
              },
              select: { id: true },
            },
            visit_schedule_proposals: {
              where: {
                proposal_status: {
                  in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
                },
              },
              select: { id: true },
            },
          },
        },
      },
    }),
    prisma.patientSelfReport.findMany({
      where: {
        org_id: req.orgId,
        status: { in: ['submitted', 'triaged'] },
      },
      orderBy: [{ created_at: 'asc' }],
      take: 8,
      select: {
        id: true,
        patient_id: true,
        reported_by_name: true,
        relation: true,
        category: true,
        subject: true,
        requested_callback: true,
        preferred_contact_time: true,
        status: true,
        created_at: true,
      },
    }),
    prisma.communityActivity.findMany({
      where: {
        org_id: req.orgId,
        follow_up_required: true,
      },
      orderBy: [{ activity_date: 'asc' }],
      take: 8,
      select: {
        id: true,
        title: true,
        partner_name: true,
        activity_type: true,
        activity_date: true,
        referrals_generated: true,
      },
    }),
    prisma.careCase.count({
      where: {
        org_id: req.orgId,
        status: { in: ['referral_received', 'assessment'] },
      },
    }),
    prisma.pharmacistShift.findMany({
      where: {
        org_id: req.orgId,
        date: {
          gte: today,
          lte: upcomingWindow,
        },
        available: true,
        user: {
          is_active: true,
          can_accept_emergency: true,
        },
      },
      select: {
        date: true,
        site_id: true,
        user_id: true,
      },
    }),
    prisma.businessHoliday.findMany({
      where: {
        org_id: req.orgId,
        date: {
          gte: today,
          lte: upcomingWindow,
        },
        is_closed: true,
      },
      select: {
        id: true,
        date: true,
        name: true,
        site_id: true,
      },
    }),
    listCommunicationQueue(prisma, {
      orgId: req.orgId,
      limit: 8,
    }),
    listPatientRiskSummaries(prisma, {
      orgId: req.orgId,
      limit: 8,
    }),
    prisma.task.count({
      where: {
        org_id: req.orgId,
        task_type: 'billing_evidence_review',
        status: {
          in: ['pending', 'in_progress'],
        },
      },
    }),
  ]);

  const cycleStatusMap: Record<string, number> = {};
  for (const row of cycleCounts) {
    cycleStatusMap[row.overall_status] = row._count.id;
  }

  const upcomingPatientIds = Array.from(
    new Set(upcomingSchedules.map((schedule) => schedule.case_.patient.id))
  );
  const upcomingCaseIds = Array.from(
    new Set(upcomingSchedules.map((schedule) => schedule.case_id))
  );

  const [activeVisitConsents, activeManagementPlans] = await Promise.all([
    upcomingPatientIds.length === 0
      ? []
      : prisma.consentRecord.findMany({
          where: {
            org_id: req.orgId,
            patient_id: { in: upcomingPatientIds },
            consent_type: 'visit_medication_management',
            is_active: true,
            revoked_date: null,
            OR: [{ expiry_date: null }, { expiry_date: { gte: today } }],
          },
          select: { patient_id: true },
        }),
    upcomingCaseIds.length === 0
      ? []
      : prisma.managementPlan.findMany({
          where: {
            org_id: req.orgId,
            case_id: { in: upcomingCaseIds },
            status: 'approved',
            approved_at: { not: null },
            OR: [{ next_review_date: null }, { next_review_date: { gte: today } }],
          },
          select: { case_id: true },
        }),
  ]);

  const selfReportPatientIds = Array.from(
    new Set(triageSelfReports.map((report) => report.patient_id))
  );
  const userIds = Array.from(
    new Set(
      [
        ...pendingTasks.map((task) => task.assigned_to),
        ...upcomingSchedules.map((schedule) => schedule.pharmacist_id),
        ...pendingProposals.map((proposal) => proposal.proposed_pharmacist_id),
        ...candidateIntakes.map((intake) => intake.cycle?.case_.primary_pharmacist_id ?? null),
      ].filter((value): value is string => Boolean(value))
    )
  );

  const [patientsForReports, users] = await Promise.all([
    selfReportPatientIds.length === 0
      ? []
      : prisma.patient.findMany({
          where: {
            org_id: req.orgId,
            id: { in: selfReportPatientIds },
          },
          select: {
            id: true,
            name: true,
          },
        }),
    userIds.length === 0
      ? []
      : prisma.user.findMany({
          where: {
            org_id: req.orgId,
            id: { in: userIds },
          },
          select: {
            id: true,
            name: true,
          },
        }),
  ]);

  const patientNameById = new Map(patientsForReports.map((patient) => [patient.id, patient.name]));
  const userNameById = new Map(users.map((user) => [user.id, user.name]));
  const consentedPatientIds = new Set(activeVisitConsents.map((consent) => consent.patient_id));
  const activePlanCaseIds = new Set(activeManagementPlans.map((plan) => plan.case_id));

  const missingVisitConsentSchedules = upcomingSchedules.filter(
    (schedule) => !consentedPatientIds.has(schedule.case_.patient.id)
  );
  const missingManagementPlanSchedules = upcomingSchedules.filter(
    (schedule) => !activePlanCaseIds.has(schedule.case_id)
  );

  const taskCountByType = Object.fromEntries(
    taskBuckets.map((bucket) => [bucket.task_type, bucket._count.id])
  );

  const refillUpcoming = candidateIntakes
    .filter(
      (intake) =>
        intake.source_type === 'refill' &&
        (intake.refill_remaining_count ?? 0) > 0 &&
        intake.refill_next_dispense_date != null &&
        intake.refill_next_dispense_date <= sevenDaysFromNow
    )
    .slice(0, 10);

  const intakeLinkage = candidateIntakes
    .filter(
      (intake) =>
        intake.cycle?.case_ &&
        intake.cycle.visit_schedules.length === 0 &&
        intake.cycle.visit_schedule_proposals.length === 0
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

  const guidanceCounts = new Map<VisitWorkflowGateIssue, number>([
    ['missing_visit_consent', missingVisitConsentSchedules.length],
    ['missing_management_plan', missingManagementPlanSchedules.length],
    ['management_plan_review_overdue', taskCountByType.management_plan_review ?? 0],
  ]);

  const remediationGuidance: RemediationGuidanceItem[] = [
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
          action_href: guidance.actionHref,
          action_label: guidance.actionLabel,
        } satisfies RemediationGuidanceItem;
      }),
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
    ...(triageSelfReports.length > 0
      ? [
          {
            id: 'self_report_triage',
            title: '患者・家族セルフレポートの確認が必要です',
            description: '患者または家族からの申告が triage 待ちまたは triage 中です。',
            severity: 'high' as const,
            count: triageSelfReports.length,
            action_href: '/workflow',
            action_label: 'セルフレポートを確認',
          } satisfies RemediationGuidanceItem,
        ]
      : []),
  ];

  const exceptionCommandCenter = [
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
    ...(triageSelfReports.length > 0
      ? [
          {
            id: 'aggregate:self_report_triage',
            type: 'self_report_triage',
            severity: 'high',
            title: '患者・家族セルフレポート',
            description: `${triageSelfReports.length}件が triage 待ちです。`,
            patient_name: null,
            created_at: null,
            action_href: '/workflow',
            action_label: 'セルフレポートを確認',
          },
        ]
      : []),
  ].slice(0, 8);

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
    const facilityLabel = residence?.building_id ?? residence?.address ?? null;
    if (!facilityLabel) continue;
    const groupKey = [
      schedule.scheduled_date.toISOString().slice(0, 10),
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

  const facilityVisibility = Array.from(facilityGroups.values())
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
  for (const group of facilityVisibility) {
    const pharmacistId = Array.from(facilityGroups.values()).find(
      (entry) => entry.id === group.id
    )?.pharmacist_id;
    if (!pharmacistId) continue;
    ensureWorkload(pharmacistId).facility_clusters += 1;
  }

  const workloadMetrics = Array.from(workloadByPharmacist.values())
    .sort((left, right) => {
      const leftScore =
        left.urgent_items * 10 + left.pending_tasks * 3 + left.confirmed_visits;
      const rightScore =
        right.urgent_items * 10 + right.pending_tasks * 3 + right.confirmed_visits;
      return rightScore - leftScore;
    })
    .slice(0, 6)
    .map((workload) => ({
      pharmacist_id: workload.pharmacist_id,
      pharmacist_name:
        userNameById.get(workload.pharmacist_id) ?? '薬剤師未登録',
      confirmed_visits: workload.confirmed_visits,
      pending_tasks: workload.pending_tasks,
      urgent_items: workload.urgent_items,
      callback_followups: workload.callback_followups,
      facility_clusters: workload.facility_clusters,
    }));

  const disruptedStatuses = new Set(['postponed', 'cancelled', 'rescheduled', 'no_show']);
  const outcomeMetrics = {
    completed_last_7_days: recentSchedules.filter(
      (schedule) => schedule.schedule_status === 'completed'
    ).length,
    disrupted_last_7_days: recentSchedules.filter((schedule) =>
      disruptedStatuses.has(schedule.schedule_status)
    ).length,
    urgent_completed_last_7_days: recentSchedules.filter(
      (schedule) =>
        schedule.schedule_status === 'completed' &&
        (schedule.priority === 'urgent' || schedule.priority === 'emergency')
    ).length,
    awaiting_reports: awaitingReports,
    open_exceptions: exceptionCount,
  };
  const routeOperations: RouteOperations = {
    locked_confirmed_visits: upcomingSchedules.filter((schedule) => schedule.confirmed_at != null).length,
    fallback_assignments: upcomingSchedules.filter((schedule) => schedule.assignment_mode === 'fallback').length,
    override_pending: upcomingSchedules.filter((schedule) => schedule.override_request?.status === 'pending').length,
    emergency_candidates: pendingProposals.filter((proposal) => proposal.priority === 'emergency').length,
  };

  const routeControlMetrics = {
    locked_schedules: upcomingSchedules.filter((schedule) => Boolean(schedule.confirmed_at)).length,
    pending_override_requests: upcomingSchedules.filter(
      (schedule) => schedule.override_request?.status === 'pending'
    ).length,
    emergency_impact_items:
      upcomingSchedules.filter((schedule) => schedule.priority === 'emergency').length +
      pendingProposals.filter((proposal) => proposal.priority === 'emergency').length,
  };

  const emergencyCoverageByDate = new Map<string, number>();
  for (const shift of upcomingEmergencyShifts) {
    const dateKey = shift.date.toISOString().slice(0, 10);
    emergencyCoverageByDate.set(dateKey, (emergencyCoverageByDate.get(dateKey) ?? 0) + 1);
  }
  const upcomingHolidayGaps = upcomingHolidays
    .filter((holiday) => (emergencyCoverageByDate.get(holiday.date.toISOString().slice(0, 10)) ?? 0) === 0)
    .slice(0, 6)
    .map((holiday) => ({
      id: holiday.id,
      date: holiday.date.toISOString(),
      name: holiday.name,
      site_id: holiday.site_id,
    }));

  const inventoryReadiness = {
    blocked: upcomingSchedules.filter((schedule) => schedule.carry_items_status === 'blocked').length,
    partial: upcomingSchedules.filter((schedule) => schedule.carry_items_status === 'partial').length,
  };

  const roleInboxes: RoleInboxBucket[] = [
    {
      role: 'pharmacist',
      label: '薬剤師 inbox',
      open_items:
        (taskCountByType.visit_demand ?? 0) +
        (taskCountByType.visit_preparation ?? 0) +
        (taskCountByType.patient_self_report_followup ?? 0) +
        awaitingReports,
      urgent_items:
        pendingProposals.filter((proposal) =>
          ['urgent', 'emergency'].includes(proposal.priority)
        ).length +
        communicationQueue.summary.callback_followups,
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
        communicationQueue.summary.overdue_count +
        communicationQueue.summary.delivery_backlog,
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

  const regionalPipeline = {
    follow_up_activities: communityFollowups.length,
    conference_action_items: taskCountByType.conference_action_item ?? 0,
    intake_cases: intakeCasesAwaitingStart,
    top_followups: communityFollowups.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      partner_name: item.partner_name,
      activity_type: item.activity_type,
      activity_date: item.activity_date.toISOString(),
      referrals_generated: item.referrals_generated,
    })),
  };

  const billingPrevention = {
    previsit_blockers:
      missingVisitConsentSchedules.length + missingManagementPlanSchedules.length,
    review_tasks: billingReviewTasks,
    report_delivery_backlog: communicationQueue.summary.delivery_backlog,
  };

  const taskItems: WorkbenchItem[] = pendingTasks.map((task) => {
    const presentation = describeOperationalTask(task);
    const taskMetadata =
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : null;
    return {
      id: `task:${task.id}`,
      item_type: 'task',
      queue_label: presentation.queueLabel,
      title: task.title,
      summary: task.description ?? '担当者アクション待ちです。',
      priority: task.priority,
      due_at: isoOrNull(task.sla_due_at ?? task.due_date),
      action_href: presentation.actionHref,
      action_label: presentation.actionLabel,
      owner_name: task.assigned_to ? userNameById.get(task.assigned_to) ?? null : null,
      patient_name:
        typeof taskMetadata?.patient_name === 'string'
          ? taskMetadata.patient_name
          : null,
      badges: [task.task_type, task.status],
    };
  });

  const proposalItems: WorkbenchItem[] = pendingProposals.map((proposal) => ({
    id: `proposal:${proposal.id}`,
    item_type: 'proposal',
    queue_label:
      proposal.proposal_status === 'patient_contact_pending' ? '架電' : '訪問候補',
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
    badges: [proposal.proposal_status, proposal.patient_contact_status],
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
      return {
        id: `visit:${schedule.id}`,
        item_type: 'visit',
        queue_label: schedule.assignment_mode === 'fallback' ? '引継ぎ' : '訪問準備',
        title: `${schedule.case_.patient.name} の訪問前対応`,
        summary: reasons.join(' / '),
        priority: schedule.priority === 'emergency' ? 'urgent' : 'high',
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
    item_type: 'self_report',
    queue_label: 'セルフレポート',
    title: `${patientNameById.get(report.patient_id) ?? '患者'} から申告があります`,
    summary: `${report.subject} / ${report.reported_by_name}${report.relation ? ` (${report.relation})` : ''}`,
    priority: report.requested_callback ? 'urgent' : 'high',
    due_at: report.created_at.toISOString(),
    action_href: '/workflow',
    action_label: 'triage を進める',
    owner_name: null,
    patient_name: patientNameById.get(report.patient_id) ?? null,
    badges: [report.status, report.category, ...(report.requested_callback ? ['折返し希望'] : [])],
  }));

  const aggregateItems: WorkbenchItem[] = [
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
            due_at: intakeLinkage[0]?.due_at ?? null,
            action_href: '/workflow',
            action_label: '未接続の処方を確認',
            owner_name: null,
            patient_name: null,
            badges: ['visit_intake_linkage'],
          },
        ]
      : []),
  ];

  const unifiedWorkbench = [...taskItems, ...proposalItems, ...visitItems, ...selfReportItems, ...aggregateItems]
    .sort(sortWorkbenchItems)
    .slice(0, 12);

  return success({
    data: {
      cycle_status_counts: cycleStatusMap,
      workflow_exceptions: {
        open: exceptionCount,
        items: openWorkflowExceptions.map((exception) => ({
          id: exception.id,
          exception_type: exception.exception_type,
          description: exception.description,
          severity: exception.severity,
          patient_name: exception.cycle?.case_?.patient.name ?? null,
          created_at: exception.created_at.toISOString(),
        })),
      },
      communication_requests: {
        pending: pendingRequests,
        overdue: overdueRequests,
      },
      delivery: {
        failures: deliveryFailures,
      },
      visit_operations: {
        overdue: overdueVisits,
        awaiting_reports: awaitingReports,
        missing_visit_consent: missingVisitConsentSchedules.length,
        missing_management_plan: missingManagementPlanSchedules.length,
      },
      operations_queue: {
        visit_demands: taskCountByType.visit_demand ?? 0,
        callback_followups: taskCountByType.visit_contact_followup ?? 0,
        management_plan_reviews: taskCountByType.management_plan_review ?? 0,
        preparation_pending: taskCountByType.visit_preparation ?? 0,
        geocode_reviews: taskCountByType.geocode_review ?? 0,
        intake_linkages: taskCountByType.visit_intake_linkage ?? 0,
        self_reports_triage: triageSelfReports.length,
      },
      role_inboxes: {
        current_role: req.role,
        buckets: roleInboxes,
      },
      communication_queue: communicationQueue,
      patient_risk_queue: {
        high_risk_count: patientRiskQueue.filter((item) => item.level === 'high').length,
        items: patientRiskQueue,
      },
      remediation_guidance: remediationGuidance,
      unified_workbench: unifiedWorkbench,
      facility_visibility: {
        clusters: facilityVisibility,
      },
      exception_command_center: exceptionCommandCenter,
      workload_metrics: {
        pharmacists: workloadMetrics,
      },
      route_operations: routeOperations,
      outcome_metrics: outcomeMetrics,
      route_control: routeControlMetrics,
      after_hours_readiness: {
        emergency_capable_shift_count: upcomingEmergencyShifts.length,
        holiday_gap_count: upcomingHolidayGaps.length,
        holiday_gaps: upcomingHolidayGaps,
      },
      inventory_readiness: inventoryReadiness,
      regional_pipeline: regionalPipeline,
      billing_prevention: billingPrevention,
      intake_linkage: intakeLinkage,
      self_reports: triageSelfReports.map((report) => ({
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
      refill_upcoming: refillUpcoming,
    },
  });
}, {
  permission: 'canViewDashboard',
  message: 'ダッシュボードの閲覧権限がありません',
});
