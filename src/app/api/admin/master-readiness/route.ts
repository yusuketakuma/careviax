import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/client';
import { success } from '@/lib/api/response';
import { buildAdminMasterReadinessSnapshot } from '@/server/services/admin-master-readiness';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const snapshot = await buildAdminMasterReadinessSnapshot(prisma, req.orgId);
    return success({ data: snapshot });
  },
  {
    permission: 'canAdmin',
    message: '設定・マスター整備状況の閲覧権限がありません',
  },
);
