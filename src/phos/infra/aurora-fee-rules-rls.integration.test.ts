import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const databaseUrl = process.env.PHOS_AURORA_RLS_TEST_DATABASE_URL;
const describeWithAurora = databaseUrl ? describe : describe.skip;
const sql = readFileSync(join(process.cwd(), 'src/phos/infra/aurora-fee-rules-rls.sql'), 'utf8');
const rlsStart = 'ALTER TABLE phos_fee_rule_master ENABLE ROW LEVEL SECURITY;';

function schemaName(): string {
  return `phos_rls_${randomUUID().replaceAll('-', '_')}`;
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function splitStatements(input: string): string[] {
  return input
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

async function executeSql(pool: Pool, schema: string, input: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${quoteIdent(schema)}, public`);
    for (const statement of splitStatements(input)) {
      await client.query(statement);
    }
  } finally {
    client.release();
  }
}

async function seedFeeRules(pool: Pool, schema: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${quoteIdent(schema)}, public`);
    for (const tenantId of ['tenant_a', 'tenant_b', 'SYSTEM']) {
      const scope = tenantId === 'SYSTEM' ? 'SYSTEM' : 'TENANT';
      await client.query(
        `INSERT INTO phos_fee_rule_master
          (tenant_id, rule_id, fee_code, fee_label, tenant_scope)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, `rule_${tenantId}`, `FEE_${tenantId}`, `Fee ${tenantId}`, scope],
      );
      await client.query(
        `INSERT INTO phos_fee_rule_versions
          (tenant_id, rule_version_id, rule_id, revision_code, active_from, condition)
         VALUES ($1, $2, $3, $4, DATE '2026-04-01', $5::jsonb)`,
        [tenantId, `rv_${tenantId}`, `rule_${tenantId}`, '2026', '{"op":"AND","conditions":[]}'],
      );
      await client.query(
        `INSERT INTO phos_fee_rule_evidence_requirements
          (tenant_id, rule_version_id, evidence_key, label, required, source_kind, display_order)
         VALUES ($1, $2, $3, $4, true, 'CARE_PLAN', 0)`,
        [tenantId, `rv_${tenantId}`, `evidence_${tenantId}`, `Evidence ${tenantId}`],
      );
      await client.query(
        `INSERT INTO phos_fee_rule_source_refs
          (tenant_id, rule_version_id, ref_id, kind, label, display_order)
         VALUES ($1, $2, $3, 'RULE_DOCUMENT', $4, 0)`,
        [tenantId, `rv_${tenantId}`, `ref_${tenantId}`, `Reference ${tenantId}`],
      );
    }
  } finally {
    client.release();
  }
}

describeWithAurora('PH-OS Aurora FeeRule RLS integration', () => {
  it('isolates tenant FeeRule rows while preserving SYSTEM rule visibility', async () => {
    expect(databaseUrl).toBeTruthy();
    const schema = schemaName();
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const rlsStartIndex = sql.indexOf(rlsStart);
    expect(rlsStartIndex).toBeGreaterThan(0);

    try {
      await pool.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
      await executeSql(pool, schema, sql.slice(0, rlsStartIndex));
      await seedFeeRules(pool, schema);
      await executeSql(pool, schema, sql.slice(rlsStartIndex));

      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${quoteIdent(schema)}, public`);
        await client.query("SELECT set_config('app.tenant_id', $1, false)", ['tenant_a']);

        const masterRows = await client.query<{ tenant_id: string }>(
          'SELECT tenant_id FROM phos_fee_rule_master ORDER BY tenant_id',
        );
        expect(masterRows.rows.map((row) => row.tenant_id)).toEqual(['SYSTEM', 'tenant_a']);

        const evidenceRows = await client.query<{ tenant_id: string }>(
          'SELECT tenant_id FROM phos_fee_rule_evidence_requirements ORDER BY tenant_id',
        );
        expect(evidenceRows.rows.map((row) => row.tenant_id)).toEqual(['SYSTEM', 'tenant_a']);

        await expect(
          client.query(
            `INSERT INTO phos_fee_rule_master
              (tenant_id, rule_id, fee_code, fee_label, tenant_scope)
             VALUES ('tenant_b', 'rule_forbidden', 'FEE_FORBIDDEN', 'Forbidden', 'TENANT')`,
          ),
        ).rejects.toThrow(/row-level security|violates/);
      } finally {
        client.release();
      }
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      await pool.end();
    }
  });
});
