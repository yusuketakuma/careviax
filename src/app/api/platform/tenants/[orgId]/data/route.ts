import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { forbiddenResponse, internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { optionalBlankableBoundedIntegerSearchParam } from '@/lib/api/validation';
import { requirePlatformOperator } from '@/lib/platform/operator';
import { getActiveBreakGlassSession, readViaBreakGlass } from '@/lib/platform/break-glass';
import {
  DATA_EXPLORER_MAX_OFFSET,
  listDataExplorerModels,
  listDataExplorerRows,
} from '@/server/services/data-explorer';

function optionalTrimmedStringSearchParam(fieldName: string, maxLength: number) {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    },
    z.string().max(maxLength, `${fieldName} は${maxLength}文字以内で指定してください`).optional(),
  );
}

const searchParamsSchema = z.object({
  model: optionalTrimmedStringSearchParam('model', 100),
  limit: optionalBlankableBoundedIntegerSearchParam('limit', 1, 100),
  offset: optionalBlankableBoundedIntegerSearchParam('offset', 0, DATA_EXPLORER_MAX_OFFSET),
  search: optionalTrimmedStringSearchParam('search', 100),
});

const singleValueSearchParams = ['model', 'limit', 'offset', 'search'] as const;

function findDuplicateSearchParams(searchParams: URLSearchParams) {
  const fieldErrors: Record<string, string[]> = {};
  for (const name of singleValueSearchParams) {
    if (searchParams.getAll(name).length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
    }
  }
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * Audited cross-tenant read against a target tenant. Requires an active
 * break-glass session for `orgId`. With no `?model`, returns the model list;
 * with `?model=X`, returns rows (paged/searchable). Every call is recorded as a
 * break_glass_read audit row scoped to the target tenant, and the underlying
 * query runs under RLS pinned to that tenant only.
 */
async function dataExplorerGET(req: NextRequest, { params }: RouteContext) {
  const guard = await requirePlatformOperator(req);
  if ('response' in guard) return guard.response;
  const { operator } = guard;

  const { orgId } = await params;
  const session = await getActiveBreakGlassSession(operator.operatorId, orgId);
  if (!session) {
    return forbiddenResponse('このテナントの有効なブレークグラスセッションがありません');
  }

  const duplicateParams = findDuplicateSearchParams(req.nextUrl.searchParams);
  if (duplicateParams) {
    return validationError('クエリが不正です', duplicateParams);
  }

  const parsed = searchParamsSchema.safeParse({
    model: req.nextUrl.searchParams.get('model') ?? undefined,
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
    offset: req.nextUrl.searchParams.get('offset') ?? undefined,
    search: req.nextUrl.searchParams.get('search') ?? undefined,
  });
  if (!parsed.success) {
    return validationError('クエリが不正です', parsed.error.flatten().fieldErrors);
  }

  const { model, search } = parsed.data;

  try {
    if (!model) {
      const models = await readViaBreakGlass(
        operator,
        session,
        { targetType: 'data_explorer_models', targetId: orgId, metadata: { view: 'models' } },
        () => listDataExplorerModels(orgId),
      );
      return success({ data: models });
    }

    const limit = parsed.data.limit ?? 25;
    const offset = parsed.data.offset ?? 0;

    const rows = await readViaBreakGlass(
      operator,
      session,
      { targetType: 'data_explorer', targetId: model, metadata: { model, limit, offset } },
      () => listDataExplorerRows(orgId, model, { limit, offset, search }),
    );
    return success({ data: rows });
  } catch (err) {
    // getTableMeta throws for an unknown/non-allowlisted model.
    if (err instanceof Error && err.message.startsWith('Unknown table:')) {
      return validationError('指定されたモデルは参照できません');
    }
    throw err;
  }
}

export async function GET(req: NextRequest, routeContext: RouteContext) {
  try {
    return withSensitiveNoStore(await dataExplorerGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
}

export const dynamic = 'force-dynamic';
