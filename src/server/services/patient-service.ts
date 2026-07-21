import { subDays } from 'date-fns';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { MemberRole } from '@prisma/client';
import { buildSearchFilter } from '@/lib/api/search';
import { getPatientPrivacyFlags } from '@/lib/patient/privacy';
import { listPatientRiskSummaries } from '@/server/services/patient-risk';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import {
  mapPatientListItem,
  buildPatientListSummary,
  type MappedPatientListItem,
  type VisitRecord,
  type VisitSchedule,
} from '@/server/mappers/patient-response-mapper';
import { parseCaseStatusList } from '@/lib/patient/case-status';
import { formatUtcDateKey } from '@/lib/date-key';
import { japanDayInstantRangeFromDateKey } from '@/lib/utils/date-boundary';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import {
  buildCareTeamReliabilitySummary,
  buildPatientContactReadiness,
  selectPrimaryCareTeamCase,
} from '@/lib/patient/care-team-contact';
import { listActivePatientShareSummaries } from '@/server/services/patient-share-summary';

const DEFAULT_PATIENT_LIST_LIMIT = 50;
const MAX_PATIENT_LIST_LIMIT = 500;
const DEFAULT_PATIENT_PALETTE_LIMIT = 8;
const MAX_PATIENT_PALETTE_LIMIT = 50;

export type PatientListFilters = {
  view?: 'palette' | 'search' | 'match';
  q?: string;
  cursor?: string;
  limit?: number;
  sort?: 'name_kana' | 'name' | 'created_at';
  order?: 'asc' | 'desc';
  archive_status?: 'active' | 'archived' | 'all';
  facility_mode?: 'facility' | 'home';
  consent_status?: 'complete' | 'missing';
  risk_level?: 'stable' | 'watch' | 'high';
  last_visit?: 'within_30_days' | 'none';
  case_status?: string;
  primary_pharmacist_id?: string;
  building_id?: string;
  billing_support?: 'true' | 'false';
  payer_basis?: 'medical' | 'care' | 'self';
  last_visit_from?: string;
  last_visit_to?: string;
  readiness_issue?:
    | 'missing_visit_consent'
    | 'missing_management_plan'
    | 'missing_emergency_contact'
    | 'missing_primary_physician'
    | 'missing_first_visit_doc';
  foundation_issue?:
    | 'needs_confirmation'
    | 'missing_contact'
    | 'missing_parking'
    | 'missing_care_level'
    | 'missing_insurance'
    | 'missing_care_team';
};

function buildPatientSelect(referenceDate: Date, accessContext?: VisitScheduleAccessContext) {
  const caseAssignmentWhere = accessContext ? buildCareCaseAssignmentWhere(accessContext) : null;

  return {
    id: true,
    name: true,
    name_kana: true,
    birth_date: true,
    gender: true,
    phone: true,
    medical_insurance_number: true,
    care_insurance_number: true,
    billing_support_flag: true,
    archived_at: true,
    residences: {
      where: { is_primary: true },
      take: 1,
      select: {
        address: true,
        building_id: true,
        unit_name: true,
      },
    },
    _count: {
      select: {
        contacts: true,
      },
    },
    scheduling_preference: {
      select: {
        preferred_contact_name: true,
        preferred_contact_phone: true,
        visit_before_contact_required: true,
        parking_available: true,
        care_level: true,
      },
    },
    contacts: {
      take: 10,
      select: {
        id: true,
        is_primary: true,
        is_emergency_contact: true,
        phone: true,
        email: true,
        fax: true,
      },
    },
    conditions: {
      where: { is_active: true },
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      take: 3,
      select: {
        id: true,
        condition_type: true,
        name: true,
        is_primary: true,
      },
    },
    cases: {
      ...(caseAssignmentWhere ? { where: caseAssignmentWhere } : {}),
      select: {
        id: true,
        status: true,
        updated_at: true,
        primary_pharmacist_id: true,
        care_team_links: {
          take: 10,
          select: {
            id: true,
            role: true,
            phone: true,
            email: true,
            fax: true,
            is_primary: true,
          },
        },
      },
      orderBy: { updated_at: 'desc' },
      take: 1,
    },
    consents: {
      where: {
        consent_type: 'visit_medication_management',
        revoked_date: null,
        OR: [{ expiry_date: null }, { expiry_date: { gte: referenceDate } }],
      },
      select: {
        id: true,
      },
      take: 1,
    },
  } satisfies Prisma.PatientSelect;
}

type PatientRow = Prisma.PatientGetPayload<{
  select: ReturnType<typeof buildPatientSelect>;
}>;

function buildActiveVisitConsentWhere(referenceDate: Date): Prisma.ConsentRecordWhereInput {
  return {
    consent_type: 'visit_medication_management',
    revoked_date: null,
    OR: [{ expiry_date: null }, { expiry_date: { gte: referenceDate } }],
  };
}

function buildDbWhere(orgId: string, filters: PatientListFilters, referenceDate: Date) {
  const where: Prisma.PatientWhereInput = {
    org_id: orgId,
    ...buildSearchFilter(filters.q, ['name', 'name_kana']),
  };

  const archiveStatus = filters.archive_status ?? 'active';
  if (archiveStatus === 'active') {
    where.archived_at = null;
  } else if (archiveStatus === 'archived') {
    where.archived_at = { not: null };
  }

  // case_status → DB filter
  const requestedCaseStatuses = parseCaseStatusList(filters.case_status);
  if (requestedCaseStatuses.length) {
    where.cases = {
      some: { status: { in: requestedCaseStatuses } },
    };
  }

  // primary_pharmacist_id → DB filter
  if (filters.primary_pharmacist_id) {
    where.cases = {
      ...((where.cases as Prisma.CareCaseListRelationFilter) ?? {}),
      some: {
        ...(((where.cases as Prisma.CareCaseListRelationFilter)
          ?.some as Prisma.CareCaseWhereInput) ?? {}),
        primary_pharmacist_id: filters.primary_pharmacist_id,
      },
    };
  }

  // building_id → DB filter
  if (filters.building_id) {
    where.residences = {
      some: { building_id: filters.building_id },
    };
  }

  // billing_support → DB filter
  if (filters.billing_support) {
    where.billing_support_flag = filters.billing_support === 'true';
  }

  // facility_mode → DB filter
  if (filters.facility_mode === 'facility') {
    where.residences = {
      ...((where.residences as Prisma.ResidenceListRelationFilter) ?? {}),
      some: {
        ...(((where.residences as Prisma.ResidenceListRelationFilter)
          ?.some as Prisma.ResidenceWhereInput) ?? {}),
        building_id: { not: null },
      },
    };
  } else if (filters.facility_mode === 'home') {
    // home = primary residence has no building_id
    // We keep this as post-query since it depends on is_primary residence
  }

  // consent_status → DB filter
  const activeVisitConsentWhere = buildActiveVisitConsentWhere(referenceDate);
  if (filters.consent_status === 'complete') {
    where.consents = {
      some: activeVisitConsentWhere,
    };
  } else if (filters.consent_status === 'missing') {
    where.consents = {
      none: activeVisitConsentWhere,
    };
  }

  // payer_basis → DB filter
  if (filters.payer_basis === 'medical') {
    where.medical_insurance_number = { not: null };
  } else if (filters.payer_basis === 'care') {
    where.medical_insurance_number = null;
    where.care_insurance_number = { not: null };
  } else if (filters.payer_basis === 'self') {
    where.medical_insurance_number = null;
    where.care_insurance_number = null;
  }

  return where;
}

function buildPatientOrderBy(
  filters: Pick<PatientListFilters, 'sort' | 'order'>,
): Prisma.PatientOrderByWithRelationInput[] {
  const direction = filters.order ?? 'asc';

  switch (filters.sort) {
    case 'created_at':
      return [{ created_at: direction }, { id: direction }];
    case 'name':
      return [{ name: direction }, { name_kana: direction }, { id: direction }];
    default:
      return [{ name_kana: direction }, { name: direction }, { id: direction }];
  }
}

function normalizePatientListLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PATIENT_LIST_LIMIT;
  }

  const normalized = Math.trunc(limit);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    return DEFAULT_PATIENT_LIST_LIMIT;
  }

  return Math.min(normalized, MAX_PATIENT_LIST_LIMIT);
}

function normalizePatientPaletteLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PATIENT_PALETTE_LIMIT;
  }

  const normalized = Math.trunc(limit);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    return DEFAULT_PATIENT_PALETTE_LIMIT;
  }

  return Math.min(normalized, MAX_PATIENT_PALETTE_LIMIT);
}

function matchesPatientPostFilters(
  patient: MappedPatientListItem,
  filters: PatientListFilters,
  rawPatient?: PatientRow,
) {
  const latestCase = patient.latest_case;
  const latestVisitDate = patient.latest_visit?.visit_date ?? null;

  const requestedCaseStatuses = parseCaseStatusList(filters.case_status);
  if (requestedCaseStatuses.length) {
    if (!latestCase || !requestedCaseStatuses.some((status) => status === latestCase.status)) {
      return false;
    }
  }

  if (
    filters.primary_pharmacist_id &&
    latestCase?.primary_pharmacist_id !== filters.primary_pharmacist_id
  ) {
    return false;
  }

  if (filters.building_id && (patient.residences[0]?.building_id ?? null) !== filters.building_id) {
    return false;
  }

  if (
    filters.billing_support &&
    patient.billing_support_flag !== (filters.billing_support === 'true')
  ) {
    return false;
  }

  if (filters.payer_basis) {
    const payerBasis = patient.medical_insurance_number
      ? 'medical'
      : patient.care_insurance_number
        ? 'care'
        : 'self';
    if (payerBasis !== filters.payer_basis) {
      return false;
    }
  }

  if (filters.facility_mode && patient.facility_mode !== filters.facility_mode) {
    return false;
  }

  if (filters.consent_status === 'complete' && !patient.consent.has_visit_medication_management) {
    return false;
  }
  if (filters.consent_status === 'missing' && patient.consent.has_visit_medication_management) {
    return false;
  }

  if (filters.risk_level && patient.risk_summary.level !== filters.risk_level) {
    return false;
  }

  if (
    filters.last_visit_from &&
    (!latestVisitDate ||
      latestVisitDate < japanDayInstantRangeFromDateKey(filters.last_visit_from).gte)
  ) {
    return false;
  }
  if (
    filters.last_visit_to &&
    (!latestVisitDate ||
      latestVisitDate >= japanDayInstantRangeFromDateKey(filters.last_visit_to).lt)
  ) {
    return false;
  }
  if (filters.last_visit && patient.last_visit_bucket !== filters.last_visit) {
    return false;
  }

  if (filters.readiness_issue) {
    switch (filters.readiness_issue) {
      case 'missing_visit_consent':
        if (patient.consent.has_visit_medication_management) return false;
        break;
      case 'missing_management_plan':
        if (!patient.risk_summary.missing_management_plan) return false;
        break;
      case 'missing_emergency_contact':
        if (patient.readiness.has_emergency_contact) return false;
        break;
      case 'missing_primary_physician':
        if (patient.readiness.has_primary_physician) return false;
        break;
      case 'missing_first_visit_doc':
        if (patient.readiness.has_first_visit_document) return false;
        break;
      default:
        break;
    }
  }

  if (filters.foundation_issue) {
    const rawPreference = rawPatient?.scheduling_preference ?? null;
    const responsePreference = patient.scheduling_preference;
    const contacts = rawPatient?.contacts ?? patient.contacts;
    const careCases = rawPatient?.cases ?? patient.cases;
    const getContactReadiness = () =>
      buildPatientContactReadiness({
        contacts,
        preferredContactName: rawPreference?.preferred_contact_name,
        preferredContactPhone: rawPreference?.preferred_contact_phone,
        visitBeforeContactRequired:
          rawPreference?.visit_before_contact_required ??
          responsePreference?.visit_before_contact_required,
      });
    const getCareTeamReliability = () =>
      buildCareTeamReliabilitySummary({
        contacts,
        careTeamLinks: selectPrimaryCareTeamCase(careCases)?.care_team_links ?? [],
      });
    const insuranceMissing = rawPatient
      ? !rawPatient.medical_insurance_number && !rawPatient.care_insurance_number
      : !patient.medical_insurance_number && !patient.care_insurance_number;

    switch (filters.foundation_issue) {
      case 'needs_confirmation':
        if (
          getContactReadiness().ready &&
          (rawPreference?.parking_available ?? responsePreference?.parking_available) != null &&
          (rawPreference?.care_level ?? responsePreference?.care_level) &&
          !insuranceMissing &&
          !getCareTeamReliability().needs_confirmation
        ) {
          return false;
        }
        break;
      case 'missing_contact':
        if (getContactReadiness().ready) return false;
        break;
      case 'missing_parking':
        if ((rawPreference?.parking_available ?? responsePreference?.parking_available) != null) {
          return false;
        }
        break;
      case 'missing_care_level':
        if (rawPreference?.care_level ?? responsePreference?.care_level) return false;
        break;
      case 'missing_insurance':
        if (!insuranceMissing) return false;
        break;
      case 'missing_care_team':
        if (!getCareTeamReliability().needs_confirmation) return false;
        break;
      default:
        break;
    }
  }

  return true;
}

async function enrichPatientBatch(args: {
  prisma: PrismaClient;
  orgId: string;
  role: MemberRole | string;
  patients: PatientRow[];
  referenceDate: Date;
  accessContext?: VisitScheduleAccessContext;
}) {
  const { prisma, orgId, role, patients, referenceDate, accessContext } = args;
  if (patients.length === 0) {
    return [] as MappedPatientListItem[];
  }

  const patientIds = patients.map((patient) => patient.id);
  const caseAssignmentWhere = accessContext ? buildCareCaseAssignmentWhere(accessContext) : null;
  const assignedCareCases = await prisma.careCase.findMany({
    where: {
      org_id: orgId,
      patient_id: { in: patientIds },
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
    select: {
      id: true,
      patient_id: true,
    },
  });
  const assignedCaseIdsByPatient = Object.fromEntries(
    patientIds.map((patientId) => [patientId, [] as string[]]),
  );
  for (const careCase of assignedCareCases) {
    assignedCaseIdsByPatient[careCase.patient_id]?.push(careCase.id);
  }
  const assignedCaseIds = Array.from(new Set(assignedCareCases.map((careCase) => careCase.id)));
  const latestCaseIds = Array.from(
    new Set(
      patients
        .map((patient) => patient.cases[0]?.id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const primaryPharmacistIds = Array.from(
    new Set(
      patients
        .map((patient) => patient.cases[0]?.primary_pharmacist_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const [
    riskSummaries,
    pharmacistNameById,
    visitRecords,
    visitSchedules,
    firstVisitDocuments,
    patientShareSummaries,
  ] = await Promise.all([
    listPatientRiskSummaries(prisma, {
      orgId,
      patientIds,
      caseIdsByPatient: assignedCaseIdsByPatient,
      includeStable: true,
    }),
    batchResolveNames(prisma, orgId, primaryPharmacistIds),
    assignedCaseIds.length === 0
      ? Promise.resolve([])
      : prisma.$queryRaw<VisitRecord[]>`
            SELECT DISTINCT ON (vr.patient_id)
              vr.id, vr.patient_id, vr.visit_date, vr.outcome_status, vr.created_at
            FROM "VisitRecord" vr
            INNER JOIN "VisitSchedule" vs ON vs.id = vr.schedule_id
            INNER JOIN "CareCase" cc
              ON cc.id = vs.case_id
             AND cc.patient_id = vr.patient_id
             AND cc.org_id = ${orgId}
            WHERE vr.org_id = ${orgId}
              AND vr.patient_id = ANY(${patientIds}::text[])
              AND cc.id = ANY(${assignedCaseIds}::text[])
            ORDER BY vr.patient_id, vr.visit_date DESC, vr.created_at DESC
          `,
    latestCaseIds.length === 0
      ? Promise.resolve([])
      : prisma.$queryRaw<VisitSchedule[]>`
            SELECT id, case_id, scheduled_date, schedule_status, priority
            FROM (
              SELECT id, case_id, scheduled_date, schedule_status, priority,
                     ROW_NUMBER() OVER (PARTITION BY case_id ORDER BY scheduled_date ASC) AS rn
              FROM "VisitSchedule"
              WHERE org_id = ${orgId}
                AND case_id = ANY(${latestCaseIds}::text[])
            ) ranked
            WHERE rn <= 3
          `,
    latestCaseIds.length === 0
      ? Promise.resolve([])
      : prisma.firstVisitDocument.findMany({
          where: {
            org_id: orgId,
            case_id: { in: latestCaseIds },
            delivered_at: { not: null },
          },
          select: {
            case_id: true,
          },
        }),
    listActivePatientShareSummaries(prisma, {
      orgId,
      patientIds,
      asOf: referenceDate,
    }),
  ]);

  const riskByPatientId = new Map(riskSummaries.map((summary) => [summary.patient_id, summary]));
  const latestVisitByPatientId = new Map(
    visitRecords.map((visitRecord) => [visitRecord.patient_id, visitRecord]),
  );
  const visitSchedulesByCaseId = new Map<string, VisitSchedule[]>();
  for (const visitSchedule of visitSchedules) {
    const entries = visitSchedulesByCaseId.get(visitSchedule.case_id) ?? [];
    entries.push(visitSchedule);
    visitSchedulesByCaseId.set(visitSchedule.case_id, entries);
  }
  const deliveredFirstVisitCaseIds = new Set(
    firstVisitDocuments.map((document) => document.case_id),
  );

  const privacy = getPatientPrivacyFlags(role);
  const recentVisitThreshold = subDays(new Date(), 30);

  return patients.map((patient) => {
    const latestCase = patient.cases[0] ?? null;
    const latestVisit = latestVisitByPatientId.get(patient.id) ?? null;
    const schedules = latestCase ? (visitSchedulesByCaseId.get(latestCase.id) ?? []) : [];

    return mapPatientListItem(
      patient,
      riskByPatientId.get(patient.id),
      pharmacistNameById,
      latestVisit,
      schedules,
      deliveredFirstVisitCaseIds,
      privacy,
      recentVisitThreshold,
      patientShareSummaries.get(patient.id),
    );
  });
}

async function collectFilteredPatients(args: {
  prisma: PrismaClient;
  orgId: string;
  role: MemberRole | string;
  filters: PatientListFilters;
  where: Prisma.PatientWhereInput;
  orderBy: Prisma.PatientOrderByWithRelationInput[];
  referenceDate: Date;
  batchSize: number;
  startCursor?: string;
  accessContext?: VisitScheduleAccessContext;
}) {
  const filtered: MappedPatientListItem[] = [];
  let batchCursor = args.startCursor;
  let hasMoreRows = true;

  while (hasMoreRows) {
    const rows = await args.prisma.patient.findMany({
      where: args.where,
      orderBy: args.orderBy,
      take: args.batchSize + 1,
      ...(batchCursor ? { cursor: { id: batchCursor }, skip: 1 } : {}),
      select: buildPatientSelect(args.referenceDate, args.accessContext),
    });
    if (rows.length === 0) {
      break;
    }

    hasMoreRows = rows.length > args.batchSize;
    const pageRows = hasMoreRows ? rows.slice(0, args.batchSize) : rows;
    batchCursor = hasMoreRows ? pageRows[pageRows.length - 1]?.id : undefined;

    const enriched = await enrichPatientBatch({
      prisma: args.prisma,
      orgId: args.orgId,
      role: args.role,
      patients: pageRows,
      referenceDate: args.referenceDate,
      accessContext: args.accessContext,
    });

    filtered.push(
      ...enriched.filter((patient, index) =>
        matchesPatientPostFilters(patient, args.filters, pageRows[index]),
      ),
    );
  }

  return filtered;
}

export async function listPatients(
  prisma: PrismaClient,
  orgId: string,
  role: MemberRole | string,
  filters: PatientListFilters,
  accessContext?: VisitScheduleAccessContext,
) {
  const limit = normalizePatientListLimit(filters.limit);
  const referenceDate = new Date();
  const baseWhere = buildDbWhere(orgId, filters, referenceDate);
  const where = accessContext ? applyPatientAssignmentWhere(baseWhere, accessContext) : baseWhere;
  const orderBy = buildPatientOrderBy(filters);
  const batchSize = Math.min(Math.max(limit * 3, 100), 250);

  // 先頭からの全件絞り込み集合を1回だけ列挙する。orderBy は id を末尾タイブレークに含み
  // 全順序なので、cursor ページのデータは全件集合からの in-memory スライスで導出でき、
  // summary 用の2回目の全件走査(と enrich fan-out)を省ける。
  const allFiltered = await collectFilteredPatients({
    prisma,
    orgId,
    role,
    filters,
    where,
    orderBy,
    referenceDate,
    batchSize,
    accessContext,
  });
  const summary = buildPatientListSummary(allFiltered);

  let pageSource: MappedPatientListItem[];
  if (filters.cursor) {
    const cursorIndex = allFiltered.findIndex((patient) => patient.id === filters.cursor);
    if (cursorIndex >= 0) {
      // Prisma の cursor + skip:1(カーソル行を除外しそれ以降)と全順序下で等価。
      pageSource = allFiltered.slice(cursorIndex + 1);
    } else {
      // カーソル該当患者が全件集合に不在(アーカイブ/フィルタ境界変化等)の端ケースのみ、
      // 従来の cursor 起点パスへフォールバックして出力を完全保存する。
      pageSource = await collectFilteredPatients({
        prisma,
        orgId,
        role,
        filters,
        where,
        orderBy,
        referenceDate,
        batchSize,
        startCursor: filters.cursor,
        accessContext,
      });
    }
  } else {
    pageSource = allFiltered;
  }

  const hasMore = pageSource.length > limit;
  const data = hasMore ? pageSource.slice(0, limit) : pageSource;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;
  const privacy = getPatientPrivacyFlags(role);

  return {
    data,
    hasMore,
    nextCursor,
    summary,
    privacy: {
      sensitive_fields_masked: privacy.sensitiveFieldsMasked,
      address_fields_masked: privacy.addressFieldsMasked,
      can_view_detail: privacy.canViewDetail,
    },
  };
}

export async function listPatientPaletteSearchSummaries(
  prisma: PrismaClient,
  orgId: string,
  filters: PatientListFilters,
  accessContext?: VisitScheduleAccessContext,
) {
  const limit = normalizePatientPaletteLimit(filters.limit);
  const baseWhere = buildDbWhere(orgId, filters, new Date());
  const where = accessContext ? applyPatientAssignmentWhere(baseWhere, accessContext) : baseWhere;
  const rows = await prisma.patient.findMany({
    where,
    orderBy: buildPatientOrderBy(filters),
    take: limit + 1,
    select: {
      id: true,
      name: true,
      name_kana: true,
    },
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: data.map((patient) => ({
      id: patient.id,
      name: patient.name,
      name_kana: patient.name_kana,
    })),
    hasMore,
  };
}

export async function listPatientSearchResultSummaries(
  prisma: PrismaClient,
  orgId: string,
  filters: PatientListFilters,
  accessContext?: VisitScheduleAccessContext,
) {
  const limit = normalizePatientPaletteLimit(filters.limit);
  const baseWhere = buildDbWhere(orgId, filters, new Date());
  const where = accessContext ? applyPatientAssignmentWhere(baseWhere, accessContext) : baseWhere;
  const caseAssignmentWhere = accessContext ? buildCareCaseAssignmentWhere(accessContext) : null;
  const rows = await prisma.patient.findMany({
    where,
    orderBy: buildPatientOrderBy(filters),
    take: limit + 1,
    select: {
      id: true,
      name: true,
      name_kana: true,
      conditions: {
        where: { is_active: true },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        take: 2,
        select: {
          name: true,
          is_primary: true,
        },
      },
      cases: {
        ...(caseAssignmentWhere ? { where: caseAssignmentWhere } : {}),
        select: {
          visit_schedules: {
            orderBy: [{ scheduled_date: 'asc' }, { time_window_start: 'asc' }],
            take: 1,
            select: {
              scheduled_date: true,
            },
          },
        },
        orderBy: { updated_at: 'desc' },
        take: 1,
      },
    },
  });
  const hasMore = rows.length > limit;
  const dataRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: dataRows.map((patient) => ({
      id: patient.id,
      name: patient.name,
      name_kana: patient.name_kana,
      conditions: patient.conditions.map((condition) => ({
        name: condition.name,
        is_primary: condition.is_primary,
      })),
      visit_schedules: (patient.cases[0]?.visit_schedules ?? []).map((schedule) => ({
        scheduled_date: schedule.scheduled_date,
      })),
    })),
    hasMore,
  };
}

export async function listPatientMatchSummaries(
  prisma: PrismaClient,
  orgId: string,
  filters: PatientListFilters,
  accessContext?: VisitScheduleAccessContext,
) {
  const limit = normalizePatientPaletteLimit(filters.limit);
  const baseWhere = buildDbWhere(orgId, filters, new Date());
  const where = accessContext ? applyPatientAssignmentWhere(baseWhere, accessContext) : baseWhere;
  const rows = await prisma.patient.findMany({
    where,
    orderBy: buildPatientOrderBy(filters),
    take: limit + 1,
    select: {
      id: true,
      name: true,
      name_kana: true,
      birth_date: true,
      gender: true,
    },
  });
  const hasMore = rows.length > limit;
  const dataRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: dataRows.map((patient) => ({
      id: patient.id,
      name: patient.name,
      name_kana: patient.name_kana,
      birth_date: formatUtcDateKey(patient.birth_date),
      gender: patient.gender,
    })),
    hasMore,
  };
}

export {
  compactObject,
  createPatientWithIntake,
  deriveBirthDate,
  derivePackagingMethod,
  type CreatePatientData,
} from './patient-create';
