import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { parseLocalE2eDatabaseTarget } from '../../../tools/scripts/prepare-e2e-db-core';

const migration = readFileSync(
  'prisma/migrations/20260717090000_redact_management_plan_audit/migration.sql',
  'utf8',
);

const databaseUrl = process.env.MANAGEMENT_PLAN_AUDIT_DATABASE_URL;
if (databaseUrl) {
  parseLocalE2eDatabaseTarget(databaseUrl, 'MANAGEMENT_PLAN_AUDIT_DATABASE_URL');
}
const describeDatabase = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

afterAll(async () => {
  await pool?.end();
});

describe('management plan audit DB contract', () => {
  it('replaces the generic trigger with the dedicated minimized function', () => {
    expect(migration).toContain('ph_os_write_management_plan_audit_log()');
    expect(migration).toContain('DROP TRIGGER IF EXISTS audit_log_management_plan');
    expect(migration).toContain(
      'FOR EACH ROW EXECUTE FUNCTION ph_os_write_management_plan_audit_log()',
    );
    expect(migration).not.toContain('FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log()');
  });

  it('stores only the clinical field names and minimized status/version projection', () => {
    expect(migration).toContain("'changed_fields', v_changed_fields");
    expect(migration).toContain("'status_before', v_old->>'status'");
    expect(migration).toContain("'status_after', v_new->>'status'");
    expect(migration).not.toContain("'after', to_jsonb(NEW)");
    expect(migration).not.toContain("'before', to_jsonb(OLD)");
  });

  it('fails the mutation closed when the same-org patient cannot be resolved', () => {
    expect(migration).toContain('FROM "CareCase"');
    expect(migration).toContain('AND "org_id" = v_org_id');
    expect(migration).toContain("RAISE EXCEPTION 'ManagementPlan audit patient resolution failed'");
  });

  it('uses only validated local trace settings and safe system fallbacks', () => {
    expect(migration).toContain("current_setting('app.current_request_id', true)");
    expect(migration).toContain("current_setting('app.current_correlation_id', true)");
    expect(migration).toContain("COALESCE(v_actor_id, 'system')");
    expect(migration).toContain('COALESCE(v_actor_pharmacy_id, v_org_id)');
  });
});

describeDatabase('management plan audit live DB contract', () => {
  it('writes exact-one minimized audit rows for create and update', async () => {
    const client = await pool!.connect();
    const planId = `test_management_plan_${randomUUID().replaceAll('-', '')}`;
    const clinicalTitle = `secret-title-${randomUUID()}`;
    const clinicalContent = `secret-content-${randomUUID()}`;
    const updatedClinicalContent = `secret-update-${randomUUID()}`;
    try {
      await client.query('BEGIN');
      const scope = await client.query<{ org_id: string; case_id: string; created_by: string }>(`
        SELECT c."org_id", c."id" AS case_id, m."user_id" AS created_by
        FROM "CareCase" c
        JOIN "Membership" m ON m."org_id" = c."org_id" AND m."is_active" = true
        ORDER BY c."created_at", m."created_at"
        LIMIT 1
      `);
      const row = scope.rows[0];
      expect(row).toBeDefined();
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [row!.org_id]);
      await client.query(`SELECT set_config('app.rls_context_applied', 'true', true)`);
      await client.query(`SELECT set_config('app.current_actor_id', $1, true)`, [row!.created_by]);
      await client.query(`SELECT set_config('app.current_member_role', 'pharmacist', true)`);
      await client.query(`SELECT set_config('app.current_request_id', 'req_12345678', true)`);
      await client.query(`SELECT set_config('app.current_correlation_id', 'cor_12345678', true)`);

      const version = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX("version"), 0) + 1 AS version
         FROM "ManagementPlan" WHERE "case_id" = $1`,
        [row!.case_id],
      );
      await client.query(
        `INSERT INTO "ManagementPlan"
          ("id", "org_id", "case_id", "title", "summary", "content", "created_by", "version", "updated_at")
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, CURRENT_TIMESTAMP)`,
        [
          planId,
          row!.org_id,
          row!.case_id,
          clinicalTitle,
          'clinical summary',
          JSON.stringify({ goals: [clinicalContent] }),
          row!.created_by,
          version.rows[0]!.version,
        ],
      );

      let audits = await client.query<{ action: string; changes: unknown }>(
        `SELECT "action", "changes" FROM "AuditLog"
         WHERE "target_type" = 'management_plan' AND "target_id" = $1
         ORDER BY "created_at"`,
        [planId],
      );
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]?.action).toBe('management_plan.create');
      expect(JSON.stringify(audits.rows[0]?.changes)).not.toContain(clinicalTitle);
      expect(JSON.stringify(audits.rows[0]?.changes)).not.toContain(clinicalContent);

      await client.query(
        `UPDATE "ManagementPlan"
         SET "title" = 'updated title', "content" = jsonb_build_object('notes', $2::text),
             "updated_at" = "updated_at" + INTERVAL '1 millisecond'
         WHERE "id" = $1`,
        [planId, updatedClinicalContent],
      );
      audits = await client.query<{ action: string; changes: unknown }>(
        `SELECT "action", "changes" FROM "AuditLog"
         WHERE "target_type" = 'management_plan' AND "target_id" = $1
         ORDER BY "created_at", "id"`,
        [planId],
      );
      expect(audits.rows).toHaveLength(2);
      expect(audits.rows[1]?.action).toBe('management_plan.update');
      expect(audits.rows[1]?.changes).toMatchObject({
        changed_fields: expect.arrayContaining(['content', 'title']),
        request_trace: { request_id: 'req_12345678', correlation_id: 'cor_12345678' },
      });
      expect(JSON.stringify(audits.rows[1]?.changes)).not.toContain('updated title');
      expect(JSON.stringify(audits.rows[1]?.changes)).not.toContain(updatedClinicalContent);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
