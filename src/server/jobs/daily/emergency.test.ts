import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  organizationFindManyMock,
  businessHolidayFindManyMock,
  pharmacistShiftFindManyMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
} = vi.hoisted(() => ({
  organizationFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: { organization: { findMany: organizationFindManyMock } },
}));
vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));
vi.mock('../runner', () => ({
  runJob: vi.fn(async (_type: string, work: () => Promise<unknown>) => work()),
}));

import { checkEmergencyCoverageGaps } from './emergency';

describe('emergency coverage gap job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationFindManyMock.mockResolvedValue([{ id: 'org_a' }, { id: 'org_b' }]);
    withOrgContextMock.mockImplementation(
      async (orgId: string, work: (tx: unknown) => Promise<unknown>) =>
        work({
          businessHoliday: {
            findMany: (args: unknown) => businessHolidayFindManyMock(orgId, args),
          },
          pharmacistShift: {
            findMany: (args: unknown) => pharmacistShiftFindManyMock(orgId, args),
          },
        }),
    );
    businessHolidayFindManyMock.mockImplementation(async (orgId: string) => [
      {
        site_id: `site_${orgId}`,
        date: new Date('2026-07-18T00:00:00.000Z'),
        name: '休業日',
        is_closed: true,
      },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValue([]);
  });

  it('pins holiday, shift, and task operations to each enumerated organization', async () => {
    await expect(checkEmergencyCoverageGaps()).resolves.toEqual({ processedCount: 2 });

    expect(businessHolidayFindManyMock).toHaveBeenNthCalledWith(
      1,
      'org_a',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_a' }) }),
    );
    expect(businessHolidayFindManyMock).toHaveBeenNthCalledWith(
      2,
      'org_b',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_b' }) }),
    );
    expect(pharmacistShiftFindManyMock).toHaveBeenNthCalledWith(
      1,
      'org_a',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_a' }) }),
    );
    expect(pharmacistShiftFindManyMock).toHaveBeenNthCalledWith(
      2,
      'org_b',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_b' }) }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ orgId: 'org_a' }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ orgId: 'org_b' }),
    );
    expect(
      withOrgContextMock.mock.calls.every(([orgId]) => orgId === 'org_a' || orgId === 'org_b'),
    ).toBe(true);
  });
});
