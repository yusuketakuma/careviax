import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runJobMock, importCareServiceOfficeOpenDataMock } = vi.hoisted(() => ({
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
  importCareServiceOfficeOpenDataMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { marker: 'prisma' },
}));

vi.mock('@/server/services/care-service-office-master-import', () => ({
  importCareServiceOfficeOpenData: importCareServiceOfficeOpenDataMock,
}));

vi.mock('./runner', () => ({
  runJob: runJobMock,
}));

import { refreshCareServiceOfficeMaster } from './care-service-office-master';

describe('refreshCareServiceOfficeMaster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importCareServiceOfficeOpenDataMock.mockResolvedValue({
      processedCount: 3,
      scannedCount: 30,
    });
  });

  it('runs the importer through the integration job runner for all orgs', async () => {
    const result = await refreshCareServiceOfficeMaster();

    expect(runJobMock).toHaveBeenCalledWith(
      'care_service_office_master_auto_refresh',
      expect.any(Function),
      undefined,
      'all-orgs',
    );
    expect(importCareServiceOfficeOpenDataMock).toHaveBeenCalledWith(
      { marker: 'prisma' },
      { targetOrgIds: undefined },
    );
    expect(result).toMatchObject({ processedCount: 3, scannedCount: 30 });
  });

  it('deduplicates and scopes a targeted manual refresh', async () => {
    await refreshCareServiceOfficeMaster({ targetOrgIds: ['org_2', 'org_1', 'org_1'] });

    expect(runJobMock).toHaveBeenCalledWith(
      'care_service_office_master_auto_refresh',
      expect.any(Function),
      undefined,
      'target-orgs:org_1,org_2',
    );
    expect(importCareServiceOfficeOpenDataMock).toHaveBeenCalledWith(
      { marker: 'prisma' },
      { targetOrgIds: ['org_1', 'org_2'] },
    );
  });
});
