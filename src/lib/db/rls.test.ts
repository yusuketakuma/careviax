import { describe, expect, it, vi } from 'vitest';
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

  it.skip('non-superuser role is denied cross-org timeline rows by FORCE RLS — BLOCKED: structural RLS context proof only; non-superuser FORCE-RLS proof blocked (E2E DB role ph_os is superuser and bypasses FORCE RLS; needs a dedicated non-superuser role + cross-org seed)', async () => {
    // Proof gap: see BLOCKED.md rls-force-nonsuperuser-proof.
    // The unit suite proves withOrgContext/createScopedTxRunner applies app.current_org_id via set_config (structural),
    // NOT that Postgres FORCE RLS denies a non-superuser cross-org rows.
  });
});
