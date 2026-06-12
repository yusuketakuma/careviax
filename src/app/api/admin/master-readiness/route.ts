import { withAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { success } from '@/lib/api/response';
import { buildAdminMasterReadinessSnapshot } from '@/server/services/admin-master-readiness';

export const GET = withAuthContext(
  async (_req, ctx) => {
    const snapshot = await buildAdminMasterReadinessSnapshot(prisma, ctx.orgId);
    return success({ data: snapshot });
  },
  {
    permission: 'canAdmin',
    message: '設定・マスター整備状況の閲覧権限がありません',
  },
);
