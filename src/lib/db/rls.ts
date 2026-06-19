import { Prisma } from '@prisma/client';
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
