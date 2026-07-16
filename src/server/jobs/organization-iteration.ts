import type { PrismaClient } from '@prisma/client';

const ORGANIZATION_PAGE_SIZE = 100;

/**
 * Enumerates tenant IDs without loading an unbounded organization table into memory.
 * Organization is the control-plane boundary; tenant data must be read separately
 * through withOrgContext for each returned ID.
 */
export async function listOrganizationIds(client: Pick<PrismaClient, 'organization'>) {
  const orgIds: string[] = [];
  let cursor: string | undefined;

  for (;;) {
    const organizations = await client.organization.findMany({
      orderBy: { id: 'asc' },
      take: ORGANIZATION_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });

    orgIds.push(...organizations.map(({ id }) => id));
    if (organizations.length < ORGANIZATION_PAGE_SIZE) break;
    cursor = organizations.at(-1)?.id;
  }

  return orgIds;
}
