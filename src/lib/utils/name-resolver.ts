import type { PrismaClient } from '@prisma/client';

export async function batchResolveNames(
  prisma: PrismaClient,
  orgId: string,
  userIds: string[]
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { org_id: orgId, id: { in: userIds } },
    select: { id: true, name: true },
  });
  return new Map(users.map((user) => [user.id, user.name]));
}
