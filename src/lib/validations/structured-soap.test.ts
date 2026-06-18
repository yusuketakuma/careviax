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
});
