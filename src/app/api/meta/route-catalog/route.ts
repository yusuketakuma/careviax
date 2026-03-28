import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { routeCatalog } from '@/lib/api/route-catalog';

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'APIカタログの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;

  return success({ data: routeCatalog });
}
