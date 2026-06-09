import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'src/phos/infra/aurora-fee-rules-rls.sql'), 'utf8');
const migrationSql = readFileSync(
  join(process.cwd(), 'prisma/migrations/20260609173000_add_phos_fee_rule_rls/migration.sql'),
  'utf8',
);

describe('PH-OS Aurora FeeRule RLS contract', () => {
  it('defines the required FeeRule tables with tenant_id on every table', () => {
    for (const table of [
      'phos_fee_rule_master',
      'phos_fee_rule_versions',
      'phos_fee_rule_evidence_requirements',
      'phos_fee_rule_source_refs',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(sql).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*tenant_id text NOT NULL`),
      );
    }
  });

  it('enables RLS and uses app.tenant_id policies with explicit SYSTEM rule handling', () => {
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('DROP POLICY IF EXISTS');
    expect(sql).toContain("current_setting('app.tenant_id', true)");
    expect(sql).toContain('FOR SELECT');
    expect(sql).toContain('FOR INSERT');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('FOR DELETE');
    expect(sql).toContain("tenant_scope = 'SYSTEM' AND tenant_id = 'SYSTEM'");
    expect(sql).toContain(
      "WITH CHECK (tenant_id = current_setting('app.tenant_id', true) AND tenant_scope = 'TENANT')",
    );
    expect(sql).toContain("WITH CHECK (tenant_id = current_setting('app.tenant_id', true));");
    expect(sql).not.toContain(
      "WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = 'SYSTEM')",
    );
    expect(sql).not.toContain(
      "WITH CHECK (\n    tenant_id = current_setting('app.tenant_id', true)\n    OR (tenant_scope = 'SYSTEM' AND tenant_id = 'SYSTEM')\n  )",
    );
    expect(sql).not.toContain('app.current_org_id');
  });

  it('declares indexes for the runtime FeeRule query and lateral child ordering shape', () => {
    expect(sql).toContain('phos_fee_rule_master_tenant_fee_idx');
    expect(sql).toContain('ON phos_fee_rule_master (tenant_id, fee_code, tenant_scope)');
    expect(sql).toContain('phos_fee_rule_versions_active_order_idx');
    expect(sql).toContain(
      'ON phos_fee_rule_versions (tenant_id, rule_id, active, revision_code DESC, rule_version_id)',
    );
    expect(sql).toContain('phos_fee_rule_evidence_requirements_order_idx');
    expect(sql).toContain('phos_fee_rule_source_refs_order_idx');
  });

  it('is present in the Prisma migration path used to build Aurora databases', () => {
    expect(migrationSql).toContain(sql.trim());
  });
});
