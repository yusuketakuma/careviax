import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'src/phos/infra/aurora-fee-rules-rls.sql'), 'utf8');

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
    expect(sql).toContain("current_setting('app.tenant_id', true)");
    expect(sql).toContain("tenant_scope = 'SYSTEM' AND tenant_id = 'SYSTEM'");
    expect(sql).not.toContain('app.current_org_id');
  });
});
