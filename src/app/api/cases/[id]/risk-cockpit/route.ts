import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { getCaseRiskCockpit } from '@/server/services/case-risk-cockpit';

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'ケースリスク参照の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('ケースIDが不正です');

  const cockpit = await withOrgContext(
    ctx.orgId,
    (tx) =>
      getCaseRiskCockpit(tx, {
        orgId: ctx.orgId,
        caseId: id,
        userId: ctx.userId,
        role: ctx.role,
      }),
    { requestContext: ctx },
  );
  if (!cockpit) return notFound('ケースが見つかりません');

  return success(cockpit);
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
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
