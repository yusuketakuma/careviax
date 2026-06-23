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
import {
  type PatientDetailTaskFailure,
  runPatientDetailTasks,
  runPatientDetailTasksSettled,
} from '@/server/services/patient-detail-tasks';
import {
  buildOperationHistoryEvents,
  buildTimelineHrefBundle,
  latestFirstVisitDocumentActionByDocumentId,
} from '@/server/services/patient-detail-timeline-events';
import {
  TIMELINE_SOURCES,
  type TimelineFallbacks,
  type TimelineFetchCtx,
  type TimelineProjectCtx,
  type TimelineTasks,
} from '@/server/services/patient-detail-timeline-registry';
import { buildPatientTimelineOperationHistoryFilters } from '@/server/services/patient-detail-timeline-query';
import {
  buildAssignedCareCaseWhere,
  buildPatientDetailWhere,
  buildVisitRecordCaseScope,
  type PatientDetailScopeArgs,
} from '@/server/services/patient-detail-scope';

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

const PATIENT_TIMELINE_QUERY_CONCURRENCY = 8;

type PatientTimelinePartialFailure = {
  source: string;
  message: string;
};

function describePatientTimelineTaskError(error: unknown) {
  if (error instanceof Error) {
    return error.name;
  }
  return 'Unknown error';
}

function logPatientTimelineTaskFailure(orgId: string, failure: PatientDetailTaskFailure) {
  console.error('[patient-timeline] source query failed', {
    orgId,
    source: failure.key,
    error: describePatientTimelineTaskError(failure.error),
  });
}

function toPatientTimelinePartialFailure(
  failure: PatientDetailTaskFailure,
): PatientTimelinePartialFailure {
  return {
    source: failure.key,
    message: '一部のタイムライン情報を取得できませんでした',
  };
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

  const fetchCtx: TimelineFetchCtx = {
    db,
    orgId: args.orgId,
    patientId: args.patientId,
    caseIds,
    canManageBilling,
    billingRefs,
  };
  const timelineTasks = Object.fromEntries(
    TIMELINE_SOURCES.map((source) => [source.key, () => source.fetch(fetchCtx)]),
  ) as TimelineTasks;
  const timelineFallbacks = Object.fromEntries(
    TIMELINE_SOURCES.map((source) => [source.key, source.emptyFallback]),
  ) as TimelineFallbacks;

  const { results: timelineSources, failures: sourceFailures } = await runPatientDetailTasksSettled(
    timelineTasks,
    timelineFallbacks,
    {
      concurrency: PATIENT_TIMELINE_QUERY_CONCURRENCY,
      onTaskError: (failure) => logPatientTimelineTaskFailure(args.orgId, failure),
    },
  );

  const {
    selfReports,
    prescriptionIntakes,
    firstVisitDocuments,
    conferenceNotes,
    billingCandidates,
  } = timelineSources;
  const partialFailures = [...sourceFailures]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(toPatientTimelinePartialFailure);

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

  const sourceActorNameMapPromise = batchResolveNames(
    db,
    args.orgId,
    Array.from(
      new Set(
        compactPreviewValues(
          TIMELINE_SOURCES.flatMap((source) =>
            source.collectActorIds
              ? (timelineSources[source.key] as readonly unknown[]).flatMap((row) =>
                  source.collectActorIds!(row as never),
                )
              : [],
          ),
        ),
      ),
    ),
  );

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

  const [sourceActorNameMap, operationActorNameMap] = await Promise.all([
    sourceActorNameMapPromise,
    batchResolveNames(
      db,
      args.orgId,
      Array.from(new Set(compactPreviewValues(operationHistory.map((item) => item.actor_id)))),
    ),
  ]);
  const actorNameMap = new Map([...sourceActorNameMap, ...operationActorNameMap]);

  const projectCtx: TimelineProjectCtx = {
    patientId: args.patientId,
    actorNameMap,
    firstVisitDocumentActions: latestFirstVisitDocumentActionByDocumentId(operationHistory),
    hrefs: buildTimelineHrefBundle(args.patientId),
  };
  const timelineEvents = [
    ...TIMELINE_SOURCES.flatMap((source) =>
      source.toEvents(timelineSources[source.key] as never, projectCtx),
    ),
    ...buildOperationHistoryEvents(operationHistory, projectCtx),
  ]
    .sort(
      (left, right) =>
        right.occurred_at.getTime() - left.occurred_at.getTime() || right.id.localeCompare(left.id),
    )
    .slice(0, 40);

  return {
    timeline_events: timelineEvents,
    self_reports: selfReports,
    ...(partialFailures.length > 0 ? { partial_failures: partialFailures } : {}),
  };
}
