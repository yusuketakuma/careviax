import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { buildNavBadgePayload } from '@/server/services/nav-badges';

export const GET = withAuthContext(async (_req, ctx) => {
  const data = await buildNavBadgePayload(ctx);

  return success({ data });
});
