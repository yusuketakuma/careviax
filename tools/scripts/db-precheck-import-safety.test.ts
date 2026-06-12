import { describe, expect, it } from 'vitest';

describe('DB-gated precheck import safety', () => {
  it('does not connect to DATABASE_URL when imported by tests or tooling', async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      await expect(import('./check-care-report-duplicates')).resolves.toBeDefined();
      await expect(import('./check-visit-route-order-conflicts')).resolves.toBeDefined();
      await expect(import('./external-access-case-boundary-audit')).resolves.toBeDefined();
      await expect(import('./verify-migration-preconditions')).resolves.toBeDefined();
      await expect(import('./verify-ph-os-audit-migration')).resolves.toBeDefined();
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });
});
