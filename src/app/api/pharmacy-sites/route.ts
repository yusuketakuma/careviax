import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const sites = await prisma.pharmacySite.findMany({
    where: {
      org_id: req.orgId,
    },
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      lat: true,
      lng: true,
    },
    orderBy: [{ name: 'asc' }],
  });

  return success({ data: sites });
}, {
  permission: 'canVisit',
  message: '店舗情報の閲覧権限がありません',
});
