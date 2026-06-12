import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { getPilotReadinessSnapshot } from '@/server/services/pilot-readiness';

export const GET = withAuthContext(
  async (_req, ctx) => {
    const snapshot = await getPilotReadinessSnapshot(ctx.orgId);
    return success({ data: snapshot });
  },
  {
    permission: 'canAdmin',
    message: 'pilot readiness の閲覧権限がありません',
  },
);
