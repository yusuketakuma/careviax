import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import type { Prisma } from '@prisma/client';

// The global prisma must NEVER be touched by createScopedTxRunner when a client
// is injected. Back it with a throwing proxy so any access fails the test loudly.
vi.mock('@/lib/db/client', () => ({
  prisma: new Proxy(
    {},
    {
      get() {
        throw new Error('global prisma must not be used when a client is injected');
      },
    },
  ),
}));

const logSecurityEventMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/security-events', () => ({
  logSecurityEvent: logSecurityEventMock,
}));

import { createScopedTxRunner, type ScopedTxRunner } from './rls';
import type { RequestAuthContext } from '@/lib/auth/request-context';

const ORG_ID = 'corg1234567890123456789012';
const REQUEST_CONTEXT: RequestAuthContext = {
  userId: 'user_1',
  orgId: ORG_ID,
  role: 'pharmacist',
};

/** Generic `$transaction` stub matching the interactive overload the runner uses. */
type TransactionFn = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeout?: number; maxWait?: number },
) => Promise<T>;

/**
 * Builds a `$transaction` stub bound to `fakeTx` plus a `vi.fn` recorder for the
 * call args. The recorder is non-generic (vi.fn loses generics), so the stub
 * itself stays generic while delegating arg capture to the recorder.
 */
function buildTransactionStub(fakeTx: Prisma.TransactionClient) {
  const recorder = vi.fn();
  const stub: TransactionFn = (fn, options) => {
    recorder(fn, options);
    return fn(fakeTx);
  };
  return { stub, recorder };
}

describe('createScopedTxRunner', () => {
  it('opens one short transaction per call with {timeout:3000,maxWait:2000} and applies RLS context on the handed-out tx', async () => {
    const executeRawSpy = vi.fn().mockResolvedValue(undefined);
    const fakeTx = { $executeRaw: executeRawSpy } as unknown as Prisma.TransactionClient;
    const { stub: transactionStub, recorder } = buildTransactionStub(fakeTx);

    const runScoped: ScopedTxRunner = createScopedTxRunner(ORG_ID, {
      requestContext: REQUEST_CONTEXT,
      client: { $transaction: transactionStub },
    });

    const sentinel = Symbol('work-result');
    const result = await runScoped(async (tx) => {
      // proves the handed-out executor is the injected fakeTx, not the global prisma
      expect(tx).toBe(fakeTx);
      return sentinel;
    });

    expect(result).toBe(sentinel);
    // exactly one transaction was opened with the exact short-tx budget
    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 3000,
      maxWait: 2000,
    });
    // applyRlsContext ran on fakeTx: the 8 set_config writes (one per RLS setting)
    expect(executeRawSpy).toHaveBeenCalledTimes(8);
    // a valid request context means no rls_context_missing security event
    expect(logSecurityEventMock).not.toHaveBeenCalled();
  });

  it('logs rls_context_missing (without touching the global prisma) when no request context is present', async () => {
    const executeRawSpy = vi.fn().mockResolvedValue(undefined);
    const fakeTx = { $executeRaw: executeRawSpy } as unknown as Prisma.TransactionClient;
    const { stub: transactionStub } = buildTransactionStub(fakeTx);

    const runScoped = createScopedTxRunner(ORG_ID, {
      requestContext: undefined,
      client: { $transaction: transactionStub },
    });
    await runScoped(async () => 'ok');

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'rls_context_missing', org_id: ORG_ID }),
    );
    expect(executeRawSpy).toHaveBeenCalledTimes(8);
  });

  it('rejects an orgId that fails the safe-app-id guard before opening a transaction', () => {
    const transactionSpy = vi.fn();
    expect(() =>
      createScopedTxRunner('BAD ORG ID', { client: { $transaction: transactionSpy } }),
    ).toThrow(/safe app id/);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it('throws on a request-context orgId mismatch instead of running the work', () => {
    const transactionSpy = vi.fn();
    const runScoped = createScopedTxRunner(ORG_ID, {
      requestContext: { ...REQUEST_CONTEXT, orgId: 'corgotherotherotherotherother' },
      client: { $transaction: transactionSpy },
    });

    expect(() => runScoped(async () => 'never')).toThrow(/Request orgId mismatch/);
    expect(transactionSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FORCE RLS non-superuser proof (env-gated integration; resolves BLOCKED.md
// rls-force-nonsuperuser-proof)
//
// The unit suite above proves only that withOrgContext/createScopedTxRunner
// applies app.current_org_id via set_config (structural). It does NOT prove that
// PostgreSQL FORCE RLS actually denies a *non-superuser* cross-org rows — the
// E2E/dev super role (ph_os) BYPASSES FORCE RLS, so an isolation assertion run
// under it would pass vacuously.
//
// This block connects as the dedicated NOSUPERUSER + NOBYPASSRLS role
// (RLS_PROOF_DATABASE_URL → ph_os_app, provisioned by
// tools/scripts/setup-rls-test-role.sql) and proves, on a real PostgreSQL
// engine, that the same tenant_isolation policy shape used in
// prisma/rls-policies.sql denies cross-org SELECT / UPDATE / INSERT.
//
// Env-gated: skips entirely when RLS_PROOF_DATABASE_URL is unset so CI/dev
// environments without a provisioned non-superuser role are not broken.
//   - RLS_PROOF_DATABASE_URL        : non-superuser (ph_os_app) connection under test
//   - RLS_PROOF_ADMIN_DATABASE_URL  : superuser connection for DDL/seed/cleanup
//                                     (defaults to DATABASE_URL)
// ─────────────────────────────────────────────────────────────────────────────

const proofUrl = process.env.RLS_PROOF_DATABASE_URL;
const adminUrl = process.env.RLS_PROOF_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const describeProof = proofUrl ? describe : describe.skip;

/** The exact tenant_isolation policy shape used across prisma/rls-policies.sql. */
const TENANT_ISOLATION_USING = "org_id = current_setting('app.current_org_id', true)";

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

describeProof('FORCE RLS non-superuser proof (RLS_PROOF_DATABASE_URL)', () => {
  it('denies a NOSUPERUSER role cross-org SELECT/UPDATE/INSERT under FORCE ROW LEVEL SECURITY', async () => {
    expect(proofUrl).toBeTruthy();
    expect(
      adminUrl,
      'RLS_PROOF_ADMIN_DATABASE_URL (or DATABASE_URL) must be set to a superuser connection for seeding',
    ).toBeTruthy();

    const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
    const proofPool = new Pool({ connectionString: proofUrl, max: 1 });
    const schema = `rls_proof_${randomUUID().replaceAll('-', '_')}`;

    try {
      // ── Anti-vacuity guard: the role under test MUST be a genuine RLS subject.
      // If RLS_PROOF_DATABASE_URL were pointed at a superuser / BYPASSRLS role
      // the whole proof would pass vacuously — fail loudly instead.
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

      // ── Ensure the non-superuser role is provisioned (self-heal so local runs
      // work without a separate psql step). Idempotent.
      const roleSql = readFileSync(
        join(process.cwd(), 'tools/scripts/setup-rls-test-role.sql'),
        'utf8',
      );
      await adminPool.query(roleSql);

      // ── Build a throwaway schema carrying the exact tenant_isolation policy
      // shape from prisma/rls-policies.sql (ENABLE + FORCE + USING/WITH CHECK on
      // current_setting('app.current_org_id')). Seeding runs as the superuser
      // admin (which bypasses RLS) so both orgs' rows exist before we switch to
      // the constrained role.
      const q = quoteIdent(schema);
      await adminPool.query(`CREATE SCHEMA ${q}`);
      await adminPool.query(
        `CREATE TABLE ${q}.rls_proof_patient (
           org_id text NOT NULL,
           id text PRIMARY KEY,
           name text NOT NULL
         )`,
      );
      await adminPool.query(`ALTER TABLE ${q}.rls_proof_patient ENABLE ROW LEVEL SECURITY`);
      await adminPool.query(
        `CREATE POLICY tenant_isolation ON ${q}.rls_proof_patient
           USING (${TENANT_ISOLATION_USING})
           WITH CHECK (${TENANT_ISOLATION_USING})`,
      );
      await adminPool.query(`ALTER TABLE ${q}.rls_proof_patient FORCE ROW LEVEL SECURITY`);
      await adminPool.query(`GRANT USAGE ON SCHEMA ${q} TO ph_os_app`);
      await adminPool.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${q}.rls_proof_patient TO ph_os_app`,
      );
      await adminPool.query(
        `INSERT INTO ${q}.rls_proof_patient (org_id, id, name)
         VALUES ('org_a', 'pa', 'Alice'), ('org_b', 'pb', 'Bob')`,
      );

      const proofClient = await proofPool.connect();
      try {
        await proofClient.query(`SET search_path TO ${q}, public`);
        await proofClient.query("SELECT set_config('app.current_org_id', 'org_a', false)");

        // SELECT: only org_a is visible.
        const visible = await proofClient.query<{ id: string; org_id: string }>(
          'SELECT id, org_id FROM rls_proof_patient ORDER BY id',
        );
        expect(visible.rows).toEqual([{ id: 'pa', org_id: 'org_a' }]);

        // UPDATE of the other org's row is silently filtered (0 rows affected) —
        // the row is not even visible to the USING clause.
        const crossOrgUpdate = await proofClient.query(
          "UPDATE rls_proof_patient SET name = 'HACKED' WHERE id = 'pb'",
        );
        expect(crossOrgUpdate.rowCount).toBe(0);

        // INSERT into the other org is rejected by WITH CHECK.
        await expect(
          proofClient.query(
            `INSERT INTO rls_proof_patient (org_id, id, name)
             VALUES ('org_b', 'pc', 'Carol')`,
          ),
        ).rejects.toThrow(/row-level security|violates/i);

        // Fail-close: with no org context set, the role sees nothing.
        await proofClient.query("SELECT set_config('app.current_org_id', '', false)");
        const withoutContext = await proofClient.query('SELECT id FROM rls_proof_patient');
        expect(withoutContext.rows).toEqual([]);
      } finally {
        proofClient.release();
      }

      // Admin (superuser) confirms the cross-org row was never mutated.
      const untouched = await adminPool.query<{ name: string }>(
        `SELECT name FROM ${q}.rls_proof_patient WHERE id = 'pb'`,
      );
      expect(untouched.rows[0]?.name).toBe('Bob');

      // ── Opportunistic real-table proof: when a migrated public."Patient"
      // exists (local E2E DB after W1-7 migrations), prove the SAME denial on
      // the actual migrated policy. Skipped where the table is absent (e.g. the
      // empty CI RLS-gate DB), so the self-contained proof above always runs.
      const patientReg = await adminPool.query<{ reg: string | null }>(
        `SELECT to_regclass('public."Patient"')::text AS reg`,
      );
      if (patientReg.rows[0]?.reg) {
        const seededOrg = await adminPool.query<{ org_id: string; n: string }>(
          'SELECT org_id, count(*)::text AS n FROM "Patient" GROUP BY org_id ORDER BY count(*) DESC LIMIT 1',
        );
        if (seededOrg.rows[0]) {
          const orgId = seededOrg.rows[0].org_id;
          const orgCount = Number(seededOrg.rows[0].n);
          const realClient = await proofPool.connect();
          // Counts "Patient" rows the non-superuser can see under the given org
          // context. Real migrated tables use one of two tenant_isolation shapes:
          // current_setting('app.current_org_id') (missing → NULL → 0 rows) or the
          // fail-close public.app_enforced_org_id() (missing → RAISE). Both are
          // fail-close; treat a raised "RLS context missing" as "0 visible rows".
          const countPatients = async (org: string | null): Promise<number | 'raised'> => {
            await realClient.query("SELECT set_config('app.rls_context_applied', $1, false)", [
              org === null ? '' : 'true',
            ]);
            await realClient.query("SELECT set_config('app.current_org_id', $1, false)", [
              org ?? '',
            ]);
            try {
              const r = await realClient.query<{ n: string }>(
                'SELECT count(*)::text AS n FROM "Patient"',
              );
              return Number(r.rows[0]?.n);
            } catch (err) {
              if (/RLS context missing|row-level security/i.test(String(err))) {
                return 'raised';
              }
              throw err;
            }
          };
          try {
            // No context → fail-close (0 rows or a raised context-missing error).
            expect([0, 'raised']).toContain(await countPatients(null));

            // Correct org context → sees exactly that org's rows.
            expect(await countPatients(orgId)).toBe(orgCount);

            // A different (bogus) org → sees nothing (cross-org SELECT denied).
            expect(await countPatients('org_that_does_not_exist')).toBe(0);
          } finally {
            realClient.release();
          }
        }
      }
    } finally {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      await adminPool.end();
      await proofPool.end();
    }
  });
});
