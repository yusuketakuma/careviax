import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/server/services/patient-risk', () => ({
  listPatientRiskSummaries: vi.fn(),
}));

vi.mock('@/lib/utils/name-resolver', () => ({
  batchResolveNames: vi.fn(),
}));

vi.mock('@/server/services/outbound-webhook', () => ({
  notifyWebhookEventForOrg: vi.fn(),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: vi.fn(),
}));

import { listPatients } from './patient-service';

function makeDb() {
  return {
    patient: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient;
}

describe('listPatients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['missing', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['zero', 0],
    ['negative', -4],
  ])('uses the default page limit when the supplied limit is %s', async (_label, limit) => {
    const db = makeDb();

    await expect(
      listPatients(db, 'org_1', 'pharmacist', {
        limit,
      }),
    ).resolves.toMatchObject({
      data: [],
      hasMore: false,
    });

    expect(db.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 151,
      }),
    );
  });

  it('caps oversized internal limits to the public API maximum', async () => {
    const db = makeDb();

    await listPatients(db, 'org_1', 'pharmacist', {
      limit: 10_000,
    });

    expect(db.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 251,
      }),
    );
  });
});
