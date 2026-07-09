import { beforeEach, describe, expect, it, vi } from 'vitest';

const { drainYreseClinicalSyncQueueMock, purgeRawVaultMock, runJobMock } = vi.hoisted(() => ({
  drainYreseClinicalSyncQueueMock: vi.fn(),
  purgeRawVaultMock: vi.fn(),
  runJobMock: vi.fn(async (...args: [string, () => Promise<unknown>, string?]) => args[1]()),
}));

vi.mock('@/server/services/standard-clinical-sync-queue', () => ({
  drainYreseClinicalSyncQueue: drainYreseClinicalSyncQueueMock,
}));

vi.mock('@/server/services/standard-clinical-raw-vault-retention', () => ({
  purgeExpiredClinicalFhirRawResourceVault: purgeRawVaultMock,
}));

vi.mock('./runner', () => ({
  runJob: runJobMock,
}));

import {
  drainYreseClinicalSyncQueueJob,
  purgeExpiredClinicalFhirRawResourceVaultJob,
} from './standard-clinical-sync';

describe('standard clinical jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the yrese clinical sync queue drain through the job runner', async () => {
    drainYreseClinicalSyncQueueMock.mockResolvedValue({
      processedCount: 2,
      scannedCount: 3,
      succeededCount: 1,
      conflictCount: 1,
      failedCount: 0,
      skippedCount: 1,
    });

    const result = await drainYreseClinicalSyncQueueJob({ orgId: 'org_1' });

    expect(runJobMock).toHaveBeenCalledWith(
      'yrese_clinical_sync_queue_drain',
      expect.any(Function),
      'org_1',
    );
    expect(drainYreseClinicalSyncQueueMock).toHaveBeenCalledWith({ orgId: 'org_1' });
    expect(result).toMatchObject({ processedCount: 2, scannedCount: 3 });
  });

  it('runs raw vault retention purge only for an explicit organization', async () => {
    purgeRawVaultMock.mockResolvedValue({
      processedCount: 2,
      deletedCount: 2,
      scannedCount: 2,
      errors: [],
    });

    const result = await purgeExpiredClinicalFhirRawResourceVaultJob({ orgId: 'org_1' });

    expect(runJobMock).toHaveBeenCalledWith(
      'clinical_fhir_raw_vault_retention_purge',
      expect.any(Function),
      'org_1',
    );
    expect(purgeRawVaultMock).toHaveBeenCalledWith({ orgId: 'org_1' });
    expect(result).toEqual({
      processedCount: 2,
      deletedCount: 2,
      scannedCount: 2,
      errors: [],
    });
    expect(JSON.stringify(result)).not.toContain('resource_hash');
    expect(JSON.stringify(result)).not.toContain('encrypted_payload');
  });

  it('refuses raw vault retention purge without an organization scope', async () => {
    const result = await purgeExpiredClinicalFhirRawResourceVaultJob();

    expect(runJobMock).toHaveBeenCalledWith(
      'clinical_fhir_raw_vault_retention_purge',
      expect.any(Function),
      undefined,
    );
    expect(purgeRawVaultMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      processedCount: 0,
      deletedCount: 0,
      scannedCount: 0,
      errors: ['org_scope_required'],
    });
  });
});
