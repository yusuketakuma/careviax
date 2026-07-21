import type { PrismaClient } from '@prisma/client';
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
import {
  EMPTY_SCOPED_HOME_CARE_FEATURE_SUMMARY,
  buildCareCaseScope,
  buildCaseScope,
  buildCycleRelationScope,
  buildNullableCaseBackedScope,
  buildPatientScope,
  buildReportRelationScope,
  countConferenceUndeliveredReports,
  isDashboardAssignmentScoped,
  type WorkflowCoreData,
} from './workflow-dashboard-query-shared';

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
        // due_date は YYYY-MM-DD の日付のみ(UTC 深夜 sentinel)で保存されるため、
        // 実時刻 new Date() ではなく当日 sentinel `today` と比較する(JST 09:00 以降の当日誤検知を防ぐ)。
        due_date: { lt: today },
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
