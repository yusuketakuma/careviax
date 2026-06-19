import type { Prisma } from '@prisma/client';
import { hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';
import {
  getPatientPrivacyFlags,
  maskAddressDetail,
  maskInsuranceNumber,
  maskPhoneNumber,
} from '@/lib/patient/privacy';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import { findPatientOverviewBase } from '@/server/services/patient-state-snapshot';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { getPatientRiskSummary } from '@/server/services/patient-risk';
import { getPatientVisitBrief } from '@/server/services/visit-brief';
import { getPatientHomeCareFeatureSummary } from '@/server/services/home-care-ops';
import { compactPreviewValues } from '@/server/services/patient-detail-helpers';
import { buildPatientWorkspace } from '@/server/services/patient-detail-workspace';
import {
  buildPatientFoundationData,
  type PatientFoundationData,
} from '@/server/services/patient-detail-foundation';
import { listPatientBillingCaseRefs } from '@/server/services/patient-detail-billing-refs';
import { listPatientLabSummary } from '@/server/services/patient-detail-labs';
import { runPatientDetailTasks } from '@/server/services/patient-detail-tasks';
import { buildPatientTimelineEvents } from '@/server/services/patient-detail-timeline-events';
import {
  buildPatientTimelineConferenceNoteWhere,
  buildPatientTimelineOperationHistoryFilters,
} from '@/server/services/patient-detail-timeline-query';
import {
  buildAssignedCareCaseWhere,
  buildCareReportCaseScope,
  buildNullableCaseScope,
  buildPatientDetailWhere,
  buildVisitRecordCaseScope,
  type PatientDetailScopeArgs,
} from '@/server/services/patient-detail-scope';
import { buildVisibleExternalAccessGrantWhere } from '@/server/services/external-access';

export { runPatientDetailTasks } from '@/server/services/patient-detail-tasks';
export { getPatientCommunicationsData } from '@/server/services/patient-detail-communications';
export { getPatientDocumentsData } from '@/server/services/patient-detail-documents';
export { getPatientHomeOperationsData } from '@/server/services/patient-home-operations';
export { getPatientReadinessData } from '@/server/services/patient-detail-readiness';
export { getPatientWorkflowPreviewData } from '@/server/services/patient-detail-workflow-preview';

type DbClient = typeof prisma | Prisma.TransactionClient;

type JahisSupplementalRecordProjection = {
  id: string;
  record_type: string;
  record_label: string | null;
  line_number: number;
  summary: string | null;
  payload?: unknown;
  raw_line?: string | null;
};

function maskJahisSupplementalRecords(
  records: JahisSupplementalRecordProjection[],
  options: { sensitiveFieldsMasked: boolean },
) {
  if (!options.sensitiveFieldsMasked) return records;
  return records.map((record) => {
    const { payload, raw_line: rawLine, ...safeRecord } = record;
    void payload;
    void rawLine;
    return safeRecord;
  });
}

function maskFoundationForExternalViewer(foundation: PatientFoundationData): PatientFoundationData {
  return {
    ...foundation,
    items: foundation.items.map((item) => ({
      ...item,
      meta: item.meta
        ? {
            ...item.meta,
            updated_by_name: null,
            confirmed_by_name: null,
          }
        : item.meta,
    })),
    changes_since_last_visit: foundation.changes_since_last_visit.map((item) => ({
      ...item,
      updated_by_name: null,
    })),
  };
}

type PatientTimelineDb = {
  auditLog: Pick<Prisma.TransactionClient['auditLog'], 'findMany'>;
  billingCandidate: Pick<Prisma.TransactionClient['billingCandidate'], 'findMany'>;
  careReport: Pick<Prisma.TransactionClient['careReport'], 'findMany'>;
  communicationEvent: Pick<Prisma.TransactionClient['communicationEvent'], 'findMany'>;
  conferenceNote: Pick<Prisma.TransactionClient['conferenceNote'], 'findMany'>;
  dispenseResult: Pick<Prisma.TransactionClient['dispenseResult'], 'findMany'>;
  externalAccessGrant: Pick<Prisma.TransactionClient['externalAccessGrant'], 'findMany'>;
  firstVisitDocument: Pick<Prisma.TransactionClient['firstVisitDocument'], 'findMany'>;
  inquiryRecord: Pick<Prisma.TransactionClient['inquiryRecord'], 'findMany'>;
  managementPlan: Pick<Prisma.TransactionClient['managementPlan'], 'findMany'>;
  medicationCycle: Pick<Prisma.TransactionClient['medicationCycle'], 'findMany'>;
  patient: Pick<Prisma.TransactionClient['patient'], 'findFirst'>;
  patientSelfReport: Pick<Prisma.TransactionClient['patientSelfReport'], 'findMany'>;
  prescriptionIntake: Pick<Prisma.TransactionClient['prescriptionIntake'], 'findMany'>;
  user: Pick<Prisma.TransactionClient['user'], 'findMany'>;
  visitRecord: Pick<Prisma.TransactionClient['visitRecord'], 'findMany'>;
  visitSchedule: Pick<Prisma.TransactionClient['visitSchedule'], 'findMany'>;
};

type DetailArgs = PatientDetailScopeArgs;

const PATIENT_TIMELINE_EXTERNAL_SHARE_LIMIT = 8;

async function listVisibleTimelineExternalShares(
  db: PatientTimelineDb,
  args: DetailArgs,
  caseIds: string[],
) {
  return db.externalAccessGrant.findMany({
    where: buildVisibleExternalAccessGrantWhere({
      orgId: args.orgId,
      patientId: args.patientId,
      caseIds,
    }),
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: PATIENT_TIMELINE_EXTERNAL_SHARE_LIMIT,
    select: {
      id: true,
      granted_to_name: true,
      expires_at: true,
      accessed_at: true,
      created_at: true,
    },
  });
}

export async function getPatientOverview(db: DbClient, args: DetailArgs) {
  const patient = await findPatientOverviewBase(db, args);
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const {
    visitSchedules,
    openTasksCount,
    riskSummary,
    visitBrief,
    labSummary,
    jahisSupplementalRecords,
    archivedByNameMap,
    workspace,
  } = await runPatientDetailTasks({
    visitSchedules: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.visitSchedule.findMany({
            where: {
              org_id: args.orgId,
              case_id: { in: caseIds },
            },
            orderBy: [{ scheduled_date: 'desc' }, { time_window_start: 'desc' }],
            take: 8,
            select: {
              id: true,
              scheduled_date: true,
              schedule_status: true,
              time_window_start: true,
              confirmed_at: true,
              visit_record: {
                select: {
                  id: true,
                  outcome_status: true,
                },
              },
            },
          }),
    openTasksCount: () =>
      db.task.count({
        where: {
          org_id: args.orgId,
          status: {
            in: ['pending', 'in_progress'],
          },
          OR: [
            {
              related_entity_type: 'patient',
              related_entity_id: args.patientId,
            },
            ...(caseIds.length > 0
              ? [
                  {
                    related_entity_type: 'case',
                    related_entity_id: {
                      in: caseIds,
                    },
                  },
                ]
              : []),
          ],
        },
      }),
    riskSummary: () =>
      getPatientRiskSummary(db, {
        orgId: args.orgId,
        patientId: args.patientId,
        caseIds,
      }),
    visitBrief: () =>
      getPatientVisitBrief(db, {
        orgId: args.orgId,
        patientId: args.patientId,
        context: 'patient',
        caseIds,
        role: args.role,
        userId: args.userId,
      }),
    labSummary: () => listPatientLabSummary(db, args),
    jahisSupplementalRecords: () =>
      db.jahisSupplementalRecord.findMany({
        where: {
          org_id: args.orgId,
          patient_id: args.patientId,
        },
        orderBy: [{ created_at: 'desc' }, { line_number: 'asc' }],
        take: 8,
        select: {
          id: true,
          record_type: true,
          record_label: true,
          line_number: true,
          summary: true,
          payload: true,
          raw_line: true,
        },
      }),
    archivedByNameMap: () =>
      batchResolveNames(
        db as typeof prisma,
        args.orgId,
        patient.archived_by ? [patient.archived_by] : [],
      ),
    workspace: () =>
      buildPatientWorkspace(db, {
        orgId: args.orgId,
        patientId: args.patientId,
        caseIds,
        allergyInfo: patient.allergy_info,
        conditions: patient.conditions,
        swallowingRoute: patient.scheduling_preference?.swallowing_route ?? null,
      }),
  });
  const archivedByName = patient.archived_by
    ? (archivedByNameMap.get(patient.archived_by) ?? null)
    : null;
  const foundation = await buildPatientFoundationData(db, {
    orgId: args.orgId,
    patientId: args.patientId,
    role: args.role,
    userId: args.userId,
    patient: {
      id: patient.id,
      archived_at: patient.archived_at,
      archived_by_name: archivedByName,
      contacts: patient.contacts,
      cases: patient.cases,
      scheduling_preference: patient.scheduling_preference,
    },
    labSummary,
    riskSummary,
  });

  const privacy = getPatientPrivacyFlags(args.role);
  const visibleFoundation = privacy.canViewDetail
    ? foundation
    : maskFoundationForExternalViewer(foundation);

  return {
    ...patient,
    archived_by_name: archivedByName,
    phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(patient.phone) : patient.phone,
    medical_insurance_number: privacy.sensitiveFieldsMasked
      ? maskInsuranceNumber(patient.medical_insurance_number)
      : patient.medical_insurance_number,
    care_insurance_number: privacy.sensitiveFieldsMasked
      ? maskInsuranceNumber(patient.care_insurance_number)
      : patient.care_insurance_number,
    residences: patient.residences.map((residence) => ({
      ...residence,
      address: privacy.addressFieldsMasked
        ? maskAddressDetail(residence.address)
        : residence.address,
    })),
    conditions: patient.conditions,
    cases: patient.cases,
    visit_schedules: visitSchedules,
    summary_metrics: {
      open_tasks_count: openTasksCount,
    },
    risk_summary: riskSummary,
    visit_brief: visitBrief,
    lab_summary: labSummary,
    foundation: visibleFoundation,
    jahis_supplemental_records: maskJahisSupplementalRecords(jahisSupplementalRecords, {
      sensitiveFieldsMasked: privacy.sensitiveFieldsMasked,
    }),
    workspace,
    privacy: {
      sensitive_fields_masked: privacy.sensitiveFieldsMasked,
      address_fields_masked: privacy.addressFieldsMasked,
      can_view_detail: privacy.canViewDetail,
    },
  };
}

export async function getPatientVisitsData(db: DbClient, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: buildPatientDetailWhere(args),
    select: {
      id: true,
      cases: {
        ...(buildAssignedCareCaseWhere(args) ? { where: buildAssignedCareCaseWhere(args) } : {}),
        select: {
          id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  // scheduled_date(@db.Date)比較用: ローカル今月の月初/翌月初を UTC 深夜で表す
  const [currentYear, currentMonth] = localDateKey().split('-').map(Number);
  const currentMonthStart = utcDateFromLocalKey(
    `${currentYear}-${`${currentMonth}`.padStart(2, '0')}-01`,
  );
  const nextMonthStart = new Date(Date.UTC(currentYear, currentMonth, 1));

  const [visitSchedules, currentMonthVisitCount, visitRecords, homeCareFeatureSummary] =
    await Promise.all([
      caseIds.length === 0
        ? Promise.resolve([])
        : db.visitSchedule.findMany({
            where: {
              org_id: args.orgId,
              case_id: { in: caseIds },
            },
            orderBy: [{ scheduled_date: 'desc' }, { time_window_start: 'desc' }],
            take: 12,
            select: {
              id: true,
              scheduled_date: true,
              schedule_status: true,
              priority: true,
              confirmed_at: true,
              route_order: true,
              visit_record: {
                select: {
                  id: true,
                  outcome_status: true,
                },
              },
            },
          }),
      caseIds.length === 0
        ? Promise.resolve(0)
        : db.visitSchedule.count({
            where: {
              org_id: args.orgId,
              case_id: { in: caseIds },
              scheduled_date: {
                gte: currentMonthStart,
                lt: nextMonthStart,
              },
            },
          }),
      caseIds.length === 0
        ? Promise.resolve([])
        : db.visitRecord.findMany({
            where: {
              org_id: args.orgId,
              patient_id: args.patientId,
              ...buildVisitRecordCaseScope(caseIds),
            },
            orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
            take: 12,
            select: {
              id: true,
              schedule_id: true,
              visit_date: true,
              outcome_status: true,
              next_visit_suggestion_date: true,
              cancellation_reason: true,
              postpone_reason: true,
              revisit_reason: true,
              created_at: true,
            },
          }),
      getPatientHomeCareFeatureSummary(db, {
        orgId: args.orgId,
        patientId: args.patientId,
      }),
    ]);

  return {
    monthly_visit_count: currentMonthVisitCount,
    visit_schedules: visitSchedules,
    visit_records: visitRecords,
    home_care_feature_summary: homeCareFeatureSummary,
  };
}

export async function getPatientTimelineData(db: PatientTimelineDb, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: buildPatientDetailWhere(args),
    select: {
      id: true,
      cases: {
        ...(buildAssignedCareCaseWhere(args) ? { where: buildAssignedCareCaseWhere(args) } : {}),
        select: {
          id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const canManageBilling = hasPermission(args.role, 'canManageBilling');
  const billingRefs = canManageBilling
    ? await listPatientBillingCaseRefs(db, args, caseIds)
    : { visitRecordIds: [] as string[], cycleIds: [] as string[] };

  const {
    visitSchedules,
    visitRecords,
    careReports,
    communicationEvents,
    selfReports,
    externalShares,
    inquiryRecords,
    prescriptionIntakes,
    dispenseResults,
    managementPlans,
    firstVisitDocuments,
    conferenceNotes,
    billingCandidates,
  } = await runPatientDetailTasks({
    visitSchedules: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.visitSchedule.findMany({
            where: {
              org_id: args.orgId,
              case_id: { in: caseIds },
            },
            orderBy: [{ scheduled_date: 'desc' }, { time_window_start: 'desc' }],
            take: 12,
            select: {
              id: true,
              visit_type: true,
              scheduled_date: true,
              schedule_status: true,
              priority: true,
              pharmacist_id: true,
              confirmed_at: true,
              route_order: true,
              created_at: true,
              updated_at: true,
              visit_record: {
                select: {
                  id: true,
                  outcome_status: true,
                },
              },
            },
          }),
    visitRecords: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.visitRecord.findMany({
            where: {
              org_id: args.orgId,
              patient_id: args.patientId,
              ...buildVisitRecordCaseScope(caseIds),
            },
            orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
            take: 12,
            select: {
              id: true,
              schedule_id: true,
              pharmacist_id: true,
              visit_date: true,
              outcome_status: true,
              next_visit_suggestion_date: true,
              cancellation_reason: true,
              postpone_reason: true,
              revisit_reason: true,
              created_at: true,
            },
          }),
    careReports: () =>
      db.careReport.findMany({
        where: {
          org_id: args.orgId,
          patient_id: args.patientId,
          ...buildCareReportCaseScope(caseIds),
        },
        orderBy: [{ created_at: 'desc' }],
        take: 8,
        select: {
          id: true,
          report_type: true,
          status: true,
          created_by: true,
          created_at: true,
          delivery_records: {
            orderBy: [{ created_at: 'desc' }],
            take: 4,
            select: {
              id: true,
              channel: true,
              recipient_name: true,
              status: true,
              sent_at: true,
              confirmed_at: true,
              created_at: true,
            },
          },
        },
      }),
    communicationEvents: () =>
      db.communicationEvent.findMany({
        where: {
          org_id: args.orgId,
          patient_id: args.patientId,
          event_type: { not: 'patient_self_report' },
          ...buildNullableCaseScope(caseIds),
        },
        orderBy: [{ occurred_at: 'desc' }],
        take: 8,
        select: {
          id: true,
          event_type: true,
          channel: true,
          direction: true,
          subject: true,
          counterpart_name: true,
          occurred_at: true,
        },
      }),
    selfReports: () =>
      db.patientSelfReport.findMany({
        where: {
          org_id: args.orgId,
          patient_id: args.patientId,
        },
        orderBy: [{ created_at: 'desc' }],
        take: 8,
        select: {
          id: true,
          subject: true,
          category: true,
          content: true,
          relation: true,
          status: true,
          reported_by_name: true,
          requested_callback: true,
          preferred_contact_time: true,
          created_at: true,
        },
      }),
    externalShares: () => listVisibleTimelineExternalShares(db, args, caseIds),
    inquiryRecords: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.inquiryRecord.findMany({
            where: {
              org_id: args.orgId,
              cycle: {
                patient_id: args.patientId,
                case_id: { in: caseIds },
              },
            },
            orderBy: [{ resolved_at: 'desc' }, { inquired_at: 'desc' }, { created_at: 'desc' }],
            take: 8,
            select: {
              id: true,
              reason: true,
              inquiry_to_physician: true,
              inquiry_content: true,
              result: true,
              proposal_origin: true,
              residual_adjustment: true,
              change_detail: true,
              inquired_at: true,
              resolved_at: true,
              created_at: true,
              line: {
                select: {
                  intake: {
                    select: {
                      id: true,
                    },
                  },
                },
              },
            },
          }),
    prescriptionIntakes: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.prescriptionIntake.findMany({
            where: {
              org_id: args.orgId,
              cycle: {
                patient_id: args.patientId,
                case_id: { in: caseIds },
              },
            },
            orderBy: [{ created_at: 'desc' }],
            take: 10,
            select: {
              id: true,
              source_type: true,
              prescribed_date: true,
              prescriber_name: true,
              prescriber_institution: true,
              original_collected_by: true,
              created_at: true,
              cycle: {
                select: {
                  overall_status: true,
                },
              },
              lines: {
                take: 3,
                select: {
                  id: true,
                },
              },
            },
          }),
    dispenseResults: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.dispenseResult.findMany({
            where: {
              org_id: args.orgId,
              line: {
                intake: {
                  cycle: {
                    patient_id: args.patientId,
                    case_id: { in: caseIds },
                  },
                },
              },
            },
            orderBy: [{ dispensed_at: 'desc' }],
            take: 12,
            select: {
              id: true,
              actual_drug_name: true,
              actual_quantity: true,
              actual_unit: true,
              carry_type: true,
              dispensed_by: true,
              dispensed_at: true,
              task: {
                select: {
                  cycle: {
                    select: {
                      overall_status: true,
                    },
                  },
                },
              },
              line: {
                select: {
                  intake: {
                    select: {
                      id: true,
                    },
                  },
                },
              },
            },
          }),
    managementPlans: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.managementPlan.findMany({
            where: {
              org_id: args.orgId,
              case_id: {
                in: caseIds,
              },
            },
            orderBy: [{ updated_at: 'desc' }],
            take: 6,
            select: {
              id: true,
              status: true,
              title: true,
              effective_from: true,
              next_review_date: true,
              created_by: true,
              approved_by: true,
              approved_at: true,
              reviewed_by: true,
              reviewed_at: true,
              created_at: true,
            },
          }),
    firstVisitDocuments: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.firstVisitDocument.findMany({
            where: {
              org_id: args.orgId,
              patient_id: args.patientId,
              case_id: { in: caseIds },
            },
            orderBy: [{ created_at: 'desc' }],
            select: {
              id: true,
              document_url: true,
              delivered_at: true,
              delivered_to: true,
              created_at: true,
            },
          }),
    conferenceNotes: () =>
      db.conferenceNote.findMany({
        where: {
          ...buildPatientTimelineConferenceNoteWhere({
            orgId: args.orgId,
            patientId: args.patientId,
            caseIds,
          }),
        },
        orderBy: [{ conference_date: 'desc' }],
        take: 8,
        select: {
          id: true,
          note_type: true,
          title: true,
          conference_date: true,
          follow_up_date: true,
          follow_up_completed: true,
          generated_report_id: true,
          action_items: true,
        },
      }),
    billingCandidates: () =>
      canManageBilling
        ? db.billingCandidate.findMany({
            where: {
              org_id: args.orgId,
              patient_id: args.patientId,
              ...(billingRefs.cycleIds.length === 0
                ? { id: { in: [] } }
                : { cycle_id: { in: billingRefs.cycleIds } }),
            },
            orderBy: [{ updated_at: 'desc' }],
            take: 8,
            select: {
              id: true,
              billing_month: true,
              billing_code: true,
              billing_name: true,
              points: true,
              status: true,
              exclusion_reason: true,
              updated_at: true,
            },
          })
        : Promise.resolve([]),
  });

  const prescriptionIntakeIds = prescriptionIntakes.map((item) => item.id);
  const firstVisitDocumentIds = firstVisitDocuments.map((item) => item.id);
  const billingCandidateIds = billingCandidates.map((item) => item.id);
  const conferenceNoteIds = conferenceNotes.map((item) => item.id);
  const operationHistoryFilters = buildPatientTimelineOperationHistoryFilters({
    patientId: args.patientId,
    prescriptionIntakeIds,
    firstVisitDocumentIds,
    billingCandidateIds,
    conferenceNoteIds,
    canManageBilling,
  });

  const operationHistory = await db.auditLog.findMany({
    where: {
      org_id: args.orgId,
      OR: operationHistoryFilters,
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: 20,
    select: {
      id: true,
      action: true,
      target_type: true,
      target_id: true,
      actor_id: true,
      changes: true,
      created_at: true,
    },
  });

  const actorNameMap = await batchResolveNames(
    db,
    args.orgId,
    Array.from(
      new Set(
        compactPreviewValues([
          ...visitSchedules.map((item) => item.pharmacist_id),
          ...visitRecords.map((item) => item.pharmacist_id),
          ...careReports.map((item) => item.created_by),
          ...dispenseResults.map((item) => item.dispensed_by),
          ...managementPlans.flatMap((item) => [
            item.created_by,
            item.approved_by,
            item.reviewed_by,
          ]),
          ...operationHistory.map((item) => item.actor_id),
        ]),
      ),
    ),
  );

  const timelineEvents = buildPatientTimelineEvents({
    patientId: args.patientId,
    actorNameMap,
    visitSchedules,
    visitRecords,
    careReports,
    communicationEvents,
    selfReports,
    externalShares,
    inquiryRecords,
    prescriptionIntakes,
    dispenseResults,
    managementPlans,
    firstVisitDocuments,
    conferenceNotes,
    billingCandidates,
    operationHistory,
  });

  return {
    timeline_events: timelineEvents,
    self_reports: selfReports,
  };
}
