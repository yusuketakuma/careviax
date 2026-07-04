import { describe, expect, it } from 'vitest';
import { structuredSoapInputSchema } from './structured-soap';

describe('structuredSoapInputSchema', () => {
  it('accepts full and partial structured SOAP payloads for backward compatibility', () => {
    expect(structuredSoapInputSchema.safeParse({ subjective: {}, objective: {} }).success).toBe(
      true,
    );
    expect(
      structuredSoapInputSchema.safeParse({
        subjective: { symptom_checks: ['眠気'], free_text: '本人申告あり' },
        objective: {
          medication_status: '服薬継続',
          adherence_score: 4,
          side_effect_checks: ['ふらつきなし'],
          lab_values: { egfr: 45 },
        },
        assessment: { problem_checks: [] },
        plan: { intervention_checks: [], next_visit_date: '2026-06-19' },
      }).success,
    ).toBe(true);
  });

  it('rejects malformed known sections while allowing unknown extension keys', () => {
    expect(
      structuredSoapInputSchema.safeParse({
        objective: 'not-object',
      }).success,
    ).toBe(false);
    expect(
      structuredSoapInputSchema.safeParse({
        objective: { adherence_score: 9 },
      }).success,
    ).toBe(false);
    expect(
      structuredSoapInputSchema.safeParse({
        extension_payload: { vendor: 'local' },
      }).success,
    ).toBe(true);
  });

  it('accepts structured special-patient status capture entries', () => {
    const parsed = structuredSoapInputSchema.safeParse({
      special_patient_statuses: [
        {
          status_type: 'home_central_venous_nutrition',
          evidence_summary: '中心静脈栄養法の継続管理を確認',
          set_by: 'user_1',
          set_at: '2026-07-04T00:20:00.000Z',
          valid_from: '2026-07-01',
          valid_to: null,
          local_note: 'optional provenance',
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects malformed special-patient status fields when the known section is present', () => {
    expect(
      structuredSoapInputSchema.safeParse({
        special_patient_statuses: [
          {
            status_type: 'unknown_status',
            evidence_summary: '確認',
            set_at: '2026-07-04T00:20:00.000Z',
            valid_from: '2026-07-01',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      structuredSoapInputSchema.safeParse({
        special_patient_statuses: [
          {
            status_type: 'terminal_cancer',
            evidence_summary: '',
            set_at: 'not-a-date',
            valid_from: '2026/07/01',
          },
        ],
      }).success,
    ).toBe(false);
  });
});
