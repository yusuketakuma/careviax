import { beforeEach, describe, expect, it, vi } from 'vitest';

const { organizationFindManyMock, drainMock, cleanupMock } = vi.hoisted(() => ({
  organizationFindManyMock: vi.fn(),
  drainMock: vi.fn(),
  cleanupMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    organization: {
      findMany: organizationFindManyMock,
    },
  },
}));

vi.mock('@/server/services/pdf-bulk-export', () => ({
  drainMedicationHistoryBulkExportQueue: drainMock,
}));

vi.mock('@/server/services/file-storage', () => ({
  cleanupExpiredGeneratedFiles: cleanupMock,
}));

import {
  drainMedicationHistoryBulkExportJobs,
  listMedicationHistoryBulkExportOrgIds,
} from './pdf-bulk-export';

describe('medication history bulk export jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drainMock.mockResolvedValue({ processedCount: 2, errors: [] });
  });

  it('keeps an authenticated tenant drain pinned to that organization', async () => {
    await expect(drainMedicationHistoryBulkExportJobs({ orgId: 'org_1' })).resolves.toEqual({
      processedCount: 2,
      errors: [],
    });

    expect(organizationFindManyMock).not.toHaveBeenCalled();
    expect(drainMock).toHaveBeenCalledOnce();
    expect(drainMock).toHaveBeenCalledWith({ orgId: 'org_1' });
  });

  it('enumerates organizations in bounded cursor pages', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `org_${String(index + 1).padStart(3, '0')}`,
    }));
    organizationFindManyMock
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ id: 'org_101' }]);

    await expect(
      listMedicationHistoryBulkExportOrgIds({
        organization: { findMany: organizationFindManyMock },
      } as never),
    ).resolves.toHaveLength(101);

    expect(organizationFindManyMock).toHaveBeenNthCalledWith(1, {
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true },
    });
    expect(organizationFindManyMock).toHaveBeenNthCalledWith(2, {
      orderBy: { id: 'asc' },
      take: 100,
      cursor: { id: 'org_100' },
      skip: 1,
      select: { id: true },
    });
  });

  it('drains every enumerated organization through the tenant-bound service', async () => {
    organizationFindManyMock.mockResolvedValueOnce([{ id: 'org_1' }, { id: 'org_2' }]);
    drainMock
      .mockResolvedValueOnce({ processedCount: 2, errors: ['safe_partial_failure'] })
      .mockResolvedValueOnce({ processedCount: 3, errors: [] });

    await expect(drainMedicationHistoryBulkExportJobs()).resolves.toEqual({
      processedCount: 5,
      errors: ['safe_partial_failure'],
    });

    expect(drainMock).toHaveBeenNthCalledWith(1, { orgId: 'org_1' });
    expect(drainMock).toHaveBeenNthCalledWith(2, { orgId: 'org_2' });
  });

  it('returns a fixed diagnostic when one tenant drain fails', async () => {
    organizationFindManyMock.mockResolvedValueOnce([{ id: 'org_1' }, { id: 'org_2' }]);
    drainMock
      .mockRejectedValueOnce(new Error('patient name token=secret'))
      .mockResolvedValueOnce({ processedCount: 1, errors: [] });

    const result = await drainMedicationHistoryBulkExportJobs();

    expect(result).toEqual({
      processedCount: 1,
      errors: ['medication_history_bulk_export_org_drain_failed'],
    });
    expect(JSON.stringify(result)).not.toContain('patient name');
    expect(drainMock).toHaveBeenCalledTimes(2);
  });
});
