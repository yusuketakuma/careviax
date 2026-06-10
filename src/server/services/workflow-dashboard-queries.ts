import { Prisma, type PrismaClient } from '@prisma/client';
import {
  WORKFLOW_COMMUNICATION_LIMIT,
  WORKFLOW_COMMUNITY_FOLLOWUP_LIMIT,
  WORKFLOW_ISSUE_LIMIT,
  WORKFLOW_PROPOSAL_LIMIT,
  WORKFLOW_REFILL_LIMIT,
  WORKFLOW_RISK_QUEUE_LIMIT,
  WORKFLOW_SELF_REPORT_LIMIT,
  WORKFLOW_TASK_LIMIT,
  WORKFLOW_UPCOMING_SCHEDULE_LIMIT,
} from '@/lib/constants/workflow';
import { listCommunicationQueue } from '@/server/services/communication-queue';
import { listPatientRiskSummaries } from '@/server/services/patient-risk';
import { getHomeCareFeatureSummary } from '@/server/services/home-care-ops';
import { buildVisitScheduleBillingPreviewBatch } from '@/server/services/visit-schedule-billing-preview';
import {
  buildDashboardTaskAssignmentWhere,
  type DashboardAssignmentScope,
} from './dashboard-assignment-scope';
import { formatDateKey } from '@/lib/date-key';

export type WorkflowCoreData = {
  cycleCounts: Array<{ overall_status: string; _count: { id: number } }>;
  exceptionCount: number;
  openWorkflowExceptions: Array<{
    id: string;
    exception_type: string;
    description: string;
    severity: string;
    created_at: Date;
    cycle: {
      case_id: string;
      case_: { patient: { id: string; name: string } };
    } | null;
  }>;
  pendingRequests: number;
  overdueRequests: number;
  taskBuckets: Array<{ task_type: string; _count: { id: number } }>;
  pendingTasks: Array<{
    id: string;
    task_type: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    assigned_to: string | null;
    due_date: Date | null;
    sla_due_at: Date | null;
    related_entity_type: string | null;
    related_entity_id: string | null;
    metadata: unknown;
  }>;
  overdueVisits: number;
  awaitingReports: number;
  upcomingSchedules: Array<{
    id: string;
    case_id: string;
    scheduled_date: Date;
    time_window_start: Date | null;
    time_window_end: Date | null;
    confirmed_at: Date | null;
    schedule_status: string;
    priority: string;
    pharmacist_id: string;
    assignment_mode: string;
    carry_items_status: string | null;
    route_order: number | null;
    escalation_reason: string | null;
    preparation: {
      medication_changes_reviewed: boolean;
      carry_items_confirmed: boolean;
      previous_issues_reviewed: boolean;
      route_confirmed: boolean;
      offline_synced: boolean;
      prepared_at: Date | null;
    } | null;
    override_request: {
      id: string;
      status: string;
      reason: string | null;
    } | null;
    applied_override: {
      id: string;
      reason: string | null;
    } | null;
    case_: {
      patient: {
        id: string;
        name: string;
        residences: Array<{
          address: string | null;
          building_id: string | null;
        }>;
      };
    };
    site: { id: string; name: string } | null;
    cadence_preview?: {
      next_billable_date: string | null;
      remaining_month_count: number;
      warning_messages: string[];
    } | null;
  }>;
  recentSchedules: Array<{
    id: string;
    schedule_status: string;
    priority: string;
  }>;
  pendingProposals: Array<{
    id: string;
    proposal_status: string;
    patient_contact_status: string | null;
    priority: string;
    proposed_date: Date | null;
    visit_deadline_date: Date | null;
    proposed_pharmacist_id: string;
    proposal_reason: string | null;
    reschedule_source_schedule_id: string | null;
    case_: { patient: { id: string; name: string } };
  }>;
  deliveryFailures: number;
  candidateIntakes: Array<{
    id: string;
    cycle_id: string | null;
    source_type: string;
    refill_remaining_count: number | null;
    split_dispense_total: number | null;
    split_dispense_current: number | null;
    prescribed_date: Date;
    prescription_expiry_date: Date | null;
    refill_next_dispense_date: Date | null;
    split_next_dispense_date: Date | null;
    cycle: {
      id: string;
      patient_id: string;
      case_id: string;
      case_: {
        id: string;
        primary_pharmacist_id: string | null;
        patient: { id: string; name: string };
      };
      visit_schedules: Array<{ id: string }>;
      visit_schedule_proposals: Array<{ id: string }>;
    } | null;
  }>;
  unresolvedInquiryRecords: Array<{
    id: string;
    cycle_id: string | null;
    issue_id: string | null;
    line_id: string | null;
    reason: string;
    inquiry_to_physician: string | null;
    inquiry_content: string | null;
    result: string | null;
    proposal_origin: string | null;
    residual_adjustment: boolean | null;
    change_detail: string | null;
    inquired_at: Date;
    line: {
      id: string;
      drug_name: string;
      dose: string | null;
      frequency: string | null;
      days: number | null;
    } | null;
    cycle: {
      case_id: string;
      patient_id: string;
      case_: { patient: { id: string; name: string } };
      prescription_intakes: Array<{ prescriber_name: string | null }>;
    };
    issue: {
      id: string;
      title: string;
      description: string | null;
      priority: string;
      category: string | null;
    } | null;
  }>;
  openMedicationIssues: Array<{
    id: string;
    patient_id: string;
    case_id: string | null;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    category: string | null;
    identified_at: Date;
  }>;
  triageSelfReports: Array<{
    id: string;
    patient_id: string;
    reported_by_name: string | null;
    relation: string | null;
    category: string | null;
    subject: string | null;
    requested_callback: boolean;
    preferred_contact_time: string | null;
    status: string;
    created_at: Date;
  }>;
  communityFollowups: Array<{
    id: string;
    title: string;
    partner_name: string | null;
    activity_type: string;
    activity_date: Date;
    referrals_generated: number | null;
  }>;
  intakeCasesAwaitingStart: number;
  upcomingEmergencyShifts: Array<{
    date: Date;
    site_id: string | null;
    user_id: string;
  }>;
  upcomingHolidays: Array<{
    id: string;
    date: Date;
    name: string;
    site_id: string | null;
  }>;
  communicationQueue: Awaited<ReturnType<typeof listCommunicationQueue>>;
  patientRiskQueue: Awaited<ReturnType<typeof listPatientRiskSummaries>>;
  billingReviewTasks: number;
  conferencePendingTasks: number;
  conferenceUndeliveredReports: number;
  homeCareFeatureSummary: Awaited<ReturnType<typeof getHomeCareFeatureSummary>>;
};

function buildCaseScope(caseIds: string[] | undefined) {
  return caseIds === undefined ? {} : { case_id: { in: caseIds } };
}

function buildPatientScope(patientIds: string[] | undefined) {
  return patientIds === undefined ? {} : { patient_id: { in: patientIds } };
}

function buildCareCaseScope(caseIds: string[] | undefined) {
  return caseIds === undefined ? {} : { id: { in: caseIds } };
}

function buildNullableCaseBackedScope(args: { caseIds?: string[]; patientIds?: string[] }) {
  if (args.caseIds === undefined && args.patientIds === undefined) return {};

  const scopes = [
    ...(args.caseIds && args.caseIds.length > 0 ? [{ case_id: { in: args.caseIds } }] : []),
    ...(args.patientIds && args.patientIds.length > 0
      ? [{ case_id: null, patient_id: { in: args.patientIds } }]
      : []),
  ];

  return scopes.length > 0 ? { OR: scopes } : { id: { in: [] } };
}

function buildCycleRelationScope(args: { caseIds?: string[]; patientIds?: string[] }) {
  if (args.caseIds === undefined) return {};
  return args.caseIds.length > 0
    ? { cycle: { case_id: { in: args.caseIds } } }
    : { id: { in: [] } };
}

function buildReportRelationScope(args: { caseIds?: string[]; patientIds?: string[] }) {
  if (args.caseIds === undefined && args.patientIds === undefined) return {};

  const scopes = [
    ...(args.caseIds && args.caseIds.length > 0 ? [{ case_id: { in: args.caseIds } }] : []),
    ...(args.patientIds && args.patientIds.length > 0
      ? [{ case_id: null, patient_id: { in: args.patientIds } }]
      : []),
  ];

  return scopes.length > 0 ? { report: { OR: scopes } } : { id: { in: [] } };
}

function isDashboardAssignmentScoped(scope: DashboardAssignmentScope) {
  return scope.caseIds !== undefined || scope.patientIds !== undefined;
}

const EMPTY_SCOPED_HOME_CARE_FEATURE_SUMMARY = {
  totals: { blocked: 0, attention: 0, monitoring: 0, ready: 0 },
  features: [],
} satisfies Awaited<ReturnType<typeof getHomeCareFeatureSummary>>;

async function countConferenceUndeliveredReports(
  prisma: PrismaClient,
  orgId: string,
  assignmentScope: DashboardAssignmentScope,
) {
  const scoped = isDashboardAssignmentScoped(assignmentScope);
  const scopedPredicates = [
    ...(assignmentScope.caseIds && assignmentScope.caseIds.length > 0
      ? [Prisma.sql`case_id IN (${Prisma.join(assignmentScope.caseIds)})`]
      : []),
    ...(assignmentScope.patientIds && assignmentScope.patientIds.length > 0
      ? [
          Prisma.sql`(case_id IS NULL AND patient_id IN (${Prisma.join(assignmentScope.patientIds)}))`,
        ]
      : []),
  ];
  if (scoped && scopedPredicates.length === 0) return 0;

  if (typeof prisma.$queryRaw === 'function') {
    const scopePredicate =
      scopedPredicates.length > 0
        ? Prisma.sql`AND (${Prisma.join(scopedPredicates, ' OR ')})`
        : Prisma.empty;

    return prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM "ConferenceNote"
      WHERE org_id = ${orgId}
        ${scopePredicate}
        AND action_items IS NOT NULL
        AND action_items != 'null'::jsonb
        AND jsonb_array_length(action_items) > 0
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(action_items) AS item
          WHERE item->>'converted_task_id' IS NULL
        )
    `.then((rows) => Number(rows[0]?.count ?? 0));
  }

  const notes = await prisma.conferenceNote.findMany({
    where: {
      org_id: orgId,
      ...buildNullableCaseBackedScope(assignmentScope),
    },
    select: {
      action_items: true,
    },
  });

  return notes.filter((note) => {
    const items = note.action_items;
    return (
      Array.isArray(items) &&
      items.some(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          !('converted_task_id' in item) &&
          !('convertedTaskId' in item),
      )
    );
  }).length;
}

export async function fetchWorkflowCoreData(
  prisma: PrismaClient,
  orgId: string,
  today: Date,
  upcomingWindow: Date,
  sevenDaysFromNow: Date,
  recentOutcomeWindow: Date,
  assignmentScope: DashboardAssignmentScope = {},
): Promise<WorkflowCoreData> {
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
    unresolvedInquiryRecords,
    openMedicationIssues,
    triageSelfReports,
    communityFollowups,
    intakeCasesAwaitingStart,
    upcomingEmergencyShifts,
    upcomingHolidays,
    communicationQueue,
    patientRiskQueue,
    billingReviewTasks,
    conferencePendingTasks,
    conferenceUndeliveredReports,
    homeCareFeatureSummary,
  ] = await Promise.all([
    prisma.medicationCycle.groupBy({
      by: ['overall_status'],
      where: {
        org_id: orgId,
        ...buildCaseScope(assignmentScope.caseIds),
        overall_status: {
          notIn: ['cancelled', 'reported'],
        },
      },
      _count: { id: true },
    }),
    prisma.workflowException.count({
      where: {
        org_id: orgId,
        ...buildCycleRelationScope(assignmentScope),
        status: 'open',
      },
    }),
    prisma.workflowException.findMany({
      where: {
        org_id: orgId,
        ...buildCycleRelationScope(assignmentScope),
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
        org_id: orgId,
        ...buildNullableCaseBackedScope(assignmentScope),
        status: { in: ['sent', 'received', 'in_progress'] },
      },
    }),
    prisma.communicationRequest.count({
      where: {
        org_id: orgId,
        ...buildNullableCaseBackedScope(assignmentScope),
        status: { notIn: ['closed', 'cancelled', 'responded'] },
        due_date: { lt: new Date() },
      },
    }),
    prisma.task.groupBy({
      by: ['task_type'],
      where: {
        org_id: orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
        ...buildDashboardTaskAssignmentWhere(assignmentScope),
      },
      _count: { id: true },
    }),
    prisma.task.findMany({
      where: {
        org_id: orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
        ...buildDashboardTaskAssignmentWhere(assignmentScope),
      },
      orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
      take: WORKFLOW_TASK_LIMIT,
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
        org_id: orgId,
        ...buildCaseScope(assignmentScope.caseIds),
        scheduled_date: { lt: today },
        schedule_status: {
          notIn: ['completed', 'cancelled', 'postponed', 'rescheduled', 'no_show'],
        },
        visit_record: { is: null },
      },
    }),
    prisma.medicationCycle.count({
      where: {
        org_id: orgId,
        ...buildCaseScope(assignmentScope.caseIds),
        overall_status: 'visit_completed',
      },
    }),
    prisma.visitSchedule.findMany({
      where: {
        org_id: orgId,
        ...buildCaseScope(assignmentScope.caseIds),
        scheduled_date: {
          gte: today,
          lte: upcomingWindow,
        },
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready'],
        },
      },
      orderBy: [{ scheduled_date: 'asc' }, { time_window_start: 'asc' }],
      take: WORKFLOW_UPCOMING_SCHEDULE_LIMIT,
      select: {
        id: true,
        case_id: true,
        visit_type: true,
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
        org_id: orgId,
        ...buildCaseScope(assignmentScope.caseIds),
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
        org_id: orgId,
        ...buildCaseScope(assignmentScope.caseIds),
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
      },
      orderBy: [{ proposed_date: 'asc' }, { created_at: 'asc' }],
      take: WORKFLOW_PROPOSAL_LIMIT,
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
        org_id: orgId,
        ...buildReportRelationScope(assignmentScope),
        status: 'failed',
      },
    }),
    prisma.prescriptionIntake.findMany({
      where: {
        org_id: orgId,
        ...buildCycleRelationScope(assignmentScope),
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
            split_next_dispense_date: {
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
      take: WORKFLOW_REFILL_LIMIT,
      select: {
        id: true,
        cycle_id: true,
        source_type: true,
        refill_remaining_count: true,
        split_dispense_total: true,
        split_dispense_current: true,
        prescribed_date: true,
        prescription_expiry_date: true,
        refill_next_dispense_date: true,
        split_next_dispense_date: true,
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
    prisma.inquiryRecord.findMany({
      where: {
        org_id: orgId,
        ...buildCycleRelationScope(assignmentScope),
        resolved_at: null,
      },
      orderBy: [{ inquired_at: 'desc' }],
      take: WORKFLOW_COMMUNITY_FOLLOWUP_LIMIT,
      select: {
        id: true,
        cycle_id: true,
        issue_id: true,
        line_id: true,
        reason: true,
        inquiry_to_physician: true,
        inquiry_content: true,
        result: true,
        proposal_origin: true,
        residual_adjustment: true,
        change_detail: true,
        inquired_at: true,
        line: {
          select: {
            id: true,
            drug_name: true,
            dose: true,
            frequency: true,
            days: true,
          },
        },
        cycle: {
          select: {
            case_id: true,
            patient_id: true,
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
            prescription_intakes: {
              orderBy: [{ prescribed_date: 'desc' }],
              take: 1,
              select: {
                prescriber_name: true,
              },
            },
          },
        },
        issue: {
          select: {
            id: true,
            title: true,
            description: true,
            priority: true,
            category: true,
          },
        },
      },
    }),
    prisma.medicationIssue.findMany({
      where: {
        org_id: orgId,
        ...buildNullableCaseBackedScope(assignmentScope),
        status: {
          in: ['open', 'in_progress'],
        },
      },
      orderBy: [{ priority: 'desc' }, { identified_at: 'desc' }],
      take: WORKFLOW_ISSUE_LIMIT,
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        category: true,
        identified_at: true,
      },
    }),
    prisma.patientSelfReport.findMany({
      where: {
        org_id: orgId,
        ...buildPatientScope(assignmentScope.patientIds),
        status: { in: ['submitted', 'triaged'] },
      },
      orderBy: [{ created_at: 'asc' }],
      take: WORKFLOW_SELF_REPORT_LIMIT,
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
        org_id: orgId,
        follow_up_required: true,
      },
      orderBy: [{ activity_date: 'asc' }],
      take: WORKFLOW_COMMUNITY_FOLLOWUP_LIMIT,
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
        org_id: orgId,
        ...buildCareCaseScope(assignmentScope.caseIds),
        status: { in: ['referral_received', 'assessment'] },
      },
    }),
    prisma.pharmacistShift.findMany({
      where: {
        org_id: orgId,
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
        org_id: orgId,
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
      orgId,
      caseIds: assignmentScope.caseIds,
      patientIds: assignmentScope.patientIds,
      limit: WORKFLOW_COMMUNICATION_LIMIT,
    }),
    listPatientRiskSummaries(prisma, {
      orgId,
      patientIds: assignmentScope.patientIds,
      caseIdsByPatient: assignmentScope.caseIdsByPatient,
      limit: WORKFLOW_RISK_QUEUE_LIMIT,
      candidateLimit: WORKFLOW_RISK_QUEUE_LIMIT * 10,
    }),
    prisma.task.count({
      where: {
        org_id: orgId,
        task_type: {
          in: ['billing_evidence_review', 'initial_home_visit_assessment'],
        },
        status: {
          in: ['pending', 'in_progress'],
        },
        ...buildDashboardTaskAssignmentWhere(assignmentScope),
      },
    }),
    prisma.task.count({
      where: {
        org_id: orgId,
        related_entity_type: 'conference_note',
        status: { notIn: ['completed', 'cancelled'] },
        ...buildDashboardTaskAssignmentWhere(assignmentScope),
      },
    }),
    countConferenceUndeliveredReports(prisma, orgId, assignmentScope),
    isDashboardAssignmentScoped(assignmentScope)
      ? Promise.resolve(EMPTY_SCOPED_HOME_CARE_FEATURE_SUMMARY)
      : getHomeCareFeatureSummary(prisma, {
          orgId,
        }),
  ]);

  const cadencePreviewByScheduleId = await buildVisitScheduleBillingPreviewBatch(
    upcomingSchedules.map((schedule) => ({
      key: schedule.id,
      caseId: schedule.case_id,
      proposedDate: formatDateKey(schedule.scheduled_date),
      pharmacistId: schedule.pharmacist_id,
      siteId: schedule.site?.id ?? null,
      visitType: schedule.visit_type,
    })),
    orgId,
  );

  return {
    cycleCounts,
    exceptionCount,
    openWorkflowExceptions,
    pendingRequests,
    overdueRequests,
    taskBuckets,
    pendingTasks,
    overdueVisits,
    awaitingReports,
    upcomingSchedules: upcomingSchedules.map((schedule) => {
      const preview = cadencePreviewByScheduleId[schedule.id];
      return {
        ...schedule,
        cadence_preview: preview
          ? {
              next_billable_date: preview.cadence.next_billable_date,
              remaining_month_count: preview.cadence.remaining_month_count,
              warning_messages: [
                ...preview.alerts
                  .filter((alert) => alert.severity !== 'info')
                  .map((alert) => alert.message),
                ...(preview.warnings ?? []),
              ],
            }
          : null,
      };
    }),
    recentSchedules,
    pendingProposals,
    deliveryFailures,
    candidateIntakes,
    unresolvedInquiryRecords,
    openMedicationIssues,
    triageSelfReports,
    communityFollowups,
    intakeCasesAwaitingStart,
    upcomingEmergencyShifts,
    upcomingHolidays,
    communicationQueue,
    patientRiskQueue,
    billingReviewTasks,
    conferencePendingTasks,
    conferenceUndeliveredReports,
    homeCareFeatureSummary,
  };
}

export type WorkflowDependentData = {
  linkedInquiryRequests: Array<{
    id: string;
    related_entity_id: string | null;
    status: string;
    due_date: Date | null;
    requested_at: Date;
  }>;
  latestCyclesForIssues: Array<{
    id: string;
    case_id: string | null;
    patient_id: string;
    prescription_intakes: Array<{ prescriber_name: string | null }>;
  }>;
  activeVisitConsents: Array<{ patient_id: string }>;
  activeManagementPlans: Array<{ case_id: string }>;
  missingFirstVisitDocCount: number;
  missingEmergencyContactCount: number;
  missingPrimaryPhysicianCount: number;
  patientsForReports: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
};

export async function fetchWorkflowDependentData(
  prisma: PrismaClient,
  orgId: string,
  today: Date,
  coreData: WorkflowCoreData,
  assignmentScope: DashboardAssignmentScope = {},
): Promise<WorkflowDependentData> {
  const {
    unresolvedInquiryRecords,
    openMedicationIssues,
    upcomingSchedules,
    pendingTasks,
    pendingProposals,
    candidateIntakes,
    triageSelfReports,
  } = coreData;

  const inquiryIds = unresolvedInquiryRecords.map((item) => item.id);
  const linkedIssueIds = new Set(
    unresolvedInquiryRecords
      .map((item) => item.issue_id)
      .filter((value): value is string => Boolean(value)),
  );
  void linkedIssueIds; // used downstream in sections
  const unresolvedIssueCaseIds = Array.from(
    new Set(
      openMedicationIssues
        .map((item) => item.case_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const unresolvedIssuePatientIds = Array.from(
    new Set(openMedicationIssues.map((item) => item.patient_id)),
  );
  const scopedIssueCaseIds =
    assignmentScope.caseIds === undefined
      ? unresolvedIssueCaseIds
      : unresolvedIssueCaseIds.filter((caseId) => assignmentScope.caseIds?.includes(caseId));
  const latestCycleScopes =
    assignmentScope.caseIds === undefined
      ? [
          ...(unresolvedIssueCaseIds.length > 0
            ? [{ case_id: { in: unresolvedIssueCaseIds } }]
            : []),
          ...(unresolvedIssuePatientIds.length > 0
            ? [{ patient_id: { in: unresolvedIssuePatientIds } }]
            : []),
        ]
      : [
          ...(scopedIssueCaseIds.length > 0 ? [{ case_id: { in: scopedIssueCaseIds } }] : []),
          ...(unresolvedIssuePatientIds.length > 0 && assignmentScope.caseIds.length > 0
            ? [
                {
                  patient_id: { in: unresolvedIssuePatientIds },
                  case_id: { in: assignmentScope.caseIds },
                },
              ]
            : []),
        ];

  const upcomingPatientIds = Array.from(
    new Set(upcomingSchedules.map((schedule) => schedule.case_.patient.id)),
  );
  const upcomingCaseIds = Array.from(
    new Set(upcomingSchedules.map((schedule) => schedule.case_id)),
  );

  const [
    linkedInquiryRequests,
    latestCyclesForIssues,
    activeVisitConsents,
    activeManagementPlans,
    missingFirstVisitDocCount,
    missingEmergencyContactCount,
    missingPrimaryPhysicianCount,
  ] = await Promise.all([
    inquiryIds.length === 0
      ? []
      : prisma.communicationRequest.findMany({
          where: {
            org_id: orgId,
            related_entity_type: 'inquiry_record',
            related_entity_id: { in: inquiryIds },
          },
          orderBy: [{ requested_at: 'desc' }],
          select: {
            id: true,
            related_entity_id: true,
            status: true,
            due_date: true,
            requested_at: true,
          },
        }),
    latestCycleScopes.length === 0
      ? []
      : prisma.medicationCycle.findMany({
          where: {
            org_id: orgId,
            OR: latestCycleScopes,
          },
          orderBy: [{ updated_at: 'desc' }],
          select: {
            id: true,
            case_id: true,
            patient_id: true,
            prescription_intakes: {
              orderBy: [{ prescribed_date: 'desc' }],
              take: 1,
              select: {
                prescriber_name: true,
              },
            },
          },
        }),
    upcomingPatientIds.length === 0
      ? []
      : prisma.consentRecord.findMany({
          where: {
            org_id: orgId,
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
            org_id: orgId,
            case_id: { in: upcomingCaseIds },
            status: 'approved',
            approved_at: { not: null },
            OR: [{ next_review_date: null }, { next_review_date: { gte: today } }],
          },
          select: { case_id: true },
        }),
    upcomingCaseIds.length === 0
      ? 0
      : prisma.firstVisitDocument
          .count({
            where: {
              org_id: orgId,
              case_id: { in: upcomingCaseIds },
              delivered_at: { not: null },
            },
          })
          .then((deliveredCount) => Math.max(0, upcomingCaseIds.length - deliveredCount)),
    upcomingPatientIds.length === 0
      ? 0
      : prisma.patient.count({
          where: {
            org_id: orgId,
            id: { in: upcomingPatientIds },
            contacts: {
              none: { is_emergency_contact: true },
            },
          },
        }),
    upcomingCaseIds.length === 0
      ? 0
      : prisma.careCase.count({
          where: {
            org_id: orgId,
            id: { in: upcomingCaseIds },
            care_team_links: {
              none: { role: 'physician' },
            },
          },
        }),
  ]);

  const selfReportPatientIds = Array.from(
    new Set([
      ...triageSelfReports.map((report) => report.patient_id),
      ...unresolvedInquiryRecords.map((item) => item.cycle.patient_id),
      ...openMedicationIssues.map((item) => item.patient_id),
    ]),
  );
  const userIds = Array.from(
    new Set(
      [
        ...pendingTasks.map((task) => task.assigned_to),
        ...upcomingSchedules.map((schedule) => schedule.pharmacist_id),
        ...pendingProposals.map((proposal) => proposal.proposed_pharmacist_id),
        ...candidateIntakes.map((intake) => intake.cycle?.case_.primary_pharmacist_id ?? null),
      ].filter((value): value is string => Boolean(value)),
    ),
  );

  const [patientsForReports, users] = await Promise.all([
    selfReportPatientIds.length === 0
      ? []
      : prisma.patient.findMany({
          where: {
            org_id: orgId,
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
            org_id: orgId,
            id: { in: userIds },
          },
          select: {
            id: true,
            name: true,
          },
        }),
  ]);

  return {
    linkedInquiryRequests,
    latestCyclesForIssues,
    activeVisitConsents,
    activeManagementPlans,
    missingFirstVisitDocCount,
    missingEmergencyContactCount,
    missingPrimaryPhysicianCount,
    patientsForReports,
    users,
  };
}
