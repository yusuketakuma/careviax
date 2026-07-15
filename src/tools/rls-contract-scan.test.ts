import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanRlsContract } from './rls-contract-scan';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scanFixture(args: { migrations: readonly string[]; ssot: string }) {
  const root = mkdtempSync(join(tmpdir(), 'rls-contract-scan-'));
  roots.push(root);
  const schemaDir = join(root, 'schema');
  const migrationsDir = join(root, 'migrations');
  const ssotFile = join(root, 'rls-policies.sql');
  mkdirSync(schemaDir);
  mkdirSync(migrationsDir);
  writeFileSync(
    join(schemaDir, 'fixture.prisma'),
    'model TenantRecord {\n  id String @id\n  org_id String\n}\n',
  );
  args.migrations.forEach((sql, index) => {
    const dir = join(migrationsDir, `${String(index + 1).padStart(3, '0')}_fixture`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'migration.sql'), sql);
  });
  writeFileSync(ssotFile, args.ssot);
  return scanRlsContract({ schemaDir, migrationsDir, ssotFile }).coverage[0];
}

const COMPLETE_POLICY = `
ALTER TABLE "TenantRecord" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TenantRecord";
CREATE POLICY tenant_isolation ON "TenantRecord"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "TenantRecord" FORCE ROW LEVEL SECURITY;
`;

describe('scanRlsContract final-state evaluation', () => {
  it('requires migration and SSOT to be independently complete', () => {
    const coverage = scanFixture({ migrations: [COMPLETE_POLICY], ssot: COMPLETE_POLICY });

    expect(coverage).toMatchObject({
      status: 'covered',
      migration: { enabled: true, forced: true, hasApprovedPredicate: true },
      ssot: { enabled: true, forced: true, hasApprovedPredicate: true },
    });
  });

  it('honors a later NO FORCE instead of accepting an earlier FORCE occurrence', () => {
    const coverage = scanFixture({
      migrations: [COMPLETE_POLICY, 'ALTER TABLE "TenantRecord" NO FORCE ROW LEVEL SECURITY;'],
      ssot: COMPLETE_POLICY,
    });

    expect(coverage.status).toBe('partial');
    expect(coverage.migration.forced).toBe(false);
  });

  it('honors a later DISABLE instead of accepting an earlier ENABLE occurrence', () => {
    const coverage = scanFixture({
      migrations: [COMPLETE_POLICY, 'ALTER TABLE "TenantRecord" DISABLE ROW LEVEL SECURITY;'],
      ssot: COMPLETE_POLICY,
    });

    expect(coverage.status).toBe('partial');
    expect(coverage.migration.enabled).toBe(false);
  });

  it('honors a later DROP POLICY instead of accepting an earlier CREATE POLICY occurrence', () => {
    const coverage = scanFixture({
      migrations: [COMPLETE_POLICY, 'DROP POLICY tenant_isolation ON "TenantRecord";'],
      ssot: COMPLETE_POLICY,
    });

    expect(coverage.status).toBe('partial');
    expect(coverage.migration.hasPolicy).toBe(false);
  });

  it('clears historical RLS state when a table is dropped and recreated', () => {
    const coverage = scanFixture({
      migrations: [
        COMPLETE_POLICY,
        'DROP TABLE "TenantRecord"; CREATE TABLE "TenantRecord" (id text, org_id text);',
      ],
      ssot: COMPLETE_POLICY,
    });

    expect(coverage.status).toBe('partial');
    expect(coverage.migration).toMatchObject({
      enabled: false,
      forced: false,
      hasPolicy: false,
    });
  });

  it('classifies SSOT-only FORCE omission as ssot drift', () => {
    const coverage = scanFixture({
      migrations: [COMPLETE_POLICY],
      ssot: COMPLETE_POLICY.replace('ALTER TABLE "TenantRecord" FORCE ROW LEVEL SECURITY;', ''),
    });

    expect(coverage.status).toBe('ssot-drift');
    expect(coverage.migration.forced).toBe(true);
    expect(coverage.ssot.forced).toBe(false);
  });

  it('classifies migration-only coverage as SSOT drift', () => {
    const coverage = scanFixture({ migrations: [COMPLETE_POLICY], ssot: '' });

    expect(coverage.status).toBe('ssot-drift');
    expect(coverage.migration.hasApprovedPredicate).toBe(true);
    expect(coverage.ssot.enabled).toBe(false);
  });

  it('does not treat SSOT-only coverage as applied migration protection', () => {
    const coverage = scanFixture({ migrations: ['SELECT 1;'], ssot: COMPLETE_POLICY });

    expect(coverage.status).toBe('partial');
    expect(coverage.migration.enabled).toBe(false);
    expect(coverage.ssot.hasApprovedPredicate).toBe(true);
  });

  it('rejects nullable current_setting predicates as unapproved SSOT drift', () => {
    const coverage = scanFixture({
      migrations: [COMPLETE_POLICY],
      ssot: COMPLETE_POLICY.replaceAll(
        'public.app_enforced_org_id()',
        "current_setting('app.current_org_id', true)",
      ),
    });

    expect(coverage.status).toBe('ssot-drift');
    expect(coverage.ssot).toMatchObject({
      hasPolicy: true,
      hasApprovedPredicate: false,
      policyPredicates: ['nullable-setting'],
    });
  });

  it('honors a later ALTER POLICY predicate downgrade', () => {
    const coverage = scanFixture({
      migrations: [COMPLETE_POLICY],
      ssot: `${COMPLETE_POLICY}
ALTER POLICY tenant_isolation ON "TenantRecord"
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));`,
    });

    expect(coverage.status).toBe('ssot-drift');
    expect(coverage.ssot).toMatchObject({
      hasApprovedPredicate: false,
      policyPredicates: ['nullable-setting'],
    });
  });

  it('applies the repository dynamic fail-closed policy loop in migration order', () => {
    const dynamicHardening = `
DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['TenantRecord']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (org_id = public.app_enforced_org_id()) WITH CHECK (org_id = public.app_enforced_org_id())',
      target_table
    );
  END LOOP;
END;
$$;
`;
    const coverage = scanFixture({
      migrations: [
        COMPLETE_POLICY.replaceAll(
          'public.app_enforced_org_id()',
          "current_setting('app.current_org_id', true)",
        ).replace(
          'ALTER TABLE "TenantRecord" FORCE ROW LEVEL SECURITY;',
          'ALTER TABLE "TenantRecord" NO FORCE ROW LEVEL SECURITY;',
        ),
        dynamicHardening,
      ],
      ssot: COMPLETE_POLICY,
    });

    expect(coverage.status).toBe('covered');
    expect(coverage.migration).toMatchObject({
      hasApprovedPredicate: true,
      forced: true,
      policyPredicates: ['app-enforced-org'],
    });
  });

  it('does not treat comments or SQL string contents as executable RLS commands', () => {
    const coverage = scanFixture({
      migrations: [
        COMPLETE_POLICY,
        `
-- ALTER TABLE "TenantRecord" NO FORCE ROW LEVEL SECURITY;
/* DROP POLICY tenant_isolation ON "TenantRecord"; */
SELECT 'ALTER TABLE "TenantRecord" DISABLE ROW LEVEL SECURITY;';
`,
      ],
      ssot: COMPLETE_POLICY,
    });

    expect(coverage.status).toBe('covered');
    expect(coverage.migration).toMatchObject({
      enabled: true,
      forced: true,
      hasPolicy: true,
    });
  });
});
