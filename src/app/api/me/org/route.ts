import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const org = await prisma.organization.findUnique({
    where: { id: req.orgId },
    select: { name: true },
  });

  return success({ name: org?.name ?? '' });
});
