import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runJobMock, importMedicalInstitutionOpenDataMock } = vi.hoisted(() => ({
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
  importMedicalInstitutionOpenDataMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { marker: 'prisma' },
}));

vi.mock('@/server/services/medical-institution-master-import', () => ({
  importMedicalInstitutionOpenData: importMedicalInstitutionOpenDataMock,
}));

vi.mock('./runner', () => ({
  runJob: runJobMock,
}));

import { refreshMedicalInstitutionMaster } from './medical-institution-master';

describe('refreshMedicalInstitutionMaster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importMedicalInstitutionOpenDataMock.mockResolvedValue({
      processedCount: 2,
      scannedCount: 20,
    });
  });

  it('runs the importer through the integration job runner for all orgs', async () => {
    const result = await refreshMedicalInstitutionMaster();

    expect(runJobMock).toHaveBeenCalledWith(
      'medical_institution_master_auto_refresh',
      expect.any(Function),
      undefined,
      'all-orgs',
    );
    expect(importMedicalInstitutionOpenDataMock).toHaveBeenCalledWith(
      { marker: 'prisma' },
      { targetOrgIds: undefined },
    );
    expect(result).toMatchObject({ processedCount: 2, scannedCount: 20 });
  });

  it('deduplicates and scopes a targeted manual refresh', async () => {
    await refreshMedicalInstitutionMaster({ targetOrgIds: ['org_2', 'org_1', 'org_1'] });

    expect(runJobMock).toHaveBeenCalledWith(
      'medical_institution_master_auto_refresh',
      expect.any(Function),
      undefined,
      'target-orgs:org_1,org_2',
    );
    expect(importMedicalInstitutionOpenDataMock).toHaveBeenCalledWith(
      { marker: 'prisma' },
      { targetOrgIds: ['org_1', 'org_2'] },
    );
  });
});
