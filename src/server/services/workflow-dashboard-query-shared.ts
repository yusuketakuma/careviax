import { Prisma, type PrismaClient } from '@prisma/client';
import { listCommunicationQueue } from '@/server/services/communication-queue';
import { listPatientRiskSummaries } from '@/server/services/patient-risk';
import { getHomeCareFeatureSummary } from '@/server/services/home-care-ops';
import { type DashboardAssignmentScope } from './dashboard-assignment-scope';

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

export function buildCaseScope(caseIds: string[] | undefined) {
  return caseIds === undefined ? {} : { case_id: { in: caseIds } };
}

export function buildPatientScope(patientIds: string[] | undefined) {
  return patientIds === undefined ? {} : { patient_id: { in: patientIds } };
}

export function buildCareCaseScope(caseIds: string[] | undefined) {
  return caseIds === undefined ? {} : { id: { in: caseIds } };
}

export function buildNullableCaseBackedScope(args: { caseIds?: string[]; patientIds?: string[] }) {
  if (args.caseIds === undefined && args.patientIds === undefined) return {};

  const scopes = [
    ...(args.caseIds && args.caseIds.length > 0 ? [{ case_id: { in: args.caseIds } }] : []),
    ...(args.patientIds && args.patientIds.length > 0
      ? [{ case_id: null, patient_id: { in: args.patientIds } }]
      : []),
  ];

  return scopes.length > 0 ? { OR: scopes } : { id: { in: [] } };
}

export function buildCycleRelationScope(args: { caseIds?: string[]; patientIds?: string[] }) {
  if (args.caseIds === undefined) return {};
  return args.caseIds.length > 0
    ? { cycle: { case_id: { in: args.caseIds } } }
    : { id: { in: [] } };
}

export function buildReportRelationScope(args: { caseIds?: string[]; patientIds?: string[] }) {
  if (args.caseIds === undefined && args.patientIds === undefined) return {};

  const scopes = [
    ...(args.caseIds && args.caseIds.length > 0 ? [{ case_id: { in: args.caseIds } }] : []),
    ...(args.patientIds && args.patientIds.length > 0
      ? [{ case_id: null, patient_id: { in: args.patientIds } }]
      : []),
  ];

  return scopes.length > 0 ? { report: { OR: scopes } } : { id: { in: [] } };
}

export function isDashboardAssignmentScoped(scope: DashboardAssignmentScope) {
  return scope.caseIds !== undefined || scope.patientIds !== undefined;
}

export const EMPTY_SCOPED_HOME_CARE_FEATURE_SUMMARY = {
  totals: { blocked: 0, attention: 0, monitoring: 0, ready: 0 },
  features: [],
} satisfies Awaited<ReturnType<typeof getHomeCareFeatureSummary>>;

export const EMPTY_COMMUNICATION_QUEUE = {
  summary: {
    pending_count: 0,
    overdue_count: 0,
    self_reports: 0,
    callback_followups: 0,
    inbound_communications: 0,
    open_requests: 0,
    delivery_backlog: 0,
    expiring_external_shares: 0,
    unconfirmed_count: 0,
    reply_waiting_count: 0,
    failed_count: 0,
  },
  items: [],
  timeline: [],
  emergency_drafts: [],
} satisfies Awaited<ReturnType<typeof listCommunicationQueue>>;

export function emptyWorkflowCoreData(overrides: Partial<WorkflowCoreData> = {}): WorkflowCoreData {
  return {
    cycleCounts: [],
    exceptionCount: 0,
    openWorkflowExceptions: [],
    pendingRequests: 0,
    overdueRequests: 0,
    taskBuckets: [],
    pendingTasks: [],
    overdueVisits: 0,
    awaitingReports: 0,
    upcomingSchedules: [],
    recentSchedules: [],
    pendingProposals: [],
    deliveryFailures: 0,
    candidateIntakes: [],
    unresolvedInquiryRecords: [],
    openMedicationIssues: [],
    triageSelfReports: [],
    communityFollowups: [],
    intakeCasesAwaitingStart: 0,
    upcomingEmergencyShifts: [],
    upcomingHolidays: [],
    communicationQueue: EMPTY_COMMUNICATION_QUEUE,
    patientRiskQueue: [],
    billingReviewTasks: 0,
    conferencePendingTasks: 0,
    conferenceUndeliveredReports: 0,
    homeCareFeatureSummary: EMPTY_SCOPED_HOME_CARE_FEATURE_SUMMARY,
    ...overrides,
  };
}

export async function countConferenceUndeliveredReports(
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
