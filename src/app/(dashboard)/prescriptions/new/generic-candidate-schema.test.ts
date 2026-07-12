import { describe, expect, it } from 'vitest';
import { genericCandidatesResponseSchema } from './generic-candidate-schema';

const CANDIDATE = {
  id: 'drug_generic_1',
  yj_code: '2171014F1020',
  drug_name: 'アムロジピン錠5mg「後発」',
  generic_name: 'アムロジピンベシル酸塩',
  dosage_form: '錠剤',
  drug_price: 9.8,
  unit: '錠',
  is_generic: true,
  generic_price_comparison: {
    standard_name: 'アムロジピン錠5mg',
    lowest_price: '8.7',
    source_row: { patient_id: 'provider-only' },
  },
  manufacturer: 'provider-only',
  stock_config: { org_id: 'provider-only' },
};

describe('genericCandidatesResponseSchema', () => {
  it('projects only fields used for medication candidate selection and price comparison', () => {
    const parsed = genericCandidatesResponseSchema.parse({
      data: [CANDIDATE],
      meta: { has_more: false, next_cursor: null },
    });

    expect(parsed.data[0]).not.toHaveProperty('manufacturer');
    expect(parsed.data[0]).not.toHaveProperty('stock_config');
    expect(parsed.data[0].generic_price_comparison).not.toHaveProperty('source_row');
  });

  it.each([
    ['legacy root', [CANDIDATE]],
    [
      'non-generic candidate',
      {
        data: [{ ...CANDIDATE, is_generic: false }],
        meta: { has_more: false, next_cursor: null },
      },
    ],
    [
      'negative drug price',
      {
        data: [{ ...CANDIDATE, drug_price: -1 }],
        meta: { has_more: false, next_cursor: null },
      },
    ],
    [
      'malformed lowest price',
      {
        data: [
          {
            ...CANDIDATE,
            generic_price_comparison: { lowest_price: 'not-a-number' },
          },
        ],
        meta: { has_more: false, next_cursor: null },
      },
    ],
    [
      'duplicate YJ code',
      {
        data: [CANDIDATE, { ...CANDIDATE, id: 'drug_generic_2' }],
        meta: { has_more: false, next_cursor: null },
      },
    ],
    ['cursor mismatch', { data: [CANDIDATE], meta: { has_more: true, next_cursor: null } }],
  ])('rejects %s', (_label, payload) => {
    expect(genericCandidatesResponseSchema.safeParse(payload).success).toBe(false);
  });
});
