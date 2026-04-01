import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { getPilotOrgAuditSnapshot } from '@/server/services/pilot-org-audit';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const snapshot = await getPilotOrgAuditSnapshot(req.orgId);
    return success({ data: snapshot });
  },
  {
    permission: 'canAdmin',
    message: 'pilot org audit の閲覧権限がありません',
  }
);
