import { prisma } from './client';

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

/**
 * Executes a function within a PostgreSQL transaction with RLS context set.
 * Sets `app.current_org_id` session variable so RLS policies can filter by org.
 */
export async function withOrgContext<T>(
  orgId: string,
  fn: (tx: typeof prisma) => Promise<T>
): Promise<T> {
  validateOrgId(orgId);
  return prisma.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).$executeRawUnsafe(`SET LOCAL app.current_org_id = '${orgId}'`);
    return fn(tx as unknown as typeof prisma);
  });
}
