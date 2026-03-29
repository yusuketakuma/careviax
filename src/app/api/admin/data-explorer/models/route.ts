import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { listDataExplorerModels } from '@/server/services/data-explorer';

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'データ探索画面の利用権限がありません',
  });
  if ('response' in authResult && authResult.response) return authResult.response;

  const data = await listDataExplorerModels(authResult.ctx.orgId);
  return success({ data });
}
