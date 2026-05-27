import { Client } from 'pg';

const EXPECTED_AUDIT_TRIGGERS = [
  'audit_log_patient',
  'audit_log_care_case',
  'audit_log_consent_record',
  'audit_log_management_plan',
  'audit_log_visit_schedule',
  'audit_log_visit_record',
  'audit_log_communication_request',
  'audit_log_care_report',
  'audit_log_external_access_grant',
  'audit_log_workflow_exception',
  'audit_log_task',
  'audit_log_dispense_result',
  'audit_log_dispense_audit',
  'audit_log_set_audit',
] as const;

async function queryValue<T>(client: Client, sql: string, params: unknown[] = []) {
  const result = await client.query<{ value: T }>(sql, params);
  return result.rows[0]?.value;
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

    const triggerResult = await client.query<{
      tgname: string;
      table_name: string;
      function_name: string;
    }>(
      `
        SELECT
          pg_trigger.tgname AS tgname,
          table_class.relname AS table_name,
          pg_proc.proname AS function_name
        FROM pg_trigger
        JOIN pg_class AS table_class ON table_class.oid = pg_trigger.tgrelid
        JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
        WHERE NOT pg_trigger.tgisinternal
          AND pg_trigger.tgname = ANY($1::text[])
        ORDER BY pg_trigger.tgname
      `,
      [EXPECTED_AUDIT_TRIGGERS],
    );

    const triggerNames = new Set(triggerResult.rows.map((row) => row.tgname));
    const missingTriggers = EXPECTED_AUDIT_TRIGGERS.filter((name) => !triggerNames.has(name));
    if (missingTriggers.length > 0) {
      throw new Error(`Missing audit triggers: ${missingTriggers.join(', ')}`);
    }

    const wrongFunctionTriggers = triggerResult.rows.filter(
      (row) => row.function_name !== 'ph_os_write_audit_log',
    );
    if (wrongFunctionTriggers.length > 0) {
      throw new Error(
        `Audit triggers not using ph_os_write_audit_log: ${wrongFunctionTriggers
          .map((row) => `${row.tgname}:${row.function_name}`)
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

    console.log(
      JSON.stringify({
        ok: true,
        ph_os_functions: phOsFunctionCount,
        triggers: triggerResult.rows.length,
        dml_actions_verified: ['task.create', 'task.update', 'task.delete'],
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
