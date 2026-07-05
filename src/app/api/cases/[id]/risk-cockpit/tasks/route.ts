import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { syncCaseRiskCockpitOperationalTasks } from '@/server/services/case-risk-task-sync';

async function authenticatedPOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'ケースリスクタスク同期の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('ケースIDが不正です');

  const result = await withOrgContext(
    ctx.orgId,
    (tx) =>
      syncCaseRiskCockpitOperationalTasks(tx, {
        orgId: ctx.orgId,
        caseId: id,
        userId: ctx.userId,
        role: ctx.role,
      }),
    { requestContext: ctx },
  );
  if (!result) return notFound('ケースが見つかりません');

  return success(result);
}

export async function POST(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    logger.error({
      event: 'route_handler_unhandled_error',
      route: req.nextUrl?.pathname,
      method: req.method,
      code: err instanceof Error ? err.name : typeof err,
    });
    return withSensitiveNoStore(internalError());
  }
}
