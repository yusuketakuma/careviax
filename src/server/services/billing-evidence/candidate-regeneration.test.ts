import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  persistRegeneratedBillingCandidate,
  resolveRegeneratedCandidateStatus,
  type RegeneratedBillingCandidateRecord,
  type RegeneratedBillingCandidateTx,
} from './candidate-regeneration';

function buildSnapshot(workflow: Prisma.JsonObject): Prisma.JsonObject {
  return { billing_close: workflow };
}

function buildExisting(
  overrides: Partial<RegeneratedBillingCandidateRecord> = {},
): RegeneratedBillingCandidateRecord {
  return {
    id: 'cand-1',
    dedupe_key: 'dedupe-1',
    status: 'candidate',
    updated_at: new Date('2026-06-18T00:00:00.000Z'),
    source_snapshot: null,
    ...overrides,
  };
}

describe('resolveRegeneratedCandidateStatus', () => {
  it('returns the proposed status when no existing record is present', () => {
    expect(resolveRegeneratedCandidateStatus(undefined, 'candidate')).toBe('candidate');
  });

  it('returns "exported" when the existing record status is already exported', () => {
    const existing = buildExisting({ status: 'exported', source_snapshot: null });
    expect(resolveRegeneratedCandidateStatus(existing, 'candidate')).toBe('exported');
  });

  it('returns "exported" when the workflow snapshot has closed_at set', () => {
    const existing = buildExisting({
      status: 'candidate',
      source_snapshot: buildSnapshot({ closed_at: '2026-06-18T01:00:00.000Z' }),
    });
    expect(resolveRegeneratedCandidateStatus(existing, 'candidate')).toBe('exported');
  });

  it('returns "confirmed" when the workflow is reviewed and confirmed', () => {
    const existing = buildExisting({
      status: 'candidate',
      source_snapshot: buildSnapshot({
        review_state: 'reviewed',
        resolution_state: 'confirmed',
      }),
    });
    expect(resolveRegeneratedCandidateStatus(existing, 'candidate')).toBe('confirmed');
  });

  it('returns "excluded" when the workflow is reviewed and excluded', () => {
    const existing = buildExisting({
      status: 'candidate',
      source_snapshot: buildSnapshot({
        review_state: 'reviewed',
        resolution_state: 'excluded',
      }),
    });
    expect(resolveRegeneratedCandidateStatus(existing, 'candidate')).toBe('excluded');
  });

  it('falls back to the proposed status when reviewed but unresolved', () => {
    const existing = buildExisting({
      status: 'candidate',
      source_snapshot: buildSnapshot({
        review_state: 'reviewed',
        resolution_state: 'unresolved',
      }),
    });
    expect(resolveRegeneratedCandidateStatus(existing, 'needs_attention')).toBe('needs_attention');
  });

  it('falls back to the proposed status for a pristine existing record', () => {
    const existing = buildExisting({ status: 'candidate', source_snapshot: null });
    expect(resolveRegeneratedCandidateStatus(existing, 'needs_attention')).toBe('needs_attention');
  });
});

describe('persistRegeneratedBillingCandidate', () => {
  const baseArgs = {
    orgId: 'org-1',
    dedupeKey: 'dedupe-1',
    create: { status: 'candidate', other: 'value' } as Record<string, unknown>,
    update: { status: 'needs_attention' } as Record<string, unknown>,
  };

  it('upserts when there is no existing record and returns the created status', async () => {
    const upsert = vi.fn().mockResolvedValue({ status: 'candidate' });
    const updateMany = vi.fn();
    const tx: RegeneratedBillingCandidateTx = {
      billingCandidate: { upsert, updateMany },
    };

    const result = await persistRegeneratedBillingCandidate(tx, {
      ...baseArgs,
      existing: undefined,
    });

    expect(result).toEqual({ status: 'candidate' });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        org_id_dedupe_key: {
          org_id: 'org-1',
          dedupe_key: 'dedupe-1',
        },
      },
      create: baseArgs.create,
      update: {},
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('falls back to the create status when the upsert result lacks a string status', async () => {
    const upsert = vi.fn().mockResolvedValue(null);
    const tx: RegeneratedBillingCandidateTx = {
      billingCandidate: { upsert, updateMany: vi.fn() },
    };

    const result = await persistRegeneratedBillingCandidate(tx, {
      ...baseArgs,
      existing: undefined,
    });

    expect(result).toEqual({ status: 'candidate' });
  });

  it('returns the existing status unchanged and skips updateMany when locked (exported)', async () => {
    const updateMany = vi.fn();
    const tx: RegeneratedBillingCandidateTx = {
      billingCandidate: { upsert: vi.fn(), updateMany },
    };

    const result = await persistRegeneratedBillingCandidate(tx, {
      ...baseArgs,
      existing: buildExisting({ status: 'exported', source_snapshot: null }),
    });

    expect(result).toEqual({ status: 'exported' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('returns the existing status unchanged when locked by reviewed workflow', async () => {
    const updateMany = vi.fn();
    const tx: RegeneratedBillingCandidateTx = {
      billingCandidate: { upsert: vi.fn(), updateMany },
    };

    const result = await persistRegeneratedBillingCandidate(tx, {
      ...baseArgs,
      existing: buildExisting({
        status: 'confirmed',
        source_snapshot: buildSnapshot({
          review_state: 'reviewed',
          resolution_state: 'confirmed',
        }),
      }),
    });

    expect(result).toEqual({ status: 'confirmed' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('returns the update status when updateMany affects exactly one row', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn();
    const existing = buildExisting({ status: 'candidate', source_snapshot: null });
    const tx: RegeneratedBillingCandidateTx = {
      billingCandidate: { upsert: vi.fn(), updateMany, findFirst },
    };

    const result = await persistRegeneratedBillingCandidate(tx, {
      ...baseArgs,
      existing,
      updateScope: { locked: false },
    });

    expect(result).toEqual({ status: 'needs_attention' });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: existing.id,
        org_id: 'org-1',
        dedupe_key: 'dedupe-1',
        updated_at: existing.updated_at,
        locked: false,
      },
      data: baseArgs.update,
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the existing status when count===1 but update lacks a string status', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const existing = buildExisting({ status: 'candidate', source_snapshot: null });
    const tx: RegeneratedBillingCandidateTx = {
      billingCandidate: { upsert: vi.fn(), updateMany },
    };

    const result = await persistRegeneratedBillingCandidate(tx, {
      ...baseArgs,
      update: { foo: 'bar' },
      existing,
    });

    expect(result).toEqual({ status: 'candidate' });
  });

  it('falls back to findFirst current status when the optimistic update is stale (count===0)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findFirst = vi.fn().mockResolvedValue({ status: 'exported', source_snapshot: null });
    const existing = buildExisting({ status: 'candidate', source_snapshot: null });
    const tx: RegeneratedBillingCandidateTx = {
      billingCandidate: { upsert: vi.fn(), updateMany, findFirst },
    };

    const result = await persistRegeneratedBillingCandidate(tx, {
      ...baseArgs,
      existing,
    });

    expect(result).toEqual({ status: 'exported' });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: existing.id,
        org_id: 'org-1',
      },
      select: {
        status: true,
        source_snapshot: true,
      },
    });
  });

  it('falls back to the existing status when the stale findFirst returns null', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findFirst = vi.fn().mockResolvedValue(null);
    const existing = buildExisting({ status: 'candidate', source_snapshot: null });
    const tx: RegeneratedBillingCandidateTx = {
      billingCandidate: { upsert: vi.fn(), updateMany, findFirst },
    };

    const result = await persistRegeneratedBillingCandidate(tx, {
      ...baseArgs,
      existing,
    });

    expect(result).toEqual({ status: 'candidate' });
  });

  it('throws BILLING_CANDIDATE_REGENERATION_UPDATE_UNAVAILABLE when updateMany delegate is missing', async () => {
    const tx: RegeneratedBillingCandidateTx = {
      billingCandidate: { upsert: vi.fn() },
    };

    await expect(
      persistRegeneratedBillingCandidate(tx, {
        ...baseArgs,
        existing: buildExisting({ status: 'candidate', source_snapshot: null }),
      }),
    ).rejects.toThrow('BILLING_CANDIDATE_REGENERATION_UPDATE_UNAVAILABLE');
  });
});
