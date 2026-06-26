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
  search: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string().max(100, 'search は100文字以内で指定してください').optional(),
  ),
});

const singleValueSearchParams = ['limit', 'offset', 'search'] as const;

function findInvalidDataExplorerQueryParams(searchParams: URLSearchParams) {
  const fieldErrors: Record<string, string[]> = {};

  for (const name of singleValueSearchParams) {
    if (searchParams.getAll(name).length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

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
  const invalidQueryParams = findInvalidDataExplorerQueryParams(req.nextUrl.searchParams);
  if (invalidQueryParams) {
    return validationError('クエリが不正です', invalidQueryParams);
  }

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
