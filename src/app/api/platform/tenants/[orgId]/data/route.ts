import type { NextRequest } from 'next/server';
import { forbiddenResponse, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { requirePlatformOperator } from '@/lib/platform/operator';
import { getActiveBreakGlassSession, readViaBreakGlass } from '@/lib/platform/break-glass';
import { listDataExplorerModels, listDataExplorerRows } from '@/server/services/data-explorer';

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Audited cross-tenant read against a target tenant. Requires an active
 * break-glass session for `orgId`. With no `?model`, returns the model list;
 * with `?model=X`, returns rows (paged/searchable). Every call is recorded as a
 * break_glass_read audit row scoped to the target tenant, and the underlying
 * query runs under RLS pinned to that tenant only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const guard = await requirePlatformOperator(req);
  if ('response' in guard) return guard.response;
  const { operator } = guard;

  const { orgId } = await params;
  const session = await getActiveBreakGlassSession(operator.operatorId, orgId);
  if (!session) {
    return withSensitiveNoStore(
      await forbiddenResponse('このテナントの有効なブレークグラスセッションがありません'),
    );
  }

  const url = req.nextUrl;
  const model = url.searchParams.get('model')?.trim() ?? '';

  try {
    if (!model) {
      const models = await readViaBreakGlass(
        operator,
        session,
        { targetType: 'data_explorer_models', targetId: orgId, metadata: { view: 'models' } },
        () => listDataExplorerModels(orgId),
      );
      return withSensitiveNoStore(success({ models }));
    }

    const limit = parseIntParam(url.searchParams.get('limit'), 25);
    const offset = parseIntParam(url.searchParams.get('offset'), 0);
    const search = url.searchParams.get('search')?.trim() || undefined;

    const rows = await readViaBreakGlass(
      operator,
      session,
      { targetType: 'data_explorer', targetId: model, metadata: { model, limit, offset } },
      () => listDataExplorerRows(orgId, model, { limit, offset, search }),
    );
    return withSensitiveNoStore(success(rows));
  } catch (err) {
    // getTableMeta throws for an unknown/non-allowlisted model.
    if (err instanceof Error && /model|table|allow/i.test(err.message)) {
      return withSensitiveNoStore(validationError('指定されたモデルは参照できません'));
    }
    throw err;
  }
}

export const dynamic = 'force-dynamic';
