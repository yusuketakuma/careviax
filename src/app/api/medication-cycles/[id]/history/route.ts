import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { internalError, success, notFound, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE_TEMPLATE = '/api/medication-cycles/[id]/history';

function authAuditRequest(req: NextRequest): NextRequest {
  return new NextRequest(new URL(ROUTE_TEMPLATE, req.url), {
    headers: req.headers,
    method: req.method,
  });
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(authAuditRequest(req), {
    permission: 'canViewDashboard',
    message: '処方サイクル履歴の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  return runWithRequestAuthContext(ctx, async () => {
    const { id: rawId } = await params;
    const cycleId = normalizeRequiredRouteParam(rawId);
    if (!cycleId) return validationError('処方サイクルIDが不正です');

    const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
    const cycle = await prisma.medicationCycle.findFirst({
      where: {
        id: cycleId,
        org_id: ctx.orgId,
        ...(caseAssignmentWhere ? { case_: caseAssignmentWhere } : {}),
      },
      select: { id: true },
    });
    if (!cycle) return notFound('サイクルが見つかりません');

    const logs = await prisma.cycleTransitionLog.findMany({
      where: { cycle_id: cycleId, org_id: ctx.orgId },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        from_status: true,
        to_status: true,
        actor_id: true,
        note: true,
        created_at: true,
      },
    });

    const actorIds = [...new Set(logs.map((log) => log.actor_id))];
    const users =
      actorIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true },
          });
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    const data = logs.map((log) => ({
      id: log.id,
      from_status: log.from_status,
      to_status: log.to_status,
      actor_name: userMap.get(log.actor_id) ?? '不明',
      note: log.note,
      created_at: log.created_at,
    }));

    return success(data);
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req, { params }));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'medication_cycle_history_unhandled_error',
          route: ROUTE_TEMPLATE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
