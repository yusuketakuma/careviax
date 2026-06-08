import { Client } from 'pg';
import {
  AUDIT_TRIGGER_CATALOG_SQL,
  describeAuditTriggerIssue,
  EXPECTED_AUDIT_TRIGGER_NAMES,
  validateAuditTriggerContracts,
} from './audit-trigger-contract';
import type { AuditTriggerCatalogRow } from './audit-trigger-contract';

async function queryValue<T>(client: Client, sql: string, params: unknown[] = []) {
  const result = await client.query<{ value: T }>(sql, params);
  return result.rows[0]?.value;
}

async function expectQueryFailure(client: Client, sql: string, params: unknown[] = []) {
  try {
    await client.query(sql, params);
  } catch {
    return;
  }

  throw new Error('Expected query to fail, but it succeeded');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const phOsFunctionCount = await queryValue<number>(
      client,
      `
        SELECT COUNT(*)::int AS value
        FROM pg_proc
        WHERE proname IN (
          'ph_os_write_audit_log',
          'ph_os_generate_audit_log_id',
          'ph_os_to_snake_case'
        )
      `,
    );
    if (phOsFunctionCount !== 3) {
      throw new Error(`Expected 3 ph_os audit functions, found ${phOsFunctionCount ?? 0}`);
    }

    const triggerResult = await client.query<AuditTriggerCatalogRow>(AUDIT_TRIGGER_CATALOG_SQL, [
      EXPECTED_AUDIT_TRIGGER_NAMES,
    ]);

    const triggerIssues = validateAuditTriggerContracts(triggerResult.rows);
    if (triggerIssues.length > 0) {
      throw new Error(
        `Audit trigger contract mismatch: ${triggerIssues
          .map(describeAuditTriggerIssue)
          .join(', ')}`,
      );
    }

    const taskId = `audit_verify_${Date.now()}`;
    const orgId = `audit_verify_org_${Date.now()}`;

    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL app.current_actor_id = 'audit_verify_user'");
      await client.query("SET LOCAL app.current_member_role = 'admin'");
      await client.query("SET LOCAL app.current_ip_address = '127.0.0.1'");
      await client.query("SET LOCAL app.current_user_agent = 'ph-os-audit-migration-check'");

      await client.query(
        `
          INSERT INTO "Task" ("id", "org_id", "title", "created_at", "updated_at")
          VALUES ($1, $2, 'PH-OS audit migration verification', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [taskId, orgId],
      );

      const countAfterInsert = await queryValue<number>(
        client,
        'SELECT COUNT(*)::int AS value FROM "AuditLog" WHERE "target_id" = $1',
        [taskId],
      );

      await client.query('UPDATE "Task" SET "title" = "title" WHERE "id" = $1', [taskId]);
      const countAfterNoop = await queryValue<number>(
        client,
        'SELECT COUNT(*)::int AS value FROM "AuditLog" WHERE "target_id" = $1',
        [taskId],
      );
      if (countAfterNoop !== countAfterInsert) {
        throw new Error('No-op Task update unexpectedly created an AuditLog entry');
      }

      await client.query('UPDATE "Task" SET "title" = $2 WHERE "id" = $1', [
        taskId,
        'PH-OS audit migration verification updated',
      ]);
      await client.query('DELETE FROM "Task" WHERE "id" = $1', [taskId]);

      const auditRows = await client.query<{
        action: string;
        target_type: string;
        actor_id: string;
        ip_address: string | null;
        user_agent: string | null;
        actor_role: string | null;
      }>(
        `
          SELECT
            "action",
            "target_type",
            "actor_id",
            "ip_address",
            "user_agent",
            "changes"->>'actor_role' AS actor_role
          FROM "AuditLog"
          WHERE "target_id" = $1
          ORDER BY "created_at" ASC
        `,
        [taskId],
      );

      const actions = auditRows.rows.map((row) => row.action);
      const expectedActions = ['task.create', 'task.update', 'task.delete'];
      if (actions.join('|') !== expectedActions.join('|')) {
        throw new Error(`Unexpected Task audit actions: ${actions.join(', ')}`);
      }

      for (const row of auditRows.rows) {
        if (
          row.target_type !== 'task' ||
          row.actor_id !== 'audit_verify_user' ||
          row.actor_role !== 'admin' ||
          row.ip_address !== '127.0.0.1' ||
          row.user_agent !== 'ph-os-audit-migration-check'
        ) {
          throw new Error(`Unexpected Task audit metadata: ${JSON.stringify(row)}`);
        }
      }
    } finally {
      await client.query('ROLLBACK');
    }

    const rlsTaskId = `rls_verify_${Date.now()}`;
    const rlsOrgId = `rls_verify_org_${Date.now()}`;
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE app_user');
      await expectQueryFailure(
        client,
        `
          INSERT INTO "Task" ("id", "org_id", "title", "created_at", "updated_at")
          VALUES ($1, $2, 'RLS context missing should fail', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [`${rlsTaskId}_missing`, rlsOrgId],
      );
    } finally {
      await client.query('ROLLBACK');
    }

    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE app_user');
      await client.query("SELECT set_config('app.rls_context_applied', $1, true)", ['true']);
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [rlsOrgId]);
      await client.query("SELECT set_config('app.current_actor_id', $1, true)", [
        'rls_verify_user',
      ]);
      await client.query("SELECT set_config('app.current_member_role', $1, true)", ['admin']);
      await client.query("SELECT set_config('app.current_ip_address', $1, true)", ['127.0.0.1']);
      await client.query("SELECT set_config('app.current_user_agent', $1, true)", [
        'ph-os-rls-migration-check',
      ]);
      await client.query(
        `
          INSERT INTO "Task" ("id", "org_id", "title", "created_at", "updated_at")
          VALUES ($1, $2, 'RLS same-org verification', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [rlsTaskId, rlsOrgId],
      );
      const sameOrgCount = await queryValue<number>(
        client,
        'SELECT COUNT(*)::int AS value FROM "Task" WHERE "id" = $1',
        [rlsTaskId],
      );
      if (sameOrgCount !== 1) {
        throw new Error('RLS same-org Task row was not visible to app_user');
      }

      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        'rls_verify_other_org',
      ]);
      const crossOrgCount = await queryValue<number>(
        client,
        'SELECT COUNT(*)::int AS value FROM "Task" WHERE "id" = $1',
        [rlsTaskId],
      );
      if (crossOrgCount !== 0) {
        throw new Error('RLS cross-org Task row was unexpectedly visible to app_user');
      }
    } finally {
      await client.query('ROLLBACK');
    }

    console.log(
      JSON.stringify({
        ok: true,
        ph_os_functions: phOsFunctionCount,
        triggers: triggerResult.rows.length,
        dml_actions_verified: ['task.create', 'task.update', 'task.delete'],
        rls_verified: ['missing_context_denied', 'same_org_allowed', 'cross_org_denied'],
      }),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
