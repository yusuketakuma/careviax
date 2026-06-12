import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuthContext(async (_req, ctx) => {
  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { name: true },
  });

  return success({ name: org?.name ?? '' });
});
