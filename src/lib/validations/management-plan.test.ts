import { describe, expect, it } from 'vitest';
import {
  createManagementPlanSchema,
  managementPlanContentSchema,
  updateManagementPlanSchema,
} from './management-plan';

describe('management plan write schemas', () => {
  it('bounds create versions and defaults content', () => {
    expect(
      createManagementPlanSchema.parse({
        case_id: 'case_1',
        title: '計画',
        expected_latest_version: 0,
      }).content,
    ).toEqual({});
    expect(
      createManagementPlanSchema.safeParse({
        case_id: 'case_1',
        title: '計画',
        expected_latest_version: 2_147_483_648,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown, nested, excessive, and oversized clinical content', () => {
    expect(managementPlanContentSchema.safeParse({ unknown: ['value'] }).success).toBe(false);
    expect(managementPlanContentSchema.safeParse({ goals: [{ nested: true }] }).success).toBe(
      false,
    );
    expect(
      managementPlanContentSchema.safeParse({ goals: Array.from({ length: 101 }, () => 'x') })
        .success,
    ).toBe(false);
    expect(managementPlanContentSchema.safeParse({ notes: 'x'.repeat(10_001) }).success).toBe(
      false,
    );
  });

  it('requires a mutation field and exact OCC token for update/archive', () => {
    expect(
      updateManagementPlanSchema.safeParse({
        action: 'update',
        expected_updated_at: '2026-07-17T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      updateManagementPlanSchema.safeParse({
        action: 'archive',
        expected_updated_at: '2026-07-17T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(updateManagementPlanSchema.safeParse({ action: 'approve' }).success).toBe(false);
  });

  it('keeps omitted patch content distinct from explicit empty content', () => {
    const omitted = updateManagementPlanSchema.parse({
      action: 'update',
      title: '更新',
      expected_updated_at: '2026-07-17T00:00:00.000Z',
    });
    const cleared = updateManagementPlanSchema.parse({
      action: 'update',
      content: {},
      expected_updated_at: '2026-07-17T00:00:00.000Z',
    });
    expect('content' in omitted).toBe(false);
    expect(cleared).toMatchObject({ content: {} });
  });
});
