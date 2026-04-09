import type { PatientPrivacyFlags } from '@/lib/patient/privacy';
import {
  maskAddressDetail,
  maskInsuranceNumber,
  maskPhoneNumber,
} from '@/lib/patient/privacy';

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
  residences: Array<{
    address: string | null;
    building_id: string | null;
    unit_name: string | null;
  }>;
  _count: { contacts: number };
  conditions: Array<{
    id: string;
    condition_type: string;
    name: string;
    is_primary: boolean;
  }>;
  contacts: Array<{
    id: string;
  }>;
  cases: Array<{
    id: string;
    status: string;
    updated_at: Date;
    primary_pharmacist_id: string | null;
    care_team_links: Array<{
      id: string;
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

export function mapPatientListItem(
  patient: PatientRow,
  riskSummary: PatientRiskSummary | undefined,
  pharmacistNameById: Map<string, string>,
  latestVisit: VisitRecord | null,
  schedules: VisitSchedule[],
  deliveredFirstVisitCaseIds: Set<string>,
  privacy: PatientPrivacyFlags,
  recentVisitThreshold: Date,
) {
  const latestCase = patient.cases[0] ?? null;
  const primaryResidence = patient.residences[0] ?? null;
  const hasVisitConsent = patient.consents.length > 0;
  const hasEmergencyContact = patient.contacts.length > 0;
  const hasPrimaryPhysician = (latestCase?.care_team_links.length ?? 0) > 0;
  const hasFirstVisitDocument = latestCase
    ? deliveredFirstVisitCaseIds.has(latestCase.id)
    : false;
  const facilityMode = primaryResidence?.building_id ? 'facility' : 'home';

  const risk: PatientRiskSummary = riskSummary ?? {
    patient_id: patient.id,
    patient_name: patient.name,
    ...DEFAULT_RISK_SUMMARY,
  };

  return {
    ...patient,
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
            ? pharmacistNameById.get(latestCase.primary_pharmacist_id) ?? null
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
    risk_summary: risk,
    last_visit_bucket:
      latestVisit && latestVisit.visit_date >= recentVisitThreshold
        ? 'within_30_days'
        : 'none',
  };
}

export type MappedPatientListItem = ReturnType<typeof mapPatientListItem>;

export function buildPatientListSummary(items: MappedPatientListItem[]) {
  return {
    total: items.length,
    facility_count: items.filter((p) => p.facility_mode === 'facility').length,
    missing_consent_count: items.filter(
      (p) => !p.consent.has_visit_medication_management,
    ).length,
    by_risk: {
      stable: items.filter((p) => p.risk_summary.level === 'stable').length,
      watch: items.filter((p) => p.risk_summary.level === 'watch').length,
      high: items.filter((p) => p.risk_summary.level === 'high').length,
    },
  };
}
