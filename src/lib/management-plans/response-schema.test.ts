import { describe, expect, it } from 'vitest';
import {
  managementPlanListResponseSchema,
  managementPlanReadContentSchema,
  presentManagementPlanDetail,
} from './response-schema';

function legacyContentWithJsonBytes(targetBytes: number) {
  const content = Object.fromEntries(
    Array.from({ length: 7 }, (_, index) => [`k${index}`, '']),
  ) as Record<string, string>;
  const structuralBytes = new TextEncoder().encode(JSON.stringify(content)).byteLength;
  let remaining = targetBytes - structuralBytes;
  for (const key of Object.keys(content)) {
    const length = Math.min(10_000, remaining);
    content[key] = 'x'.repeat(length);
    remaining -= length;
  }
  if (remaining !== 0) throw new Error(`Cannot construct ${targetBytes}-byte legacy content`);
  return content;
}

describe('management plan response schemas', () => {
  it('accepts bounded flat historical content', () => {
    expect(
      managementPlanReadContentSchema.parse({
        legacy_note: '継続',
        score: 1,
        active: true,
        goals: ['確認'],
      }),
    ).toMatchObject({ legacy_note: '継続', score: 1 });
  });

  it.each([
    { nested: { unsafe: true } },
    { array: [1, 2] },
    Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`k${index}`, 'x'])),
    { notes: 'x'.repeat(65_536) },
  ])('rejects malformed or oversized historical content', (content) => {
    expect(managementPlanReadContentSchema.safeParse(content).success).toBe(false);
  });

  it('enforces the aggregate UTF-8 JSON boundary independently of per-value limits', () => {
    const atLimit = legacyContentWithJsonBytes(64 * 1024);
    const overLimit = legacyContentWithJsonBytes(64 * 1024 + 1);

    expect(Object.values(atLimit).every((value) => value.length <= 10_000)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(atLimit))).toHaveLength(64 * 1024);
    expect(managementPlanReadContentSchema.safeParse(atLimit).success).toBe(true);
    expect(managementPlanReadContentSchema.safeParse(overLimit).success).toBe(false);
  });

  it('presents dates and excludes internal actor fields', () => {
    const value = presentManagementPlanDetail({
      id: 'plan_1',
      case_id: 'case_1',
      title: '計画',
      summary: null,
      content: {},
      status: 'draft',
      version: 1,
      effective_from: null,
      next_review_date: null,
      approved_at: null,
      updated_at: new Date('2026-07-17T00:00:00.000Z'),
    });
    expect(value.updated_at).toBe('2026-07-17T00:00:00.000Z');
    expect(value).not.toHaveProperty('created_by');
    expect(value).not.toHaveProperty('approved_by');
  });

  it('requires a bounded page meta envelope', () => {
    expect(managementPlanListResponseSchema.safeParse({ data: [] }).success).toBe(false);
    expect(
      managementPlanListResponseSchema.safeParse({
        data: [],
        meta: { has_more: false, next_cursor: null },
      }).success,
    ).toBe(true);
  });
});
