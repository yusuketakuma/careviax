import { describe, expect, it } from 'vitest';
import { verifyMigrationPreconditions } from './verify-migration-preconditions';
import type { MigrationPreconditionClient } from './verify-migration-preconditions';

function makeClient(counts: number[]): MigrationPreconditionClient {
  let index = 0;
  return {
    async query<T extends object>() {
      const value = counts[index] ?? 0;
      index += 1;
      return { rows: [{ value } as T] };
    },
  };
}

describe('verifyMigrationPreconditions', () => {
  it('passes when no blocking data issue exists and btree_gist is installed', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]),
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.checked).toContain('patient-insurance-active-overlap');
    expect(result.checked).toContain('pca-duplicate-serial-numbers');
    expect(result.checked).toContain('file-asset-duplicate-storage-key');
  });

  it('warns but does not fail when btree_gist is not installed', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({
        name: 'btree-gist-extension',
        severity: 'warn',
      }),
    ]);
  });

  it('fails on patient insurance and PCA data that would block hardening migrations', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0]),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'patient-insurance-active-overlap', severity: 'error' }),
        expect.objectContaining({ name: 'pca-duplicate-open-rentals', severity: 'error' }),
        expect.objectContaining({ name: 'pca-cross-org-pump-rentals', severity: 'error' }),
        expect.objectContaining({ name: 'pca-cross-org-institution-rentals', severity: 'error' }),
        expect.objectContaining({ name: 'pca-invalid-rental-dates', severity: 'error' }),
        expect.objectContaining({ name: 'pca-invalid-returned-state', severity: 'error' }),
        expect.objectContaining({ name: 'pca-duplicate-serial-numbers', severity: 'error' }),
        expect.objectContaining({ name: 'btree-gist-extension', severity: 'warn' }),
      ]),
    );
  });

  it('fails on file asset rows that would block FileAsset backfill', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'file-asset-duplicate-storage-key', severity: 'error' }),
        expect.objectContaining({ name: 'file-asset-invalid-size-bytes', severity: 'error' }),
        expect.objectContaining({ name: 'file-asset-missing-organization', severity: 'error' }),
      ]),
    );
  });
});
