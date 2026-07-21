import type { PrismaClient } from '@prisma/client';
import {
  WORKFLOW_PROPOSAL_LIMIT,
  WORKFLOW_REFILL_LIMIT,
  WORKFLOW_SELF_REPORT_LIMIT,
  WORKFLOW_TASK_LIMIT,
  WORKFLOW_UPCOMING_SCHEDULE_LIMIT,
} from '@/lib/constants/workflow';
import {
  buildDashboardTaskAssignmentWhere,
  type DashboardAssignmentScope,
} from './dashboard-assignment-scope';

import {
  buildCaseScope,
  buildCycleRelationScope,
  buildPatientScope,
  emptyWorkflowCoreData,
  type WorkflowCoreData,
} from './workflow-dashboard-query-shared';
export { type WorkflowCoreData } from './workflow-dashboard-query-shared';
export { fetchWorkflowCoreData } from './workflow-dashboard-query-core';

export async function fetchWorkflowPhaseCoreData(
  prisma: PrismaClient,
  orgId: string,
  today: Date,
  upcomingWindow: Date,
  sevenDaysFromNow: Date,
  assignmentScope: DashboardAssignmentScope = {},
): Promise<WorkflowCoreData> {
  const [
    cycleCounts,
    taskBuckets,
    pendingTasks,
    overdueVisits,
    awaitingReports,
    upcomingSchedules,
    pendingProposals,
    candidateIntakes,
    triageSelfReports,
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
  ]);

  return emptyWorkflowCoreData({
    cycleCounts,
    taskBuckets,
    pendingTasks,
    overdueVisits,
    awaitingReports,
    upcomingSchedules,
    pendingProposals,
    candidateIntakes,
    triageSelfReports,
  });
}

export async function fetchWorkflowRealtimeCoreData(
  prisma: PrismaClient,
  orgId: string,
  today: Date,
  upcomingWindow: Date,
  sevenDaysFromNow: Date,
  assignmentScope: DashboardAssignmentScope = {},
): Promise<WorkflowCoreData> {
  const [core, exceptionCount] = await Promise.all([
    fetchWorkflowPhaseCoreData(
      prisma,
      orgId,
      today,
      upcomingWindow,
      sevenDaysFromNow,
      assignmentScope,
    ),
    prisma.workflowException.count({
      where: {
        org_id: orgId,
        ...buildCycleRelationScope(assignmentScope),
        status: 'open',
      },
    }),
  ]);

  return {
    ...core,
    exceptionCount,
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

export async function fetchWorkflowPhaseDependentData(
  prisma: PrismaClient,
  orgId: string,
  coreData: WorkflowCoreData,
): Promise<WorkflowDependentData> {
  const patientIds = Array.from(
    new Set(coreData.triageSelfReports.map((report) => report.patient_id)),
  );
  const userIds = Array.from(
    new Set(
      [
        ...coreData.pendingTasks.map((task) => task.assigned_to),
        ...coreData.upcomingSchedules.map((schedule) => schedule.pharmacist_id),
        ...coreData.pendingProposals.map((proposal) => proposal.proposed_pharmacist_id),
        ...coreData.candidateIntakes.map(
          (intake) => intake.cycle?.case_.primary_pharmacist_id ?? null,
        ),
      ].filter((value): value is string => Boolean(value)),
    ),
  );

  const [patientsForReports, users] = await Promise.all([
    patientIds.length === 0
      ? []
      : prisma.patient.findMany({
          where: {
            org_id: orgId,
            id: { in: patientIds },
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
    linkedInquiryRequests: [],
    latestCyclesForIssues: [],
    activeVisitConsents: coreData.upcomingSchedules.map((schedule) => ({
      patient_id: schedule.case_.patient.id,
    })),
    activeManagementPlans: coreData.upcomingSchedules.map((schedule) => ({
      case_id: schedule.case_id,
    })),
    missingFirstVisitDocCount: 0,
    missingEmergencyContactCount: 0,
    missingPrimaryPhysicianCount: 0,
    patientsForReports,
    users,
  };
}
