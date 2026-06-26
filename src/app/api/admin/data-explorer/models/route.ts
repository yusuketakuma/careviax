import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { internalError, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { listDataExplorerModels } from '@/server/services/data-explorer';

async function handleGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'データ探索画面の利用権限がありません',
  });
  if ('response' in authResult) return authResult.response;

  const data = await listDataExplorerModels(authResult.ctx.orgId);
  return success({ data });
}

export async function GET(req: NextRequest) {
  try {
    return withSensitiveNoStore(await handleGET(req));
  } catch {
    return withSensitiveNoStore(internalError());
  }
}
