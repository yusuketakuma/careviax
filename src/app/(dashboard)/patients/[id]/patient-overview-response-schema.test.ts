import { describe, expect, it } from 'vitest';
import type { PatientOverview } from './patient-detail.types';
import { buildPatientOverviewResponseSchema } from './patient-overview-response-schema';

function buildVisitBrief(patientId: string): PatientOverview['visit_brief'] {
  return {
    patient: { id: patientId, name: '患者A' },
    context: 'patient',
    generated_at: '2026-07-13T00:00:00.000Z',
    last_prescribed_date: null,
    baseline_context: null,
    medication_changes: [],
    patient_changes: [],
    medications: [],
    dispensing_items: [],
    delivery_status: [],
    dosage_form_support: [],
    multidisciplinary_updates: [],
    jahis_supplemental_records: [],
    latest_labs: [],
    unresolved_items: [],
    must_check_today: [],
    rule_summary: {
      generation_id: 'rule_1',
      headline: '確認事項なし',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-07-13T00:00:00.000Z',
    },
    ai_summary: {
      generation_id: 'ai_1',
      provider: 'rule',
      requested_provider: 'disabled',
      is_fallback: true,
      model: null,
      fallback_reason: null,
      headline: '確認事項なし',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-07-13T00:00:00.000Z',
      duration_ms: null,
      recent_generation_count_24h: 0,
      recent_failure_count_24h: 0,
      recent_failure_rate_24h: null,
    },
    conference_summary: null,
    facility_context: null,
    drug_cautions: [],
  };
}

function buildResponse(patientId = 'patient_1'): { data: PatientOverview } {
  return {
    data: {
      id: patientId,
      name: '患者A',
      name_kana: 'カンジャエー',
      birth_date: '1940-01-01T00:00:00.000Z',
      gender: 'other',
      phone: null,
      medical_insurance_number: null,
      care_insurance_number: null,
      billing_support_flag: false,
      primary_pharmacist_id: null,
      backup_pharmacist_id: null,
      primary_staff_id: null,
      backup_staff_id: null,
      allergy_info: [],
      notes: null,
      archived_at: null,
      archived_by: null,
      archived_by_name: null,
      updated_at: '2026-07-13T00:00:00.000Z',
      residences: [],
      scheduling_preference: null,
      conditions: [],
      contacts: [],
      cases: [],
      visit_schedules: [],
      summary_metrics: { open_tasks_count: 0 },
      risk_summary: null,
      visit_brief: buildVisitBrief(patientId),
      lab_summary: [],
      foundation: {
        summary: { status: 'ready', label: '確認済み', items: [] },
        items: [],
        changes_since_last_visit: [],
        latest_labs: [],
        insurances: [],
        archive: { archived: false, archived_at: null, archived_by_name: null },
      },
      jahis_supplemental_records: [],
      workspace: null,
      privacy: {
        sensitive_fields_masked: false,
        address_fields_masked: false,
        can_view_detail: true,
      },
    },
  };
}

describe('patient overview response schema', () => {
  it('accepts a complete provider response', () => {
    expect(buildPatientOverviewResponseSchema('patient_1').safeParse(buildResponse()).success).toBe(
      true,
    );
  });

  it('rejects cross-patient nested visit brief context', () => {
    const response = buildResponse();
    response.data.visit_brief.patient.id = 'patient_2';
    expect(buildPatientOverviewResponseSchema('patient_1').safeParse(response).success).toBe(false);
  });

  it('rejects unknown provider fields and duplicate identities', () => {
    const response = buildResponse() as ReturnType<typeof buildResponse> & {
      data: ReturnType<typeof buildResponse>['data'] & { secret_field?: string };
    };
    response.data.secret_field = 'must not enter query state';
    expect(buildPatientOverviewResponseSchema('patient_1').safeParse(response).success).toBe(false);
    delete response.data.secret_field;
    response.data.contacts = [
      {
        id: 'contact_1',
        relation: 'other',
        name: '連絡先',
        phone: null,
        email: null,
        fax: null,
        organization_name: null,
        department: null,
        address: null,
        is_primary: false,
        is_emergency_contact: false,
        notes: null,
      },
      {
        id: 'contact_1',
        relation: 'other',
        name: '重複連絡先',
        phone: null,
        email: null,
        fax: null,
        organization_name: null,
        department: null,
        address: null,
        is_primary: false,
        is_emergency_contact: false,
        notes: null,
      },
    ];
    expect(buildPatientOverviewResponseSchema('patient_1').safeParse(response).success).toBe(false);
  });
});
