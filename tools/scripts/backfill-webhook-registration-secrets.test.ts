import { describe, expect, it } from 'vitest';
import {
  getBlockingBackfillIssues,
  normalizePreflightCounts,
  parseBackfillArgs,
  runWebhookSecretBackfill,
  type BackfillOptions,
} from './backfill-webhook-registration-secrets';

describe('backfill-webhook-registration-secrets', () => {
  it('defaults to dry-run and requires max rows for apply mode', () => {
    expect(parseBackfillArgs([])).toEqual({
      mode: 'dry-run',
      batchSize: 50,
      maxRows: null,
      orgId: null,
    });
    expect(
      parseBackfillArgs([
        '--apply',
        '--max-rows',
        '100',
        '--batch-size',
        '25',
        '--org-id',
        'org_1',
      ]),
    ).toEqual({
      mode: 'apply',
      batchSize: 25,
      maxRows: 100,
      orgId: 'org_1',
    });
    expect(() => parseBackfillArgs(['--apply'])).toThrow(/--max-rows/);
    expect(() => parseBackfillArgs(['--apply', '--dry-run'])).toThrow(
      /either --apply or --dry-run/,
    );
  });

  it('normalizes aggregate count rows returned by pg', () => {
    expect(
      normalizePreflightCounts({
        total: '8',
        legacyPlaintextRows: 3,
        encryptedOnlyRows: '2',
        backfilledButPlaintextRetainedRows: '1',
        partialEncryptedRows: '0',
        unreadableRows: '0',
        unsupportedAlgorithmRows: '0',
      }),
    ).toEqual({
      total: 8,
      legacyPlaintextRows: 3,
      encryptedOnlyRows: 2,
      backfilledButPlaintextRetainedRows: 1,
      partialEncryptedRows: 0,
      unreadableRows: 0,
      unsupportedAlgorithmRows: 0,
    });
  });

  it('blocks apply when partial, unreadable, or unsupported rows exist', () => {
    expect(
      getBlockingBackfillIssues({
        total: 3,
        legacyPlaintextRows: 1,
        encryptedOnlyRows: 0,
        backfilledButPlaintextRetainedRows: 0,
        partialEncryptedRows: 1,
        unreadableRows: 1,
        unsupportedAlgorithmRows: 1,
      }),
    ).toEqual([
      '1 rows have incomplete encrypted secret fields',
      '1 rows have no readable secret',
      '1 rows use an unsupported secret algorithm',
    ]);
  });

  it('returns dry-run readiness without issuing update queries', async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes('GROUP BY org_id')) {
          return {
            rows: [{ orgId: 'org_1', legacyPlaintextRows: 2 }],
            rowCount: 1,
          };
        }
        return {
          rows: [
            {
              total: 3,
              legacyPlaintextRows: 2,
              encryptedOnlyRows: 1,
              backfilledButPlaintextRetainedRows: 0,
              partialEncryptedRows: 0,
              unreadableRows: 0,
              unsupportedAlgorithmRows: 0,
            },
          ],
          rowCount: 1,
        };
      },
    };

    await expect(
      runWebhookSecretBackfill(
        client as unknown as Parameters<typeof runWebhookSecretBackfill>[0],
        {
          mode: 'dry-run',
          batchSize: 50,
          maxRows: null,
          orgId: null,
        } satisfies BackfillOptions,
      ),
    ).resolves.toMatchObject({
      ok: true,
      mode: 'dry-run',
      applyReady: true,
      counts: {
        total: 3,
        legacyPlaintextRows: 2,
        encryptedOnlyRows: 1,
      },
      orgs: [{ orgId: 'org_1', legacyPlaintextRows: 2 }],
    });
    expect(queries.some((sql) => sql.includes('UPDATE "WebhookRegistration"'))).toBe(false);
  });
});
