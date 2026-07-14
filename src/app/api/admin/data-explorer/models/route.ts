import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { listDataExplorerModels } from '@/server/services/data-explorer';

export const GET = withAuthContext(
  async (_req, ctx) => {
    const data = await listDataExplorerModels(ctx.orgId);
    return success({ data });
  },
  {
    permission: 'canAdmin',
    message: 'データ探索画面の利用権限がありません',
  },
);
