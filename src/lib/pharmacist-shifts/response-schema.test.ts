import { describe, expect, it } from 'vitest';
import {
  buildPharmacistShiftCollectionSchema,
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
    expect(
      schema.safeParse({
        data: [shift],
        meta: { limit: 400, has_more: false, next_cursor: null },
      }).success,
    ).toBe(true);
  });

  it('rejects cross-month, duplicate user-date, and relation identity drift', () => {
    expect(
      schema.safeParse({
        data: [{ ...shift, date: '2026-07-01T00:00:00.000Z' }],
        meta: { limit: 400, has_more: false, next_cursor: null },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: [shift, { ...shift, id: 'shift_2' }],
        meta: { limit: 400, has_more: false, next_cursor: null },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: [{ ...shift, user: { ...shift.user, id: 'user_2' } }],
        meta: { limit: 400, has_more: false, next_cursor: null },
      }).success,
    ).toBe(false);
  });

  it('requires strict matching continuation metadata', () => {
    expect(
      schema.safeParse({
        data: [shift],
        meta: { limit: 400, has_more: true, next_cursor: 'cursor_400' },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        data: [shift],
        meta: { limit: 400, has_more: true, next_cursor: null },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: [shift],
        meta: { limit: 400, has_more: false, next_cursor: 'cursor_400' },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: [shift],
        meta: { limit: 400, has_more: false, next_cursor: null, total: 1 },
      }).success,
    ).toBe(false);
  });

  it('enforces date, nullable-time, and id ordering', () => {
    const earlierId = {
      ...shift,
      id: 'shift_0',
      user_id: 'user_0',
      user: { ...shift.user, id: 'user_0' },
    };
    const nullTime = {
      ...shift,
      id: 'shift_2',
      user_id: 'user_2',
      user: { ...shift.user, id: 'user_2' },
      available_from: null,
      available_to: null,
    };
    const meta = { limit: 400 as const, has_more: false, next_cursor: null };

    expect(schema.safeParse({ data: [earlierId, shift, nullTime], meta }).success).toBe(true);
    expect(schema.safeParse({ data: [shift, earlierId], meta }).success).toBe(false);
    expect(schema.safeParse({ data: [nullTime, shift], meta }).success).toBe(false);
  });

  it('validates duplicate and ordering invariants across aggregated pages', () => {
    const collection = buildPharmacistShiftCollectionSchema('2026-06');
    const later = {
      ...shift,
      id: 'shift_2',
      user_id: 'user_2',
      user: { ...shift.user, id: 'user_2' },
      available_from: null,
      available_to: null,
    };

    expect(collection.safeParse([shift, later]).success).toBe(true);
    expect(collection.safeParse([shift, { ...later, id: shift.id }]).success).toBe(false);
    expect(
      collection.safeParse([shift, { ...later, user_id: shift.user_id, user: { ...shift.user } }])
        .success,
    ).toBe(false);
    expect(collection.safeParse([later, shift]).success).toBe(false);
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
