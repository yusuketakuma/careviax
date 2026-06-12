import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { getPilotOrgAuditSnapshot } from '@/server/services/pilot-org-audit';

export const GET = withAuthContext(
  async (_req, ctx) => {
    const snapshot = await getPilotOrgAuditSnapshot(ctx.orgId);
    return success({ data: snapshot });
  },
  {
    permission: 'canAdmin',
    message: 'pilot org audit の閲覧権限がありません',
  },
);
