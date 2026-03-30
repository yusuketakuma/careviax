import { endOfDay, parseISO, startOfDay, subDays } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { buildSearchFilter, buildSort } from '@/lib/api/search';
import { parseSearchParams } from '@/lib/api/validation';
import { createPatientSchema } from '@/lib/validations/patient';
import { prisma } from '@/lib/db/client';
import {
  assertFacilityReference,
  getFacilityVisitDefaults,
} from '@/lib/patient/facility-reference';
import { listPatientRiskSummaries } from '@/server/services/patient-risk';
import { z } from 'zod';

const patientListQuerySchema = z.object({
  q: z.string().trim().optional(),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  sort: z.enum(['name_kana', 'name', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  facility_mode: z.enum(['facility', 'home']).optional(),
  consent_status: z.enum(['complete', 'missing']).optional(),
  risk_level: z.enum(['stable', 'watch', 'high']).optional(),
  last_visit: z.enum(['within_30_days', 'none']).optional(),
  case_status: z.string().trim().optional(),
  primary_pharmacist_id: z.string().trim().optional(),
  building_id: z.string().trim().optional(),
  billing_support: z.enum(['true', 'false']).optional(),
  payer_basis: z.enum(['medical', 'care', 'self']).optional(),
  last_visit_from: z.string().date().optional(),
  last_visit_to: z.string().date().optional(),
});

type PatientRiskLevel = 'stable' | 'watch' | 'high';

function buildPatientSelect(referenceDate: Date) {
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
    contacts: {
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      take: 3,
      select: {
        name: true,
        organization_name: true,
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
      select: {
        id: true,
        status: true,
        updated_at: true,
        primary_pharmacist_id: true,
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
        consent_type: true,
        expiry_date: true,
      },
      take: 5,
    },
  } satisfies Prisma.PatientSelect;
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function maskPhone(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-****-${digits.slice(-4)}`;
}

function maskInsurance(value: string | null) {
  if (!value) return null;
  if (value.length <= 3) return '***';
  return `***-${value.slice(-3)}`;
}

function deriveBirthDate(rawBirthDate: string | undefined, reportedAge?: number) {
  if (rawBirthDate) return rawBirthDate;
  if (typeof reportedAge === 'number' && Number.isFinite(reportedAge)) {
    const today = new Date();
    return new Date(today.getFullYear() - reportedAge, 0, 1).toISOString().slice(0, 10);
  }
  return undefined;
}

function derivePackagingMethod(intake?: {
  medication_support_methods?: string[];
}) {
  const methods = intake?.medication_support_methods ?? [];
  if (methods.includes('unit_dose')) return 'unit_dose';
  if (methods.includes('calendar')) return 'calendar_pack';
  if (methods.includes('box')) return 'medication_box';
  if (methods.includes('crush')) return 'crush_and_pack';
  return null;
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const parsed = parseSearchParams(patientListQuerySchema, searchParams);
  if (!parsed.ok) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
  }

  const limit = parsed.data.limit ?? 50;
  const query = parsed.data.q ?? '';
  const cursor = parsed.data.cursor;
  const referenceDate = new Date();
  const primarySort = buildSort(
    parsed.data.sort,
    parsed.data.order,
    ['name_kana', 'name', 'created_at'],
    'name_kana'
  );

  const patients = await prisma.patient.findMany({
    where: {
      org_id: req.orgId,
      ...buildSearchFilter(query, ['name', 'name_kana']),
    },
    orderBy:
      parsed.data.sort === 'name'
        ? [primarySort ?? { name_kana: 'asc' }, { name_kana: 'asc' }]
        : [primarySort ?? { name_kana: 'asc' }, { name: 'asc' }],
    select: buildPatientSelect(referenceDate),
  });

  const patientIds = patients.map((patient) => patient.id);
  const latestCaseIds = Array.from(
    new Set(
      patients
        .map((patient) => patient.cases[0]?.id)
        .filter((value): value is string => Boolean(value))
    )
  );
  const primaryPharmacistIds = Array.from(
    new Set(
      patients
        .map((patient) => patient.cases[0]?.primary_pharmacist_id)
        .filter((value): value is string => Boolean(value))
    )
  );

  const [riskSummaries, pharmacists, visitRecords, visitSchedules] = await Promise.all([
    listPatientRiskSummaries(prisma, {
      orgId: req.orgId,
      patientIds,
      includeStable: true,
    }),
    primaryPharmacistIds.length === 0
      ? Promise.resolve([])
      : prisma.user.findMany({
          where: {
            id: { in: primaryPharmacistIds },
          },
          select: {
            id: true,
            name: true,
          },
        }),
    patientIds.length === 0
      ? Promise.resolve([])
      : prisma.visitRecord.findMany({
          where: {
            org_id: req.orgId,
            patient_id: { in: patientIds },
          },
          orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
          select: {
            id: true,
            patient_id: true,
            visit_date: true,
            outcome_status: true,
            created_at: true,
          },
        }),
    latestCaseIds.length === 0
      ? Promise.resolve([])
      : prisma.visitSchedule.findMany({
          where: {
            org_id: req.orgId,
            case_id: { in: latestCaseIds },
          },
          orderBy: [{ scheduled_date: 'asc' }],
          select: {
            id: true,
            case_id: true,
            scheduled_date: true,
            schedule_status: true,
            priority: true,
          },
        }),
  ]);

  const riskByPatientId = new Map(riskSummaries.map((risk) => [risk.patient_id, risk]));
  const pharmacistNameById = new Map(pharmacists.map((user) => [user.id, user.name]));
  const latestVisitByPatientId = new Map<string, (typeof visitRecords)[number]>();
  for (const visitRecord of visitRecords) {
    if (!latestVisitByPatientId.has(visitRecord.patient_id)) {
      latestVisitByPatientId.set(visitRecord.patient_id, visitRecord);
    }
  }
  const visitSchedulesByCaseId = new Map<string, Array<(typeof visitSchedules)[number]>>();
  for (const visitSchedule of visitSchedules) {
    const entries = visitSchedulesByCaseId.get(visitSchedule.case_id) ?? [];
    if (entries.length < 3) {
      entries.push(visitSchedule);
      visitSchedulesByCaseId.set(visitSchedule.case_id, entries);
    }
  }
  const sensitiveFieldsMasked = req.role === 'clerk';
  const recentVisitThreshold = subDays(new Date(), 30);

  const enriched = patients.map((patient) => {
    const primaryResidence = patient.residences[0] ?? null;
    const latestCase = patient.cases[0] ?? null;
    const latestVisit = latestVisitByPatientId.get(patient.id) ?? null;
    const riskSummary =
      riskByPatientId.get(patient.id) ??
      {
        patient_id: patient.id,
        patient_name: patient.name,
        score: 0,
        level: 'stable' as PatientRiskLevel,
        reasons: [],
        unresolved_self_reports: 0,
        open_issues: 0,
        disrupted_visits_30d: 0,
        pending_reports: 0,
        open_tasks: 0,
        missing_visit_consent: false,
        missing_management_plan: false,
      };
    const hasVisitConsent = patient.consents.length > 0;
    const facilityMode = primaryResidence?.building_id ? 'facility' : 'home';

    return {
      ...patient,
      phone: sensitiveFieldsMasked ? maskPhone(patient.phone) : patient.phone,
      medical_insurance_number: sensitiveFieldsMasked
        ? maskInsurance(patient.medical_insurance_number)
        : patient.medical_insurance_number,
      care_insurance_number: sensitiveFieldsMasked
        ? maskInsurance(patient.care_insurance_number)
        : patient.care_insurance_number,
      facility_mode: facilityMode,
      latest_case: latestCase
        ? {
            ...latestCase,
            primary_pharmacist_name: latestCase.primary_pharmacist_id
              ? pharmacistNameById.get(latestCase.primary_pharmacist_id) ?? null
              : null,
          }
        : null,
      latest_visit: latestVisit,
      visit_schedules: latestCase ? (visitSchedulesByCaseId.get(latestCase.id) ?? []) : [],
      consent: {
        has_visit_medication_management: hasVisitConsent,
      },
      risk_summary: riskSummary,
      last_visit_bucket:
        latestVisit && latestVisit.visit_date >= recentVisitThreshold
          ? 'within_30_days'
          : 'none',
    };
  });

  const filtered = enriched.filter((patient) => {
    const latestCase = patient.latest_case;
    const latestVisitDate = patient.latest_visit?.visit_date ?? null;
    const requestedCaseStatuses = parsed.data.case_status
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (requestedCaseStatuses?.length) {
      if (!latestCase || !requestedCaseStatuses.includes(latestCase.status)) {
        return false;
      }
    }
    if (
      parsed.data.primary_pharmacist_id &&
      latestCase?.primary_pharmacist_id !== parsed.data.primary_pharmacist_id
    ) {
      return false;
    }
    if (
      parsed.data.building_id &&
      (patient.residences[0]?.building_id ?? null) !== parsed.data.building_id
    ) {
      return false;
    }
    if (
      parsed.data.billing_support &&
      patient.billing_support_flag !== (parsed.data.billing_support === 'true')
    ) {
      return false;
    }
    if (parsed.data.payer_basis) {
      const payerBasis =
        patient.medical_insurance_number
          ? 'medical'
          : patient.care_insurance_number
            ? 'care'
            : 'self';
      if (payerBasis !== parsed.data.payer_basis) {
        return false;
      }
    }
    if (parsed.data.facility_mode && patient.facility_mode !== parsed.data.facility_mode) {
      return false;
    }
    if (
      parsed.data.consent_status === 'complete' &&
      !patient.consent.has_visit_medication_management
    ) {
      return false;
    }
    if (
      parsed.data.consent_status === 'missing' &&
      patient.consent.has_visit_medication_management
    ) {
      return false;
    }
    if (parsed.data.risk_level && patient.risk_summary.level !== parsed.data.risk_level) {
      return false;
    }
    if (
      parsed.data.last_visit_from &&
      (!latestVisitDate || latestVisitDate < startOfDay(parseISO(parsed.data.last_visit_from)))
    ) {
      return false;
    }
    if (
      parsed.data.last_visit_to &&
      (!latestVisitDate || latestVisitDate > endOfDay(parseISO(parsed.data.last_visit_to)))
    ) {
      return false;
    }
    if (parsed.data.last_visit && patient.last_visit_bucket !== parsed.data.last_visit) {
      return false;
    }
    return true;
  });

  const summary = {
    total: filtered.length,
    facility_count: filtered.filter((patient) => patient.facility_mode === 'facility').length,
    missing_consent_count: filtered.filter(
      (patient) => !patient.consent.has_visit_medication_management
    ).length,
    by_risk: {
      stable: filtered.filter((patient) => patient.risk_summary.level === 'stable').length,
      watch: filtered.filter((patient) => patient.risk_summary.level === 'watch').length,
      high: filtered.filter((patient) => patient.risk_summary.level === 'high').length,
    },
  };

  const cursorIndex = cursor ? filtered.findIndex((patient) => patient.id === cursor) : -1;
  const paginated = cursorIndex >= 0 ? filtered.slice(cursorIndex + 1) : filtered;
  const hasMore = paginated.length > limit;
  const data = hasMore ? paginated.slice(0, limit) : paginated;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({
    data,
    hasMore,
    nextCursor,
    summary,
    privacy: {
      sensitive_fields_masked: sensitiveFieldsMasked,
      can_view_detail: true,
    },
  });
}, {
  permission: 'canVisit',
  message: '患者情報の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return validationError('リクエストボディが不正です');
  }

  const raw = body as Record<string, unknown>;
  const rawIntake =
    raw.intake && typeof raw.intake === 'object'
      ? (raw.intake as Record<string, unknown>)
      : undefined;
  const normalizedBody = {
    ...raw,
    name_kana:
      typeof raw.name_kana === 'string' && raw.name_kana.trim().length > 0
        ? raw.name_kana
        : raw.name,
    birth_date:
      typeof raw.birth_date === 'string'
        ? raw.birth_date
        : deriveBirthDate(
            undefined,
            typeof rawIntake?.age === 'number' ? rawIntake.age : undefined
          ),
  };

  const parsed = createPatientSchema.safeParse(normalizedBody);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { address, birth_date, ...rest } = parsed.data;
  const intake = rest.intake;
  const requester = rest.requester;

  const normalizedContacts =
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
    normalizedContacts.push({
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
    narcotics_base: intake?.narcotics_base,
    narcotics_rescue: intake?.narcotics_rescue,
    allergy_history: intake?.allergy_history,
    infection_isolation: intake?.infection_isolation,
    swallowing_route: intake?.swallowing_route,
    residual_medication_status: intake?.residual_medication_status,
    other_clinical_notes: intake?.other_clinical_notes,
    special_medical_procedures: intake?.special_medical_procedures,
    special_medical_notes: intake?.special_medical_notes,
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

  const patient = await withOrgContext(req.orgId, async (tx) => {
    await assertFacilityReference(tx, req.orgId, rest.facility_id ?? null);
    const facilityVisitDefaults = await getFacilityVisitDefaults(
      tx,
      req.orgId,
      rest.facility_id ?? null
    );

    const newPatient = await tx.patient.create({
      data: {
        org_id: req.orgId,
        birth_date: new Date(birth_date),
        name: rest.name,
        name_kana: rest.name_kana,
        gender: rest.gender,
        phone: preferredContactPhone,
        medical_insurance_number: rest.medical_insurance_number || null,
        care_insurance_number: rest.care_insurance_number || null,
        allergy_info: rest.allergy_info ?? undefined,
        notes: rest.notes || null,
      },
    });

    if (address) {
      await tx.residence.create({
        data: {
          org_id: req.orgId,
          patient_id: newPatient.id,
          address,
          building_id: rest.building_id || intake?.facility_name || null,
          facility_id: rest.facility_id || null,
          facility_unit_id: rest.facility_unit_id || null,
          unit_name: rest.unit_name || null,
          is_primary: true,
        },
      });
    }

    if (normalizedContacts.length > 0) {
      await tx.contactParty.createMany({
        data: normalizedContacts.map((contact) => ({
          org_id: req.orgId,
          patient_id: newPatient.id,
          ...contact,
        })),
      });
    }

    if (normalizedConditions.length > 0) {
      await tx.patientCondition.createMany({
        data: normalizedConditions.map((condition) => ({
          org_id: req.orgId,
          patient_id: newPatient.id,
          ...condition,
        })),
      });
    }

    if (packagingMethod) {
      await tx.patientPackagingProfile.create({
        data: {
          org_id: req.orgId,
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
          org_id: req.orgId,
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
        },
      });

      const careCase = await tx.careCase.create({
        data: {
          org_id: req.orgId,
          patient_id: newPatient.id,
          referral_source: requester?.organization_name || null,
          required_visit_support: {
            home_visit_intake: homeVisitIntake,
          } as Prisma.InputJsonValue,
        },
      });

      const careTeamLinks = [
        intake?.care_manager?.name
          ? {
              role: 'care_manager',
              name: intake.care_manager.name,
              organization_name: intake.care_manager.organization_name || null,
              phone: intake.care_manager.phone || null,
              fax: intake.care_manager.fax || null,
            }
          : null,
        intake?.visiting_nurse?.name
          ? {
              role: 'nurse',
              name: intake.visiting_nurse.name,
              organization_name: intake.visiting_nurse.organization_name || null,
              phone: intake.visiting_nurse.phone || null,
              fax: intake.visiting_nurse.fax || null,
            }
          : null,
      ].filter((item): item is NonNullable<typeof item> => item != null);

      if (careTeamLinks.length > 0) {
        await tx.careTeamLink.createMany({
          data: careTeamLinks.map((link) => ({
            org_id: req.orgId,
            case_id: careCase.id,
            role: link.role,
            name: link.name,
            organization_name: link.organization_name,
            phone: link.phone,
            fax: link.fax,
          })),
        });
      }
    }

    return newPatient;
  });

  return success(patient, 201);
}, {
  permission: 'canVisit',
  message: '患者情報の作成権限がありません',
});
