import type { Prisma } from '@prisma/client';
import { hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';
import type { ScopedTxRunner } from '@/lib/db/rls';
import { careLevelLabels } from '@/lib/patient/home-visit-intake';
import {
  getPatientPrivacyFlags,
  maskAddressDetail,
  maskInsuranceNumber,
  maskPhoneNumber,
} from '@/lib/patient/privacy';
import { selectVisibleSafetyTags, sortPatientSafetyTags } from '@/lib/patient/safety-tags';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import { findPatientOverviewBase } from '@/server/services/patient-state-snapshot';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { logger } from '@/lib/utils/logger';
import { formatRenalSafetyLabel } from '@/lib/patient/renal-safety-label';
import { getPatientRiskSummary } from '@/server/services/patient-risk';
import { getPatientVisitBrief } from '@/server/services/visit-brief';
import { getPatientHomeCareFeatureSummary } from '@/server/services/home-care-ops';
import {
  buildAllergyLabel,
  buildCautionLabels,
  compactPreviewValues,
  sortHandlingTags,
  type WorkspaceConditionInput,
} from '@/server/services/patient-detail-helpers';
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
import { buildPatientMovementTimelineEvents } from '@/server/services/patient-movement-timeline-presenter';
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
const PATIENT_TIMELINE_DEFAULT_LIMIT = 40;
const PATIENT_TIMELINE_MAX_LIMIT = 40;

export type PatientTimelineArgs = PatientDetailScopeArgs & {
  timelineLimit?: number;
};

export type PatientMovementTimelineEventDetailArgs = PatientTimelineArgs & {
  eventId: string;
};

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
  patient_id: string;
  name: string;
  name_kana: string | null;
  birth_date: string;
  gender: string;
  gender_label: string;
  care_level: string | null;
  care_level_label: string | null;
  home_status_label: string | null;
  residence_label: string | null;
  primary_diagnosis: string | null;
  intervention_start_date: string | null;
  primary_pharmacist_name: string | null;
  backup_pharmacist_name: string | null;
  primary_staff_name: string | null;
  backup_staff_name: string | null;
  first_visit_date: string | null;
  last_prescribed_date: string | null;
  next_prescription_expected_date: string | null;
  safety: {
    allergy: string | null;
    renal: string | null;
    handling_tags: string[];
    swallowing: string | null;
    cautions: string[];
    safety_tags: string[];
    visible_safety_tags: string[];
    hidden_safety_tag_count: number;
  };
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

type PatientHeaderConditionInput = WorkspaceConditionInput & {
  is_primary: boolean;
};

function logPatientTimelineTaskFailure(orgId: string, failure: PatientDetailTaskFailure) {
  logger.error(
    {
      event: 'patient_timeline_source_query_failed',
      orgId,
      operation: failure.key,
    },
    failure.error,
  );
}

function toPatientTimelinePartialFailure(
  failure: PatientDetailTaskFailure,
): PatientTimelinePartialFailure {
  return {
    source: failure.key,
    message: '一部のタイムライン情報を取得できませんでした',
  };
}

function formatPatientHeaderGenderLabel(gender: string) {
  if (gender === 'male') return '男性';
  if (gender === 'female') return '女性';
  return 'その他';
}

function formatPatientHeaderResidenceLabel(
  residences: Array<{ facility_id: string | null; unit_name: string | null }>,
) {
  const primaryResidence = residences[0] ?? null;
  if (!primaryResidence) return null;
  const residenceType = primaryResidence.facility_id ? '施設' : '自宅';
  return primaryResidence.unit_name
    ? `${residenceType} / ${primaryResidence.unit_name}`
    : residenceType;
}

function selectPatientHeaderPrimaryDiagnosis(conditions: PatientHeaderConditionInput[]) {
  return (
    conditions.find((condition) => condition.is_primary && condition.is_active)?.name ??
    conditions.find((condition) => condition.is_active)?.name ??
    null
  );
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
    id: patient.id,
    display_id: patient.display_id,
    name: patient.name,
    name_kana: patient.name_kana,
    birth_date: patient.birth_date,
    gender: patient.gender,
    billing_support_flag: patient.billing_support_flag,
    primary_pharmacist_id: patient.primary_pharmacist_id,
    backup_pharmacist_id: patient.backup_pharmacist_id,
    primary_staff_id: patient.primary_staff_id,
    backup_staff_id: patient.backup_staff_id,
    allergy_info: patient.allergy_info,
    notes: patient.notes,
    archived_at: patient.archived_at,
    archived_by: patient.archived_by,
    created_at: patient.created_at,
    updated_at: patient.updated_at,
    scheduling_preference: patient.scheduling_preference,
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
      id: true,
      name: true,
      name_kana: true,
      birth_date: true,
      gender: true,
      allergy_info: true,
      primary_pharmacist_id: true,
      backup_pharmacist_id: true,
      primary_staff_id: true,
      backup_staff_id: true,
      residences: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        select: {
          facility_id: true,
          unit_name: true,
        },
      },
      scheduling_preference: {
        select: {
          swallowing_route: true,
          care_level: true,
        },
      },
      conditions: {
        orderBy: [{ is_primary: 'desc' }, { noted_at: 'desc' }, { created_at: 'desc' }],
        select: {
          condition_type: true,
          name: true,
          is_primary: true,
          is_active: true,
          noted_at: true,
          notes: true,
        },
      },
      cases: {
        where: {
          org_id: args.orgId,
          ...(assignedCaseWhere ?? {}),
        },
        orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          start_date: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const assignedUserIds = [
    patient.primary_pharmacist_id,
    patient.backup_pharmacist_id,
    patient.primary_staff_id,
    patient.backup_staff_id,
  ].filter((value): value is string => Boolean(value));
  const uniqueAssignedUserIds = [...new Set(assignedUserIds)];

  const [assignedNameMap, firstVisit, lastPrescription, egfrObservation] = await Promise.all([
    uniqueAssignedUserIds.length > 0
      ? batchResolveNames(db as typeof prisma, args.orgId, uniqueAssignedUserIds)
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
          select: {
            prescribed_date: true,
            lines: {
              orderBy: { line_number: 'asc' },
              select: {
                packaging_instruction_tags: true,
                dispensing_method: true,
              },
            },
          },
        }),
    db.patientLabObservation.findFirst({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        analyte_code: 'egfr',
      },
      orderBy: { measured_at: 'desc' },
      select: {
        value_numeric: true,
        value_text: true,
        measured_at: true,
      },
    }),
  ]);
  const allergy = buildAllergyLabel(patient.allergy_info);
  const swallowing = patient.scheduling_preference?.swallowing_route?.trim() || null;
  const handlingTags = sortHandlingTags([
    ...(lastPrescription?.lines ?? []).flatMap(
      (line) => line.packaging_instruction_tags as string[],
    ),
    ...((lastPrescription?.lines ?? []).some((line) => line.dispensing_method === 'unit_dose')
      ? ['unit_dose']
      : []),
  ]);
  const egfrValue = egfrObservation?.value_numeric ?? egfrObservation?.value_text ?? null;
  const renal =
    egfrObservation && egfrValue != null
      ? formatRenalSafetyLabel(egfrValue, egfrObservation.measured_at)
      : null;
  const safetyTagSet = new Set<string>(handlingTags);
  if (renal) safetyTagSet.add('renal');
  if (swallowing) safetyTagSet.add('swallowing');
  if (allergy) safetyTagSet.add('allergy');
  const safetyTags = sortPatientSafetyTags(safetyTagSet);
  const visibleSafetyTags = selectVisibleSafetyTags(safetyTags);
  const latestCase = patient.cases[0] ?? null;
  const careLevel = patient.scheduling_preference?.care_level ?? null;

  return {
    patient_id: patient.id,
    name: patient.name,
    name_kana: patient.name_kana,
    birth_date: patient.birth_date.toISOString(),
    gender: patient.gender,
    gender_label: formatPatientHeaderGenderLabel(patient.gender),
    care_level: careLevel,
    care_level_label: careLevel ? (careLevelLabels[careLevel] ?? careLevel) : null,
    home_status_label: null,
    residence_label: formatPatientHeaderResidenceLabel(patient.residences),
    primary_diagnosis: selectPatientHeaderPrimaryDiagnosis(patient.conditions),
    intervention_start_date: latestCase?.start_date?.toISOString() ?? null,
    primary_pharmacist_name: patient.primary_pharmacist_id
      ? (assignedNameMap.get(patient.primary_pharmacist_id) ?? null)
      : null,
    backup_pharmacist_name: patient.backup_pharmacist_id
      ? (assignedNameMap.get(patient.backup_pharmacist_id) ?? null)
      : null,
    primary_staff_name: patient.primary_staff_id
      ? (assignedNameMap.get(patient.primary_staff_id) ?? null)
      : null,
    backup_staff_name: patient.backup_staff_id
      ? (assignedNameMap.get(patient.backup_staff_id) ?? null)
      : null,
    first_visit_date: firstVisit?.visit_date.toISOString() ?? null,
    last_prescribed_date: lastPrescription?.prescribed_date.toISOString() ?? null,
    next_prescription_expected_date: null,
    safety: {
      allergy,
      renal,
      handling_tags: handlingTags,
      swallowing,
      cautions: buildCautionLabels(patient.conditions),
      safety_tags: safetyTags,
      visible_safety_tags: visibleSafetyTags.tags,
      hidden_safety_tag_count: visibleSafetyTags.hiddenCount,
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

function resolvePatientTimelineLimit(limit: number | undefined) {
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit)) {
    return PATIENT_TIMELINE_DEFAULT_LIMIT;
  }
  return Math.min(PATIENT_TIMELINE_MAX_LIMIT, Math.max(1, limit));
}

export async function getPatientTimelineData(runScoped: ScopedTxRunner, args: PatientTimelineArgs) {
  const timelineLimit = resolvePatientTimelineLimit(args.timelineLimit);
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
        take: Math.min(20, timelineLimit),
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
    .slice(0, timelineLimit);

  return {
    timeline_events: timelineEvents,
    movement_events: buildPatientMovementTimelineEvents(timelineEvents, {
      patientId: args.patientId,
    }),
    self_reports: selfReports.map((item) => ({
      id: item.id,
      category: item.category ?? '未分類',
      relation: item.relation,
      status: item.status,
      requested_callback: item.requested_callback,
      preferred_contact_time: item.preferred_contact_time,
      created_at: item.created_at.toISOString(),
    })),
    ...(partialFailures.length > 0 ? { partial_failures: partialFailures } : {}),
  };
}

export async function getPatientMovementTimelineEventDetail(
  runScoped: ScopedTxRunner,
  args: PatientMovementTimelineEventDetailArgs,
) {
  const timeline = await getPatientTimelineData(runScoped, {
    ...args,
    timelineLimit: PATIENT_TIMELINE_MAX_LIMIT,
  });
  if (!timeline) return null;

  const event = timeline.movement_events.find((item) => item.id === args.eventId);
  if (!event) return null;

  return {
    patient_id: args.patientId,
    event_id: args.eventId,
    event,
    destination: {
      href: event.href,
      label: event.action_label,
      related_entity_type: event.related_entity_type,
      related_entity_id: event.related_entity_id,
    },
    raw_text: {
      available: event.raw_available,
      included: false as const,
      reason: event.raw_available
        ? 'raw_text は一覧/ resolver では返さず、遷移先で再認可して表示します。'
        : 'このイベントの raw_text は resolver では提供しません。',
    },
  };
}
