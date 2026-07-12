import { describe, expect, it } from 'vitest';
import {
  buildPharmacistShiftsResponseSchema,
  pharmacistShiftApplyResponseSchema,
  pharmacistShiftTemplatesResponseSchema,
} from './response-schema';

const shift = {
  id: 'shift_1',
  site_id: 'site_1',
  user_id: 'user_1',
  date: '2026-06-20T00:00:00.000Z',
  available: true,
  available_from: '1970-01-01T09:00:00.000Z',
  available_to: '1970-01-01T18:00:00.000Z',
  note: null,
  user: { id: 'user_1', name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
  site: { id: 'site_1', name: '本店' },
};

describe('buildPharmacistShiftsResponseSchema', () => {
  const schema = buildPharmacistShiftsResponseSchema('2026-06');

  it('accepts the bounded provider page', () => {
    expect(schema.safeParse({ data: [shift], meta: { limit: 400, has_more: false } }).success).toBe(
      true,
    );
  });

  it('rejects cross-month, duplicate user-date, and relation identity drift', () => {
    expect(
      schema.safeParse({
        data: [{ ...shift, date: '2026-07-01T00:00:00.000Z' }],
        meta: { limit: 400, has_more: false },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: [shift, { ...shift, id: 'shift_2' }],
        meta: { limit: 400, has_more: false },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: [{ ...shift, user: { ...shift.user, id: 'user_2' } }],
        meta: { limit: 400, has_more: false },
      }).success,
    ).toBe(false);
  });
});

describe('pharmacistShiftTemplatesResponseSchema', () => {
  const template = {
    id: 'template_1',
    user_id: 'user_1',
    site_id: 'site_1',
    weekday: 1,
    available: true,
    available_from: '1970-01-01T09:00:00.000Z',
    available_to: '1970-01-01T18:00:00.000Z',
    note: null,
    user: { id: 'user_1', name: '山田 太郎' },
    site: { id: 'site_1', name: '本店' },
  };

  it('rejects duplicate user-weekday templates', () => {
    expect(
      pharmacistShiftTemplatesResponseSchema.safeParse({
        data: [template, { ...template, id: 'template_2' }],
      }).success,
    ).toBe(false);
  });
});

describe('pharmacistShiftApplyResponseSchema', () => {
  it('rejects negative applied counts and legacy roots', () => {
    expect(
      pharmacistShiftApplyResponseSchema.safeParse({ data: { applied_count: -1 } }).success,
    ).toBe(false);
    expect(pharmacistShiftApplyResponseSchema.safeParse({ applied_count: 1 }).success).toBe(false);
  });
});
