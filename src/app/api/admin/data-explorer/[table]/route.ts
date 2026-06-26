import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { optionalBlankableBoundedIntegerSearchParam } from '@/lib/api/validation';
import { DATA_EXPLORER_MAX_OFFSET, listDataExplorerRows } from '@/server/services/data-explorer';

const searchParamsSchema = z.object({
  limit: optionalBlankableBoundedIntegerSearchParam('limit', 1, 100),
  offset: optionalBlankableBoundedIntegerSearchParam('offset', 0, DATA_EXPLORER_MAX_OFFSET),
  search: z.string().optional(),
});

async function dataExplorerGET(
  req: NextRequest,
  routeContext: AuthRouteContext<{ table: string }>,
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'データ探索画面の利用権限がありません',
  });
  if ('response' in authResult) return authResult.response;

  const { table } = await routeContext.params;
  const parsed = searchParamsSchema.safeParse({
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
    offset: req.nextUrl.searchParams.get('offset') ?? undefined,
    search: req.nextUrl.searchParams.get('search') ?? undefined,
  });

  if (!parsed.success) {
    return validationError('クエリが不正です', parsed.error.flatten().fieldErrors);
  }

  try {
    const data = await listDataExplorerRows(authResult.ctx.orgId, table, parsed.data);
    return success({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unknown table:')) {
      return validationError('対象テーブルが不正です');
    }
    throw error;
  }
}

export async function GET(req: NextRequest, routeContext: AuthRouteContext<{ table: string }>) {
  try {
    return withSensitiveNoStore(await dataExplorerGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
}
