import { ClinicalRawVaultAccessPolicy } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  buildClinicalFhirRawVaultPurgeWhere,
  CLINICAL_RAW_VAULT_PURGE_FAILED,
  CLINICAL_RAW_VAULT_PURGE_INVALID_LIMIT,
  purgeExpiredClinicalFhirRawResourceVault,
} from './standard-clinical-raw-vault-retention';

function createMockTx() {
  return {
    clinicalFhirRawResourceVault: {
      findMany: vi.fn().mockResolvedValue([{ id: 'vault_1' }, { id: 'vault_2' }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  };
}

type MockTx = ReturnType<typeof createMockTx>;

const now = new Date('2026-07-10T09:00:00+09:00');

async function purgeWithTx(
  tx: MockTx,
  options: Partial<Parameters<typeof purgeExpiredClinicalFhirRawResourceVault>[0]> = {},
) {
  return purgeExpiredClinicalFhirRawResourceVault(
    { orgId: 'org_1', now, ...options },
    {
      runInOrgContext: async (orgId, work) => {
        expect(orgId).toBe(options.orgId ?? 'org_1');
        return work(tx as never);
      },
    },
  );
}

describe('purgeExpiredClinicalFhirRawResourceVault', () => {
  it('deletes only expired purgeable raw vault rows using the same eligibility predicate', async () => {
    const tx = createMockTx();

    const result = await purgeWithTx(tx, { limit: 50 });

    expect(result).toEqual({
      processedCount: 2,
      deletedCount: 2,
      scannedCount: 2,
      errors: [],
    });
    const expectedWhere = buildClinicalFhirRawVaultPurgeWhere('org_1', now);
    expect(expectedWhere).toMatchObject({
      org_id: 'org_1',
      expires_at: { lte: now },
      access_policy: {
        in: [
          ClinicalRawVaultAccessPolicy.step_up_required,
          ClinicalRawVaultAccessPolicy.system_replay_only,
        ],
      },
      OR: [{ legal_hold_until: null }, { legal_hold_until: { lte: now } }],
    });
    expect(expectedWhere.access_policy).toEqual({
      in: [
        ClinicalRawVaultAccessPolicy.step_up_required,
        ClinicalRawVaultAccessPolicy.system_replay_only,
      ],
    });
    expect(tx.clinicalFhirRawResourceVault.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: [{ expires_at: 'asc' }, { id: 'asc' }],
      take: 50,
      select: { id: true },
    });
    expect(tx.clinicalFhirRawResourceVault.deleteMany).toHaveBeenCalledWith({
      where: {
        ...expectedWhere,
        id: { in: ['vault_1', 'vault_2'] },
      },
    });
    expect(JSON.stringify(tx.clinicalFhirRawResourceVault.findMany.mock.calls)).not.toContain(
      'encrypted_payload',
    );
    expect(JSON.stringify(tx.clinicalFhirRawResourceVault.findMany.mock.calls)).not.toContain(
      'resource_hash',
    );
  });

  it('does not run destructive queries for explicit invalid limits', async () => {
    const tx = createMockTx();

    const result = await purgeWithTx(tx, { limit: 0 });

    expect(result).toEqual({
      processedCount: 0,
      deletedCount: 0,
      scannedCount: 0,
      errors: [CLINICAL_RAW_VAULT_PURGE_INVALID_LIMIT],
    });
    expect(tx.clinicalFhirRawResourceVault.findMany).not.toHaveBeenCalled();
    expect(tx.clinicalFhirRawResourceVault.deleteMany).not.toHaveBeenCalled();
  });

  it('bounds overly large limits and reports actual deleted rows after race-safe recheck', async () => {
    const tx = createMockTx();
    tx.clinicalFhirRawResourceVault.deleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await purgeWithTx(tx, { limit: 9999 });

    expect(tx.clinicalFhirRawResourceVault.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
    expect(result).toEqual({
      processedCount: 1,
      deletedCount: 1,
      scannedCount: 2,
      errors: [],
    });
  });

  it('does not call deleteMany when there are no eligible candidates', async () => {
    const tx = createMockTx();
    tx.clinicalFhirRawResourceVault.findMany.mockResolvedValueOnce([]);

    const result = await purgeWithTx(tx);

    expect(result).toEqual({
      processedCount: 0,
      deletedCount: 0,
      scannedCount: 0,
      errors: [],
    });
    expect(tx.clinicalFhirRawResourceVault.deleteMany).not.toHaveBeenCalled();
  });

  it('returns only safe error codes when the purge query fails', async () => {
    const tx = createMockTx();
    tx.clinicalFhirRawResourceVault.findMany.mockRejectedValueOnce(
      new Error('LEAK encrypted_payload=secret resource_hash=sha256:abc cache_id=cache_1'),
    );

    const result = await purgeWithTx(tx);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      processedCount: 0,
      deletedCount: 0,
      scannedCount: 0,
      errors: [CLINICAL_RAW_VAULT_PURGE_FAILED],
    });
    expect(serialized).not.toContain('encrypted_payload');
    expect(serialized).not.toContain('resource_hash');
    expect(serialized).not.toContain('cache_1');
  });
});
