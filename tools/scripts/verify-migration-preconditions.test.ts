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
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.checked).toContain('patient-insurance-active-overlap');
    expect(result.checked).toContain('pca-duplicate-serial-numbers');
    expect(result.checked).toContain('file-asset-duplicate-storage-key');
    expect(result.checked).toContain('file-asset-size-bytes-out-of-range');
    expect(result.checked).toContain('file-asset-invalid-timestamps');
    expect(result.checked).toContain('patient-contact-duplicate-primary');
    expect(result.checked).toContain('care-team-duplicate-primary-role');
    expect(result.checked).toContain('care-team-non-canonical-role');
    expect(result.checked).toContain('delivery-record-duplicate-intent-key');
    expect(result.checked).toContain('delivery-record-legacy-duplicate-intent');
    expect(result.checked).toContain('communication-response-duplicate-intent-key');
    expect(result.checked).toContain('communication-response-legacy-duplicate-intent');
    expect(result.checked).toContain('dispense-result-duplicate-task-line');
    expect(result.checked).toContain('set-batch-duplicate-cell');
    expect(result.checked).toContain('set-plan-duplicate-period');
    expect(result.checked).toContain('visit-schedule-duplicate-active-route-order');
    expect(result.checked).toContain('visit-schedule-proposal-duplicate-open-route-order');
    expect(result.checked).toContain('business-holiday-duplicate-org-wide');
    expect(result.checked).toContain('business-holiday-duplicate-site');
  });

  it('warns but does not fail when btree_gist is not installed', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
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
      makeClient([1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
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
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 0, 0, 0, 0, 0, 0, 0]),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'file-asset-duplicate-storage-key', severity: 'error' }),
        expect.objectContaining({ name: 'file-asset-invalid-size-bytes', severity: 'error' }),
        expect.objectContaining({
          name: 'file-asset-size-bytes-out-of-range',
          severity: 'error',
        }),
        expect.objectContaining({ name: 'file-asset-invalid-timestamps', severity: 'error' }),
        expect.objectContaining({ name: 'file-asset-missing-organization', severity: 'error' }),
      ]),
    );
  });

  it('fails on patient foundation primary groups that would block unique indexes', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 3, 4, 0, 0, 0, 0]),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'patient-contact-duplicate-primary', severity: 'error' }),
        expect.objectContaining({ name: 'care-team-duplicate-primary-role', severity: 'error' }),
        expect.objectContaining({ name: 'care-team-non-canonical-role', severity: 'error' }),
      ]),
    );
  });

  it('fails on non-null idempotency key duplicates that would block unique indexes', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 3, 0]),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'delivery-record-duplicate-intent-key',
          severity: 'error',
        }),
        expect.objectContaining({
          name: 'communication-response-duplicate-intent-key',
          severity: 'error',
        }),
      ]),
    );
  });

  it('warns on legacy null idempotency duplicate groups without blocking migration', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 3]),
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'delivery-record-legacy-duplicate-intent',
          severity: 'warn',
        }),
        expect.objectContaining({
          name: 'communication-response-legacy-duplicate-intent',
          severity: 'warn',
        }),
      ]),
    );
  });

  it('fails on duplicate dispense result task/line groups that would block unique identity', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'dispense-result-duplicate-task-line',
          severity: 'error',
        }),
      ]),
    );
  });

  it('fails on duplicate set batch cells that would block unique identity', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'set-batch-duplicate-cell',
          severity: 'error',
        }),
      ]),
    );
  });

  it('fails on duplicate set plan period groups that would block unique identity', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'set-plan-duplicate-period',
          severity: 'error',
        }),
      ]),
    );
  });

  it('fails on duplicate visit route-order cells that would block partial unique identities', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3]),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'visit-schedule-duplicate-active-route-order',
          severity: 'error',
        }),
        expect.objectContaining({
          name: 'visit-schedule-proposal-duplicate-open-route-order',
          severity: 'error',
        }),
      ]),
    );
  });

  it('fails on duplicate business holidays that would block operating-day partial unique indexes', async () => {
    const result = await verifyMigrationPreconditions(
      makeClient([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3]),
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'business-holiday-duplicate-org-wide',
          severity: 'error',
        }),
        expect.objectContaining({
          name: 'business-holiday-duplicate-site',
          severity: 'error',
        }),
      ]),
    );
  });
});
