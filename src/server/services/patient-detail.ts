import type { Prisma } from '@prisma/client';
import { hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';
import type { ScopedTxRunner } from '@/lib/db/rls';
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

type DetailArgs = PatientDetailScopeArgs;

export type PatientHeaderSummary = {
  primary_pharmacist_name: string | null;
  first_visit_date: string | null;
  last_prescribed_date: string | null;
  next_prescription_expected_date: string | null;
};

/**
 * Row shape of the inline op_history `auditLog.findMany` projection. Declared so
 * the fail-soft `operationHistory` binding has a stable type across the empty
 * (degraded) and populated branches and stays assignable to the timeline
 * projection consumers.
 */
type PatientTimelineOperationHistoryRow = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  actor_id: string;
  changes: Prisma.JsonValue;
  created_at: Date;
};

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

export async function getPatientHeaderSummary(
  db: DbClient,
  args: DetailArgs,
): Promise<PatientHeaderSummary | null> {
  const assignedCaseWhere = buildAssignedCareCaseWhere(args);
  const patient = await db.patient.findFirst({
    where: buildPatientDetailWhere(args),
    select: {
      cases: {
        ...(assignedCaseWhere ? { where: assignedCaseWhere } : {}),
        orderBy: { updated_at: 'desc' },
        select: {
          id: true,
          primary_pharmacist_id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const primaryPharmacistId = patient.cases[0]?.primary_pharmacist_id ?? null;

  const [primaryPharmacistNameMap, firstVisit, lastPrescription] = await Promise.all([
    primaryPharmacistId
      ? batchResolveNames(db as typeof prisma, args.orgId, [primaryPharmacistId])
      : Promise.resolve(new Map<string, string>()),
    caseIds.length === 0
      ? Promise.resolve(null)
      : db.visitRecord.findFirst({
          where: {
            org_id: args.orgId,
            patient_id: args.patientId,
            ...buildVisitRecordCaseScope(caseIds),
          },
          orderBy: [{ visit_date: 'asc' }, { created_at: 'asc' }],
          select: { visit_date: true },
        }),
    caseIds.length === 0
      ? Promise.resolve(null)
      : db.prescriptionIntake.findFirst({
          where: {
            org_id: args.orgId,
            cycle: {
              patient_id: args.patientId,
              case_id: { in: caseIds },
            },
          },
          orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
          select: { prescribed_date: true },
        }),
  ]);

  return {
    primary_pharmacist_name: primaryPharmacistId
      ? (primaryPharmacistNameMap.get(primaryPharmacistId) ?? null)
      : null,
    first_visit_date: firstVisit?.visit_date.toISOString() ?? null,
    last_prescribed_date: lastPrescription?.prescribed_date.toISOString() ?? null,
    next_prescription_expected_date: null,
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

export async function getPatientTimelineData(runScoped: ScopedTxRunner, args: DetailArgs) {
  const patient = await runScoped((tx) =>
    tx.patient.findFirst({
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
    }),
  );
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const canManageBilling = hasPermission(args.role, 'canManageBilling');
  const billingRefs = canManageBilling
    ? await runScoped((tx) => listPatientBillingCaseRefs(tx, args, caseIds))
    : { visitRecordIds: [] as string[], cycleIds: [] as string[] };

  // The per-source fetch ctx minus `db`: each settled task supplies its own
  // RLS-scoped `tx` as `db`, so a slow source trips only its own short tx budget.
  const baseFetchCtx: Omit<TimelineFetchCtx, 'db'> = {
    orgId: args.orgId,
    patientId: args.patientId,
    caseIds,
    canManageBilling,
    billingRefs,
  };
  // Each settled task wraps its source fetch in its own RLS-scoped short tx,
  // handing the per-source `tx` in as `ctx.db`. The fetch return is the source
  // union; the trailing `as TimelineTasks` re-keys it (as the pre-Cycle-C code
  // did) once the per-source `tx` plumbing is applied.
  const timelineTasks = Object.fromEntries(
    TIMELINE_SOURCES.map((source) => {
      // `source` is the adapter union; widen its fetch to a uniform signature so
      // the generic runScoped infers a single `readonly unknown[]` instead of
      // collapsing onto the first union member's row type.
      const fetchScoped = (ctx: TimelineFetchCtx): Promise<readonly unknown[]> => source.fetch(ctx);
      return [source.key, () => runScoped((tx) => fetchScoped({ ...baseFetchCtx, db: tx }))];
    }),
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

  // source-actor name resolution is fail-soft (codex condition, option 1):
  // a name-lookup reject must NOT 500 the whole panel — events still render with
  // actor_name:null and the failure is surfaced as partial_failures 'actor_names'.
  const sourceActorIds = Array.from(
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
  );
  const sourceActorNameMapPromise = runScoped((tx) =>
    batchResolveNames(tx, args.orgId, sourceActorIds),
  ).catch((error) => {
    logPatientTimelineTaskFailure(args.orgId, { key: 'actor_names', error });
    partialFailures.push(toPatientTimelinePartialFailure({ key: 'actor_names', error }));
    return new Map<string, string>();
  });

  // op_history is the 14th (inline) source. FAIL-SOFT, not unguarded-throw: a
  // timeout/deep-page failure on this audit-log read degrades the panel visibly
  // (operationHistory=[] + partial_failures source 'operation_history') instead
  // of 500-ing. Downstream consumers (batchResolveNames / firstVisitDocumentActions
  // / buildOperationHistoryEvents) all no-op safely on [].
  let operationHistory: PatientTimelineOperationHistoryRow[] = [];
  try {
    operationHistory = await runScoped((tx) =>
      tx.auditLog.findMany({
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
      }),
    );
  } catch (error) {
    logPatientTimelineTaskFailure(args.orgId, { key: 'operation_history', error });
    operationHistory = [];
    partialFailures.push(toPatientTimelinePartialFailure({ key: 'operation_history', error }));
  }

  // operation-history-actor name resolution is fail-soft with a DISTINCT source
  // key ('operation_actor_names') so a failure here is attributable separately.
  const operationActorIds = Array.from(
    new Set(compactPreviewValues(operationHistory.map((item) => item.actor_id))),
  );
  const operationActorNameMapPromise = runScoped((tx) =>
    batchResolveNames(tx, args.orgId, operationActorIds),
  ).catch((error) => {
    logPatientTimelineTaskFailure(args.orgId, { key: 'operation_actor_names', error });
    partialFailures.push(toPatientTimelinePartialFailure({ key: 'operation_actor_names', error }));
    return new Map<string, string>();
  });

  const [sourceActorNameMap, operationActorNameMap] = await Promise.all([
    sourceActorNameMapPromise,
    operationActorNameMapPromise,
  ]);
  const actorNameMap = new Map([...sourceActorNameMap, ...operationActorNameMap]);
  // Re-sort: fail-soft pushes above append out of order; keep partial_failures stable.
  partialFailures.sort((left, right) => left.source.localeCompare(right.source));

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
