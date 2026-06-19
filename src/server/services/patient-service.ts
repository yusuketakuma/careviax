import { endOfDay, parseISO, startOfDay, subDays } from 'date-fns';
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
import {
  assertFacilityReference,
  assertFacilityUnitReference,
  getFacilityVisitDefaults,
} from '@/lib/patient/facility-reference';
import { withOrgContext } from '@/lib/db/rls';
import { toPrismaJsonInput } from '@/lib/db/json';
import { parseCaseStatusList } from '@/lib/patient/case-status';
import { createPatientSchema } from '@/lib/validations/patient';
import { formatDateKey } from '@/lib/date-key';
import { notifyWebhookEventForOrg } from '@/server/services/outbound-webhook';
import type { z } from 'zod';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import {
  buildCareTeamReliabilitySummary,
  buildPatientContactReadiness,
  normalizeCareTeamPrimaryByRole,
  normalizePatientPrimaryContacts,
  selectPrimaryCareTeamCase,
} from '@/lib/patient/care-team-contact';
import { listActivePatientShareSummaries } from '@/server/services/patient-share-summary';

const DEFAULT_PATIENT_LIST_LIMIT = 50;
const MAX_PATIENT_LIST_LIMIT = 500;

export type PatientListFilters = {
  q?: string;
  cursor?: string;
  limit?: number;
  sort?: 'name_kana' | 'name' | 'created_at';
  order?: 'asc' | 'desc';
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

function buildDbWhere(orgId: string, filters: PatientListFilters) {
  const where: Prisma.PatientWhereInput = {
    org_id: orgId,
    ...buildSearchFilter(filters.q, ['name', 'name_kana']),
  };

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
  if (filters.consent_status === 'complete') {
    where.consents = {
      some: {
        consent_type: 'visit_medication_management',
        revoked_date: null,
      },
    };
  } else if (filters.consent_status === 'missing') {
    where.consents = {
      none: {
        consent_type: 'visit_medication_management',
        revoked_date: null,
      },
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

function matchesPatientPostFilters(patient: MappedPatientListItem, filters: PatientListFilters) {
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
    (!latestVisitDate || latestVisitDate < startOfDay(parseISO(filters.last_visit_from)))
  ) {
    return false;
  }
  if (
    filters.last_visit_to &&
    (!latestVisitDate || latestVisitDate > endOfDay(parseISO(filters.last_visit_to)))
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
    const preference = patient.scheduling_preference;
    const getContactReadiness = () =>
      buildPatientContactReadiness({
        contacts: patient.contacts,
        preferredContactName: preference?.preferred_contact_name,
        preferredContactPhone: preference?.preferred_contact_phone,
        visitBeforeContactRequired: preference?.visit_before_contact_required,
      });
    const getCareTeamReliability = () =>
      buildCareTeamReliabilitySummary({
        contacts: patient.contacts,
        careTeamLinks: selectPrimaryCareTeamCase(patient.cases)?.care_team_links ?? [],
      });
    const insuranceMissing = !patient.medical_insurance_number && !patient.care_insurance_number;

    switch (filters.foundation_issue) {
      case 'needs_confirmation':
        if (
          getContactReadiness().ready &&
          preference?.parking_available != null &&
          preference?.care_level &&
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
        if (preference?.parking_available != null) return false;
        break;
      case 'missing_care_level':
        if (preference?.care_level) return false;
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
      ...enriched.filter((patient) => matchesPatientPostFilters(patient, args.filters)),
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
  const baseWhere = buildDbWhere(orgId, filters);
  const where = accessContext ? applyPatientAssignmentWhere(baseWhere, accessContext) : baseWhere;
  const orderBy = buildPatientOrderBy(filters);
  const batchSize = Math.min(Math.max(limit * 3, 100), 250);
  const filtered = await collectFilteredPatients({
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
  const summarySource = filters.cursor
    ? await collectFilteredPatients({
        prisma,
        orgId,
        role,
        filters,
        where,
        orderBy,
        referenceDate,
        batchSize,
        accessContext,
      })
    : filtered;
  const summary = buildPatientListSummary(summarySource);

  const hasMore = filtered.length > limit;
  const data = hasMore ? filtered.slice(0, limit) : filtered;
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

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function deriveBirthDate(rawBirthDate: string | undefined, reportedAge?: number) {
  if (rawBirthDate) return rawBirthDate;
  if (typeof reportedAge === 'number' && Number.isFinite(reportedAge)) {
    const today = new Date();
    return formatDateKey(new Date(today.getFullYear() - reportedAge, 0, 1));
  }
  return undefined;
}

function derivePackagingMethod(intake?: { medication_support_methods?: string[] }) {
  const methods = intake?.medication_support_methods ?? [];
  if (methods.includes('unit_dose')) return 'unit_dose';
  if (methods.includes('calendar')) return 'calendar_pack';
  if (methods.includes('box')) return 'medication_box';
  if (methods.includes('crush')) return 'crush_and_pack';
  return null;
}

export type CreatePatientData = z.infer<typeof createPatientSchema>;

export async function createPatientWithIntake(orgId: string, data: CreatePatientData) {
  const { address, birth_date, intake, requester, ...rest } = data;

  const preparedContacts =
    rest.contacts?.map((contact) => ({
      name: contact.name,
      relation: contact.relation,
      phone: contact.phone || null,
      email: contact.email || null,
      fax: contact.fax || null,
      organization_name: contact.organization_name || null,
      department: contact.department || null,
      address: contact.address || null,
      is_primary: contact.is_primary,
      is_emergency_contact: contact.is_emergency_contact,
      notes: contact.notes || null,
    })) ?? [];

  if (intake?.emergency_contact?.name) {
    preparedContacts.push({
      name: intake.emergency_contact.name,
      relation: 'other',
      phone: intake.emergency_contact.phone || null,
      email: null,
      fax: null,
      organization_name: null,
      department: null,
      address: null,
      is_primary: false,
      is_emergency_contact: true,
      notes: intake.emergency_contact.relation || null,
    });
  }
  const normalizedContacts = normalizePatientPrimaryContacts(preparedContacts);

  const normalizedConditions =
    rest.conditions?.map((condition) => ({
      condition_type: condition.condition_type,
      name: condition.name,
      is_primary: condition.is_primary,
      is_active: condition.is_active,
      noted_at: condition.noted_at ? new Date(condition.noted_at) : null,
      notes: condition.notes || null,
    })) ?? [];

  if (intake?.primary_disease) {
    normalizedConditions.unshift({
      condition_type: 'disease',
      name: intake.primary_disease,
      is_primary: true,
      is_active: true,
      noted_at: null,
      notes: null,
    });
  }

  const packagingMethod = derivePackagingMethod(intake);
  const preferredContactPhone =
    intake?.contact_phone || rest.phone || intake?.contact_mobile || null;
  const homeVisitIntake = compactObject({
    requester: requester
      ? compactObject({
          organization_name: requester.organization_name,
          profession: requester.profession,
          contact_name: requester.contact_name,
          contact_name_kana: requester.contact_name_kana,
          phone: requester.phone,
          fax: requester.fax,
          pharmacy_decision_due_date: requester.pharmacy_decision_due_date,
          preferred_contact_method: requester.preferred_contact_method,
          preferred_contact_method_other: requester.preferred_contact_method_other,
        })
      : undefined,
    reported_age: intake?.age,
    primary_disease: intake?.primary_disease,
    postal_code: intake?.postal_code,
    housing_type: intake?.housing_type,
    facility_name: intake?.facility_name,
    mcs_linked: intake?.mcs_linked,
    primary_contact_preference: intake?.primary_contact_preference,
    contact_phone: intake?.contact_phone,
    contact_mobile: intake?.contact_mobile,
    emergency_contact: intake?.emergency_contact
      ? compactObject({
          name: intake.emergency_contact.name,
          relation: intake.emergency_contact.relation,
          phone: intake.emergency_contact.phone,
        })
      : undefined,
    visit_before_contact_required: intake?.visit_before_contact_required,
    first_visit_date: intake?.first_visit_preferred_date,
    first_visit_time_slot: intake?.first_visit_time_slot,
    first_visit_time_note: intake?.first_visit_time_note,
    money_management: intake?.money_management,
    parking_available: intake?.parking_available,
    family_key_person: intake?.family_key_person,
    care_level: intake?.care_level,
    adl_level: intake?.adl_level,
    dementia_level: intake?.dementia_level,
    medication_support_methods: intake?.medication_support_methods,
    medication_support_other: intake?.medication_support_other,
    ent_prescription: intake?.ent_prescription,
    ent_period_from: intake?.ent_period_from,
    ent_period_to: intake?.ent_period_to,
    narcotics_base: intake?.narcotics_base,
    narcotics_rescue: intake?.narcotics_rescue,
    allergy_history: intake?.allergy_history,
    infection_isolation: intake?.infection_isolation,
    swallowing_route: intake?.swallowing_route,
    residual_medication_status: intake?.residual_medication_status,
    other_clinical_notes: intake?.other_clinical_notes,
    special_medical_procedures: intake?.special_medical_procedures,
    special_medical_notes: intake?.special_medical_notes,
    home_care_status: intake?.home_care_status,
    home_start_date: intake?.home_start_date,
    home_end_date: intake?.home_end_date,
    home_end_reason: intake?.home_end_reason,
    emergency_response: intake?.emergency_response,
    after_hours_explanation_date: intake?.after_hours_explanation_date,
    patient_tags: intake?.patient_tags,
    visit_frequency: intake?.visit_frequency,
    regular_visit_slot: intake?.regular_visit_slot,
    visit_available_time_note: intake?.visit_available_time_note,
    access_key_info: intake?.access_key_info,
    medication_handover_place: intake?.medication_handover_place,
    medication_storage_location: intake?.medication_storage_location,
    collection_method: intake?.collection_method,
    payer: intake?.payer,
    medication_manager: intake?.medication_manager,
    medication_ability: intake?.medication_ability,
    missed_dose_pattern: intake?.missed_dose_pattern,
    residual_medication_pattern: intake?.residual_medication_pattern,
    residual_medication_checked_on: intake?.residual_medication_checked_on,
    residual_adjustment_status: intake?.residual_adjustment_status,
    crushing_check_status: intake?.crushing_check_status,
    simple_suspension_check_status: intake?.simple_suspension_check_status,
    egfr_value: intake?.egfr_value,
    egfr_measured_on: intake?.egfr_measured_on,
    weight_kg: intake?.weight_kg,
    weight_measured_on: intake?.weight_measured_on,
    high_risk_drug_flags: intake?.high_risk_drug_flags,
    adverse_monitoring_items: intake?.adverse_monitoring_items,
    pain_score: intake?.pain_score,
    rescue_use_count_recent: intake?.rescue_use_count_recent,
    constipation_status: intake?.constipation_status,
    drowsiness_delirium_status: intake?.drowsiness_delirium_status,
    fall_risk: intake?.fall_risk,
    pressure_ulcer_status: intake?.pressure_ulcer_status,
    medical_material_supplier: intake?.medical_material_supplier,
    material_exchange_due_note: intake?.material_exchange_due_note,
    device_vendor_contact: intake?.device_vendor_contact,
    document_status_note: intake?.document_status_note,
    report_destination_note: intake?.report_destination_note,
    emergency_policy_note: intake?.emergency_policy_note,
    interprofessional_action_note: intake?.interprofessional_action_note,
    home_pharmacy_add_on_2: intake?.home_pharmacy_add_on_2,
    intake_note: intake?.intake_note,
    care_manager: intake?.care_manager
      ? compactObject({
          name: intake.care_manager.name,
          name_kana: intake.care_manager.name_kana,
          organization_name: intake.care_manager.organization_name,
          phone: intake.care_manager.phone,
          fax: intake.care_manager.fax,
        })
      : undefined,
    visiting_nurse: intake?.visiting_nurse
      ? compactObject({
          name: intake.visiting_nurse.name,
          name_kana: intake.visiting_nurse.name_kana,
          organization_name: intake.visiting_nurse.organization_name,
          phone: intake.visiting_nurse.phone,
          fax: intake.visiting_nurse.fax,
        })
      : undefined,
    initial_transition_management_expected: intake?.initial_transition_management_expected,
  });

  const patient = await withOrgContext(orgId, async (tx) => {
    const facilityId = rest.facility_id || null;
    const facilityUnitId = rest.facility_unit_id || null;

    await assertFacilityReference(tx, orgId, facilityId);
    await assertFacilityUnitReference(tx, orgId, facilityId, facilityUnitId);

    const facilityVisitDefaults = await getFacilityVisitDefaults(tx, orgId, facilityId);

    const newPatient = await tx.patient.create({
      data: {
        org_id: orgId,
        birth_date: new Date(birth_date),
        name: rest.name,
        name_kana: rest.name_kana,
        gender: rest.gender,
        phone: preferredContactPhone,
        medical_insurance_number: rest.medical_insurance_number || null,
        care_insurance_number: rest.care_insurance_number || null,
        billing_support_flag: rest.billing_support_flag ?? false,
        allergy_info: rest.allergy_info ? toPrismaJsonInput(rest.allergy_info) : undefined,
        notes: rest.notes || null,
      },
    });

    // Write PatientInsurance records from denormalized insurance numbers
    const insuranceRecords: Prisma.PatientInsuranceCreateManyInput[] = [];
    if (rest.medical_insurance_number) {
      insuranceRecords.push({
        org_id: orgId,
        patient_id: newPatient.id,
        insurance_type: 'medical',
        number: rest.medical_insurance_number,
        is_active: true,
      });
    }
    if (rest.care_insurance_number) {
      insuranceRecords.push({
        org_id: orgId,
        patient_id: newPatient.id,
        insurance_type: 'care',
        number: rest.care_insurance_number,
        is_active: true,
      });
    }
    if (insuranceRecords.length > 0) {
      await tx.patientInsurance.createMany({ data: insuranceRecords });
    }

    const residenceAddress =
      address ||
      (facilityId
        ? (
            await tx.facility.findFirst({
              where: { id: facilityId, org_id: orgId },
              select: { address: true },
            })
          )?.address || ''
        : '');

    if (residenceAddress || rest.building_id || facilityId || facilityUnitId || rest.unit_name) {
      await tx.residence.create({
        data: {
          org_id: orgId,
          patient_id: newPatient.id,
          address: residenceAddress,
          building_id: rest.building_id || intake?.facility_name || null,
          facility_id: facilityId,
          facility_unit_id: facilityUnitId,
          unit_name: rest.unit_name || null,
          is_primary: true,
        },
      });
    }

    if (normalizedContacts.length > 0) {
      await tx.contactParty.createMany({
        data: normalizedContacts.map((contact) => ({
          org_id: orgId,
          patient_id: newPatient.id,
          ...contact,
        })) as Prisma.ContactPartyCreateManyInput[],
      });
    }

    if (normalizedConditions.length > 0) {
      await tx.patientCondition.createMany({
        data: normalizedConditions.map((condition) => ({
          org_id: orgId,
          patient_id: newPatient.id,
          ...condition,
        })) as Prisma.PatientConditionCreateManyInput[],
      });
    }

    if (packagingMethod) {
      await tx.patientPackagingProfile.create({
        data: {
          org_id: orgId,
          patient_id: newPatient.id,
          default_packaging_method: packagingMethod,
        },
      });
    }

    if (
      intake ||
      requester ||
      facilityVisitDefaults?.acceptance_time_from ||
      facilityVisitDefaults?.acceptance_time_to
    ) {
      await tx.patientSchedulePreference.create({
        data: {
          org_id: orgId,
          patient_id: newPatient.id,
          facility_time_from: facilityVisitDefaults?.acceptance_time_from ?? null,
          facility_time_to: facilityVisitDefaults?.acceptance_time_to ?? null,
          preferred_contact_phone: preferredContactPhone,
          preferred_contact_name:
            requester?.contact_name || intake?.emergency_contact?.name || null,
          primary_contact_preference: intake?.primary_contact_preference || null,
          visit_before_contact_required: intake?.visit_before_contact_required ?? null,
          first_visit_preferred_date: intake?.first_visit_preferred_date
            ? new Date(intake.first_visit_preferred_date)
            : null,
          first_visit_time_slot: intake?.first_visit_time_slot || null,
          first_visit_time_note: intake?.first_visit_time_note || null,
          parking_available: intake?.parking_available ?? null,
          mcs_linked: intake?.mcs_linked ?? null,
          // P-09: structured intake columns
          adl_level: intake?.adl_level || null,
          dementia_level: intake?.dementia_level || null,
          swallowing_route: intake?.swallowing_route || null,
          care_level: intake?.care_level || null,
          infection_isolation: !!intake?.infection_isolation,
        },
      });

      const careCase = await tx.careCase.create({
        data: {
          org_id: orgId,
          patient_id: newPatient.id,
          referral_source: requester?.organization_name || null,
          required_visit_support: toPrismaJsonInput({
            home_visit_intake: homeVisitIntake,
          }),
        },
      });

      const careTeamLinks = normalizeCareTeamPrimaryByRole(
        [
          intake?.care_manager?.name
            ? {
                role: 'care_manager',
                name: intake.care_manager.name,
                organization_name: intake.care_manager.organization_name || null,
                phone: intake.care_manager.phone || null,
                fax: intake.care_manager.fax || null,
                is_primary: true,
              }
            : null,
          intake?.visiting_nurse?.name
            ? {
                role: 'nurse',
                name: intake.visiting_nurse.name,
                organization_name: intake.visiting_nurse.organization_name || null,
                phone: intake.visiting_nurse.phone || null,
                fax: intake.visiting_nurse.fax || null,
                is_primary: true,
              }
            : null,
        ].filter((item): item is NonNullable<typeof item> => item != null),
      );

      if (careTeamLinks.length > 0) {
        await tx.careTeamLink.createMany({
          data: careTeamLinks.map((link) => ({
            org_id: orgId,
            case_id: careCase.id,
            role: link.role,
            name: link.name,
            organization_name: link.organization_name,
            phone: link.phone,
            fax: link.fax,
            is_primary: link.is_primary,
          })),
        });
      }
    }

    return newPatient;
  });

  await notifyWebhookEventForOrg(orgId, 'patient.created', {
    patientId: patient.id,
    name: patient.name,
    ...(patient.created_at instanceof Date ? { createdAt: patient.created_at.toISOString() } : {}),
  });

  return patient;
}

export { deriveBirthDate, derivePackagingMethod, compactObject };
