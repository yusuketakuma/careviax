import type { PatientPrivacyFlags } from '@/lib/patient/privacy';
import { maskAddressDetail, maskInsuranceNumber, maskPhoneNumber } from '@/lib/patient/privacy';
import {
  emptyPatientShareSummary,
  type PatientShareSummary,
} from '@/server/services/patient-share-summary';

type PatientRiskLevel = 'stable' | 'watch' | 'high';

export type PatientRiskSummary = {
  patient_id: string;
  patient_name: string;
  score: number;
  level: PatientRiskLevel;
  reasons: string[];
  unresolved_self_reports: number;
  open_issues: number;
  disrupted_visits_30d: number;
  pending_reports: number;
  open_tasks: number;
  missing_visit_consent: boolean;
  missing_management_plan: boolean;
};

export type VisitRecord = {
  id: string;
  patient_id: string;
  visit_date: Date;
  outcome_status: string;
  created_at: Date;
};

export type VisitSchedule = {
  id: string;
  case_id: string;
  scheduled_date: Date;
  schedule_status: string;
  priority: string;
};

type PatientRow = {
  id: string;
  name: string;
  name_kana: string;
  birth_date: Date;
  gender: string;
  phone: string | null;
  medical_insurance_number: string | null;
  care_insurance_number: string | null;
  billing_support_flag: boolean;
  archived_at?: Date | null;
  residences: Array<{
    address: string | null;
    building_id: string | null;
    unit_name: string | null;
  }>;
  scheduling_preference: {
    preferred_contact_name: string | null;
    preferred_contact_phone: string | null;
    visit_before_contact_required?: boolean | null;
    parking_available: boolean | null;
    care_level: string | null;
  } | null;
  _count: { contacts: number };
  conditions: Array<{
    id: string;
    condition_type: string;
    name: string;
    is_primary: boolean;
  }>;
  contacts: Array<{
    id: string;
    is_primary?: boolean | null;
    is_emergency_contact?: boolean | null;
    phone?: string | null;
    email?: string | null;
    fax?: string | null;
  }>;
  cases: Array<{
    id: string;
    status: string;
    updated_at: Date;
    primary_pharmacist_id: string | null;
    care_team_links: Array<{
      id: string;
      role: string;
      phone?: string | null;
      email?: string | null;
      fax?: string | null;
      is_primary?: boolean | null;
    }>;
  }>;
  consents: Array<{ id: string }>;
};

const DEFAULT_RISK_SUMMARY: Omit<PatientRiskSummary, 'patient_id' | 'patient_name'> = {
  score: 0,
  level: 'stable',
  reasons: [],
  unresolved_self_reports: 0,
  open_issues: 0,
  disrupted_visits_30d: 0,
  pending_reports: 0,
  open_tasks: 0,
  missing_visit_consent: false,
  missing_management_plan: false,
};

function toPatientListContact(contact: PatientRow['contacts'][number]) {
  return {
    id: contact.id,
    is_primary: contact.is_primary ?? null,
    is_emergency_contact: contact.is_emergency_contact ?? null,
  };
}

function toPatientListCareTeamLink(link: PatientRow['cases'][number]['care_team_links'][number]) {
  return {
    id: link.id,
    role: link.role,
    is_primary: link.is_primary ?? null,
  };
}

function toPatientListCase(careCase: PatientRow['cases'][number]) {
  return {
    id: careCase.id,
    status: careCase.status,
    updated_at: careCase.updated_at,
    primary_pharmacist_id: careCase.primary_pharmacist_id,
    care_team_links: careCase.care_team_links.map(toPatientListCareTeamLink),
  };
}

function toPatientListSchedulingPreference(preference: PatientRow['scheduling_preference']) {
  if (!preference) return null;

  return {
    visit_before_contact_required: preference.visit_before_contact_required ?? null,
    parking_available: preference.parking_available ?? null,
    care_level: preference.care_level ?? null,
  };
}

export function mapPatientListItem(
  patient: PatientRow,
  riskSummary: PatientRiskSummary | undefined,
  pharmacistNameById: Map<string, string>,
  latestVisit: VisitRecord | null,
  schedules: VisitSchedule[],
  deliveredFirstVisitCaseIds: Set<string>,
  privacy: PatientPrivacyFlags,
  recentVisitThreshold: Date,
  patientShareSummary: PatientShareSummary = emptyPatientShareSummary(),
) {
  const rawLatestCase = patient.cases[0] ?? null;
  const cases = patient.cases.map(toPatientListCase);
  const latestCase = cases[0] ?? null;
  const contacts = patient.contacts.map(toPatientListContact);
  const primaryResidence = patient.residences[0] ?? null;
  const hasVisitConsent = patient.consents.length > 0;
  const hasEmergencyContact = patient.contacts.length > 0;
  const hasPrimaryPhysician = (rawLatestCase?.care_team_links.length ?? 0) > 0;
  const hasFirstVisitDocument = rawLatestCase
    ? deliveredFirstVisitCaseIds.has(rawLatestCase.id)
    : false;
  const facilityMode = primaryResidence?.building_id ? 'facility' : 'home';

  const risk: PatientRiskSummary = riskSummary ?? {
    patient_id: patient.id,
    patient_name: patient.name,
    ...DEFAULT_RISK_SUMMARY,
  };

  return {
    ...patient,
    archived_at: patient.archived_at?.toISOString() ?? null,
    archive: {
      status: patient.archived_at ? 'archived' : 'active',
      archived: Boolean(patient.archived_at),
      archived_at: patient.archived_at?.toISOString() ?? null,
    },
    contacts,
    cases,
    scheduling_preference: toPatientListSchedulingPreference(patient.scheduling_preference),
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
    facility_mode: facilityMode,
    latest_case: latestCase
      ? {
          ...latestCase,
          primary_pharmacist_name: latestCase.primary_pharmacist_id
            ? (pharmacistNameById.get(latestCase.primary_pharmacist_id) ?? null)
            : null,
        }
      : null,
    latest_visit: latestVisit,
    visit_schedules: latestCase ? schedules : [],
    consent: {
      has_visit_medication_management: hasVisitConsent,
    },
    readiness: {
      has_emergency_contact: hasEmergencyContact,
      has_primary_physician: hasPrimaryPhysician,
      has_first_visit_document: hasFirstVisitDocument,
    },
    pharmacy_share: patientShareSummary,
    risk_summary: risk,
    last_visit_bucket:
      latestVisit && latestVisit.visit_date >= recentVisitThreshold ? 'within_30_days' : 'none',
  };
}

export type MappedPatientListItem = ReturnType<typeof mapPatientListItem>;

export function buildPatientListSummary(items: MappedPatientListItem[]) {
  return {
    total: items.length,
    active_count: items.filter((p) => !p.archive.archived).length,
    archived_count: items.filter((p) => p.archive.archived).length,
    facility_count: items.filter((p) => p.facility_mode === 'facility').length,
    missing_consent_count: items.filter((p) => !p.consent.has_visit_medication_management).length,
    by_risk: {
      stable: items.filter((p) => p.risk_summary.level === 'stable').length,
      watch: items.filter((p) => p.risk_summary.level === 'watch').length,
      high: items.filter((p) => p.risk_summary.level === 'high').length,
    },
  };
}
