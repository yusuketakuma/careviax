import { describe, expect, it } from 'vitest';
import { buildPatientVisitBriefResponseSchema } from './visit-brief-response-schema';

function brief(overrides: Record<string, unknown> = {}) {
  return {
    patient: {
      id: 'patient_1',
      name: '患者A',
      archive: { status: 'active', archived: false, archived_at: null },
    },
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
      headline: 'ルール要約',
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
      fallback_reason: 'provider_unavailable',
      headline: 'AI要約',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-07-13T00:00:00.000Z',
      duration_ms: null,
      recent_generation_count_24h: 1,
      recent_failure_count_24h: 1,
      recent_failure_rate_24h: 100,
    },
    conference_summary: null,
    facility_context: null,
    drug_cautions: [],
    ...overrides,
  };
}

describe('patient visit brief response schema', () => {
  it('accepts a complete patient-scoped brief', () => {
    expect(
      buildPatientVisitBriefResponseSchema('patient_1').parse({ data: brief() }).data.patient.id,
    ).toBe('patient_1');
  });

  it.each([
    [
      'another patient',
      brief({
        patient: {
          id: 'patient_2',
          name: '患者B',
          archive: { status: 'active', archived: false, archived_at: null },
        },
      }),
    ],
    ['missing archive state', brief({ patient: { id: 'patient_1', name: '患者A' } })],
    ['schedule context', brief({ context: 'schedule' })],
    [
      'unsafe action URL',
      brief({
        unresolved_items: [
          {
            source_type: 'task',
            title: '確認',
            summary: '確認が必要です',
            severity: 'high',
            href: 'https://evil.example/patient',
          },
        ],
      }),
    ],
    [
      'AI failure aggregate drift',
      brief({
        ai_summary: {
          ...brief().ai_summary,
          recent_generation_count_24h: 1,
          recent_failure_count_24h: 2,
        },
      }),
    ],
    [
      'AI failure rate drift',
      brief({
        ai_summary: {
          ...brief().ai_summary,
          recent_failure_rate_24h: 50,
        },
      }),
    ],
  ])('rejects %s', (_label, data) => {
    expect(buildPatientVisitBriefResponseSchema('patient_1').safeParse({ data }).success).toBe(
      false,
    );
  });

  it('rejects duplicate clinical identities', () => {
    const lab = {
      analyte_code: 'egfr',
      analyte_label: 'eGFR',
      value_numeric: 42,
      unit: 'mL/min',
      value_label: '42 mL/min',
      measured_at: '2026-07-01T00:00:00.000Z',
      measured_at_label: '2026/07/01',
      stale: false,
      abnormal: true,
      abnormal_flag: 'L',
    };
    expect(
      buildPatientVisitBriefResponseSchema('patient_1').safeParse({
        data: brief({ latest_labs: [lab, lab] }),
      }).success,
    ).toBe(false);
  });
});
