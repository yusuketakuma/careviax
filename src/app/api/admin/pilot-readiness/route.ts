import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { getPilotReadinessSnapshot } from '@/server/services/pilot-readiness';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const snapshot = await getPilotReadinessSnapshot(req.orgId);
    return success({ data: snapshot });
  },
  {
    permission: 'canAdmin',
    message: 'pilot readiness の閲覧権限がありません',
  }
);
