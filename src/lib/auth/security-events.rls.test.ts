import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const proofUrl = process.env.RLS_PROOF_DATABASE_URL;
const adminUrl = process.env.RLS_PROOF_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const describeProof = proofUrl ? describe : describe.skip;

function makeAuditId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

async function waitForAuditLog(
  pool: Pool,
  orgId: string,
  targetId: string,
): Promise<{ id: string; org_id: string; target_id: string; changes: unknown }> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await pool.query<{
      id: string;
      org_id: string;
      target_id: string;
      changes: unknown;
    }>(
      `SELECT id, org_id, target_id, changes
       FROM "AuditLog"
       WHERE org_id = $1 AND target_type = 'security_event' AND target_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [orgId, targetId],
    );
    if (result.rows[0]) return result.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('Timed out waiting for security event AuditLog row');
}

describeProof('logSecurityEvent real RLS persistence (RLS_PROOF_DATABASE_URL)', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    vi.resetModules();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('persists org-known security events through AuditLog FORCE RLS as NOSUPERUSER/NOBYPASSRLS', async () => {
    expect(proofUrl).toBeTruthy();
    expect(
      adminUrl,
      'RLS_PROOF_ADMIN_DATABASE_URL (or DATABASE_URL) must be set to a superuser connection for seeding',
    ).toBeTruthy();

    const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
    const proofPool = new Pool({ connectionString: proofUrl, max: 1 });
    const orgId = `org_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    const otherOrgId = `org_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    const pathId = randomUUID();
    const targetId = '/api/security-events/:id';

    try {
      const roleAttrs = await proofPool.query<{
        current_user: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `SELECT current_user,
                (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper,
                (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls`,
      );
      expect(roleAttrs.rows[0]?.rolsuper, 'proof role must NOT be a superuser').toBe(false);
      expect(roleAttrs.rows[0]?.rolbypassrls, 'proof role must NOT have BYPASSRLS').toBe(false);

      const tableReg = await adminPool.query<{ reg: string | null }>(
        `SELECT to_regclass('public."AuditLog"')::text AS reg`,
      );
      expect(tableReg.rows[0]?.reg, 'public."AuditLog" must exist in the proof DB').toBeTruthy();

      await expect(
        proofPool.query(
          `INSERT INTO "AuditLog"
             (id, org_id, actor_id, action, target_type, target_id, changes, created_at, updated_at)
           VALUES
             ($1, $2, 'anonymous', 'security:auth_failure', 'security_event', $3, '{}'::jsonb, now(), now())`,
          [makeAuditId('audit_noctx'), orgId, targetId],
        ),
      ).rejects.toThrow(/RLS context missing|row-level security|violates/i);

      vi.resetModules();
      process.env.DATABASE_URL = proofUrl;
      const { __resetSecurityEventDedupForTest, logSecurityEvent } =
        await import('./security-events');
      const { getPrismaClient } = await import('@/lib/db/client');
      __resetSecurityEventDedupForTest();

      logSecurityEvent({
        event_type: 'auth_failure',
        ip_address: '192.0.2.10',
        org_id: orgId,
        path: `/api/security-events/${pathId}?token=secret-path-token`,
        method: 'POST',
        details: { reason: 'rls_proof' },
      });

      const inserted = await waitForAuditLog(adminPool, orgId, targetId);
      expect(inserted.org_id).toBe(orgId);

      const proofClient = await proofPool.connect();
      try {
        await proofClient.query("SELECT set_config('app.current_org_id', $1, false)", [orgId]);
        await proofClient.query("SELECT set_config('app.rls_context_applied', 'true', false)");
        const visible = await proofClient.query<{
          id: string;
          org_id: string;
          target_id: string;
          changes: { method?: string; reason?: string };
        }>(
          `SELECT id, org_id, target_id, changes
           FROM "AuditLog"
           WHERE id = $1`,
          [inserted.id],
        );
        expect(visible.rows).toEqual([
          {
            id: inserted.id,
            org_id: orgId,
            target_id: targetId,
            changes: { method: 'POST', reason: 'rls_proof' },
          },
        ]);

        await proofClient.query("SELECT set_config('app.current_org_id', $1, false)", [otherOrgId]);
        await proofClient.query("SELECT set_config('app.rls_context_applied', 'true', false)");
        const hidden = await proofClient.query<{ id: string }>(
          `SELECT id FROM "AuditLog" WHERE id = $1`,
          [inserted.id],
        );
        expect(hidden.rows).toEqual([]);
      } finally {
        proofClient.release();
      }

      await getPrismaClient().$disconnect();
    } finally {
      await adminPool.query(`DELETE FROM "AuditLog" WHERE org_id = $1 AND target_id = $2`, [
        orgId,
        targetId,
      ]);
      await adminPool.end();
      await proofPool.end();
    }
  });
});
