import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { getUatFeedbackSummary } from '@/server/services/uat-feedback-summary';

export const GET = withAuthContext(
  async (_req, ctx) => {
    const summary = await getUatFeedbackSummary(ctx.orgId);
    return success({ data: summary });
  },
  {
    permission: 'canAdmin',
    message: 'UAT フィードバック集計の閲覧権限がありません',
  },
);
