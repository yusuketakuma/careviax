import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { getUatFeedbackSummary } from '@/server/services/uat-feedback-summary';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const summary = await getUatFeedbackSummary(req.orgId);
    return success({ data: summary });
  },
  {
    permission: 'canAdmin',
    message: 'UAT フィードバック集計の閲覧権限がありません',
  }
);
