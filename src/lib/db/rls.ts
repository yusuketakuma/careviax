import { Prisma, type PrismaClient } from '@prisma/client';
import { getRequestAuthContext, type RequestAuthContext } from '@/lib/auth/request-context';
import { prisma } from './client';
import { logSecurityEvent } from '@/lib/auth/security-events';

const SAFE_APP_ID_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;
const RLS_CONTEXT_SETTINGS = [
  ['app.current_org_id', (context: AppliedRlsContext) => context.orgId],
  ['app.rls_context_applied', () => 'true'],
  ['app.current_actor_id', (context: AppliedRlsContext) => context.requestContext?.userId],
  ['app.current_member_role', (context: AppliedRlsContext) => context.requestContext?.role],
  [
    'app.current_actor_pharmacy_id',
    (context: AppliedRlsContext) => context.requestContext?.actorPharmacyId ?? context.orgId,
  ],
  [
    'app.current_actor_site_id',
    (context: AppliedRlsContext) => context.requestContext?.actorSiteId,
  ],
  ['app.current_ip_address', (context: AppliedRlsContext) => context.requestContext?.ipAddress],
  ['app.current_user_agent', (context: AppliedRlsContext) => context.requestContext?.userAgent],
] as const;

type AppliedRlsContext = {
  orgId: string;
  requestContext: RequestAuthContext | undefined;
};

/**
 * Validates app-generated IDs before placing them in PostgreSQL session config.
 * The query is parameterized, but keeping the value to a narrow ID alphabet
 * prevents unsafe IDs from reaching RLS/audit context.
 */
function validateOrgId(orgId: string): void {
  if (!SAFE_APP_ID_PATTERN.test(orgId)) {
    throw new Error(`Invalid orgId format: must be a safe app id`);
  }
}

async function setLocalConfig(tx: Prisma.TransactionClient, key: string, value?: string) {
  await tx.$executeRaw(Prisma.sql`SELECT set_config(${key}, ${value ?? ''}, true)`);
}

async function applyRlsContext(tx: Prisma.TransactionClient, context: AppliedRlsContext) {
  for (const [key, resolveValue] of RLS_CONTEXT_SETTINGS) {
    await setLocalConfig(tx, key, resolveValue(context));
  }
}

/**
 * Executes a function within a PostgreSQL transaction with RLS context set.
 * Sets org and request metadata so RLS policies and audit triggers share the same context.
 */
export async function withOrgContext<T>(
  orgId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    requestContext?: RequestAuthContext;
    isolationLevel?: Prisma.TransactionIsolationLevel;
    maxWaitMs?: number;
    timeoutMs?: number;
  },
): Promise<T> {
  validateOrgId(orgId);
  const requestContext = options?.requestContext ?? getRequestAuthContext();
  if (requestContext?.orgId && requestContext.orgId !== orgId) {
    throw new Error(`Request orgId mismatch: expected ${requestContext.orgId}, received ${orgId}`);
  }

  if (!requestContext) {
    logSecurityEvent({
      event_type: 'rls_context_missing',
      org_id: orgId,
      path: 'db/withOrgContext',
      method: 'INTERNAL',
      details: { org_id: orgId },
    });
  }

  const work = async (tx: Prisma.TransactionClient) => {
    await applyRlsContext(tx, { orgId, requestContext });
    return fn(tx);
  };

  return prisma.$transaction(work, {
    ...(options?.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
    ...(options?.maxWaitMs ? { maxWait: options.maxWaitMs } : {}),
    ...(options?.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
}

/**
 * Minimal client surface the scoped runner needs: the interactive `$transaction`
 * overload that hands out a `Prisma.TransactionClient`. Lets tests inject a fake
 * client without dragging in the whole PrismaClient surface.
 */
type ScopedTxClient = {
  $transaction: <T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ) => Promise<T>;
};

/**
 * A single injected executor seam for RLS-scoped reads. Each call opens its own
 * short PostgreSQL transaction with RLS context applied, runs `work(tx)`, and
 * returns the result. The handed-out `tx` is the ONLY executor `work` should use;
 * there is no free-floating client to fall back onto.
 */
export type ScopedTxRunner = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

const SCOPED_TX_DEFAULT_TIMEOUT_MS = 3000;
const SCOPED_TX_MAX_WAIT_MS = 2000;

/**
 * Builds a {@link ScopedTxRunner} bound to a single org. Reuses the proven
 * `withOrgContext` machinery (validateOrgId / request-context default / orgId
 * mismatch guard / rls_context_missing log / applyRlsContext) but exposes the
 * `tx` to the caller so the timeline service can hand each source its own short
 * transaction. The global `prisma` client is reachable ONLY through the
 * `client ?? prisma` default here — callers inject a fake `client` in tests.
 */
export function createScopedTxRunner(
  orgId: string,
  options?: {
    requestContext?: RequestAuthContext;
    client?: ScopedTxClient;
    timeoutMs?: number;
  },
): ScopedTxRunner {
  validateOrgId(orgId);
  return (work) => {
    const requestContext = options?.requestContext ?? getRequestAuthContext();
    if (requestContext?.orgId && requestContext.orgId !== orgId) {
      throw new Error(
        `Request orgId mismatch: expected ${requestContext.orgId}, received ${orgId}`,
      );
    }

    if (!requestContext) {
      logSecurityEvent({
        event_type: 'rls_context_missing',
        org_id: orgId,
        path: 'db/createScopedTxRunner',
        method: 'INTERNAL',
        details: { org_id: orgId },
      });
    }

    const client: ScopedTxClient = options?.client ?? (prisma as PrismaClient);
    return client.$transaction(
      async (tx) => {
        await applyRlsContext(tx, { orgId, requestContext });
        return work(tx);
      },
      {
        timeout: options?.timeoutMs ?? SCOPED_TX_DEFAULT_TIMEOUT_MS,
        maxWait: SCOPED_TX_MAX_WAIT_MS,
      },
    );
  };
}
