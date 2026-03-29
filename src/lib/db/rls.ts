import { Prisma } from '@prisma/client';
import {
  getRequestAuthContext,
  type RequestAuthContext,
} from '@/lib/auth/request-context';
import { prisma } from './client';
import { logSecurityEvent } from '@/lib/auth/security-events';

// cuid v2 format: starts with 'c', 24-28 alphanumeric chars
// cuid v1 format: starts with 'c', followed by 24 lowercase alphanumeric chars
const CUID_PATTERN = /^c[a-z0-9]{20,30}$/;

/**
 * Validates that the given string is a safe cuid to prevent SQL injection.
 * RLS helper uses $executeRawUnsafe, so org_id must be validated before use.
 */
function validateOrgId(orgId: string): void {
  if (!CUID_PATTERN.test(orgId)) {
    throw new Error(`Invalid orgId format: must be a valid cuid`);
  }
}

async function setLocalConfig(
  tx: Prisma.TransactionClient,
  key: string,
  value?: string
) {
  await tx.$executeRaw(Prisma.sql`SELECT set_config(${key}, ${value ?? ''}, true)`);
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
  }
): Promise<T> {
  validateOrgId(orgId);
  const requestContext = options?.requestContext ?? getRequestAuthContext();

  if (!requestContext) {
    logSecurityEvent({
      event_type: 'rls_context_missing',
      org_id: orgId,
      path: 'db/withOrgContext',
      method: 'INTERNAL',
      details: { org_id: orgId },
    });
  }

  return prisma.$transaction(async (tx) => {
    await setLocalConfig(tx, 'app.current_org_id', orgId);
    await setLocalConfig(tx, 'app.current_actor_id', requestContext?.userId);
    await setLocalConfig(tx, 'app.current_member_role', requestContext?.role);
    await setLocalConfig(tx, 'app.current_ip_address', requestContext?.ipAddress);
    await setLocalConfig(tx, 'app.current_user_agent', requestContext?.userAgent);
    return fn(tx);
  });
}
