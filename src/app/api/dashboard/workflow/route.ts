import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import {
  RECENT_WINDOW_DAYS,
  UPCOMING_WINDOW_DAYS,
  WORKFLOW_CACHE_TTL_MS,
} from '@/lib/constants/workflow';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { serverCache } from '@/lib/utils/server-cache';
import {
  fetchWorkflowCoreData,
  fetchWorkflowDependentData,
  fetchWorkflowPhaseCoreData,
  fetchWorkflowPhaseDependentData,
  fetchWorkflowRealtimeCoreData,
} from '@/server/services/workflow-dashboard-queries';
import {
  buildWorkflowAssignmentScopeFingerprint,
  buildWorkflowCacheKey,
  type WorkflowDashboardView,
  WORKFLOW_DASHBOARD_VIEWS,
} from '@/server/services/workflow-dashboard-cache';
import { buildWorkflowDashboardData } from '@/server/services/workflow-dashboard-sections';
import { resolveDashboardAssignmentScope } from '@/server/services/dashboard-assignment-scope';
import { logger } from '@/lib/utils/logger';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE = '/api/dashboard/workflow';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

type WorkflowViewQuery =
  | { ok: true; view: WorkflowDashboardView }
  | { ok: false; response: ReturnType<typeof validationError> };

function parseWorkflowViewQuery(req: Request): WorkflowViewQuery {
  const values = new URL(req.url).searchParams.getAll('view');
  if (values.length === 0) return { ok: true, view: 'full' };
  if (values.length > 1) {
    return {
      ok: false,
      response: validationError('検索条件が不正です', {
        view: ['view は1つだけ指定してください'],
      }),
    };
  }

  const rawValue = values[0] ?? '';
  const view = rawValue.trim();
  if (
    !view ||
    view !== rawValue ||
    !WORKFLOW_DASHBOARD_VIEWS.includes(view as WorkflowDashboardView)
  ) {
    return {
      ok: false,
      response: validationError('検索条件が不正です', { view: ['view が不正です'] }),
    };
  }

  return { ok: true, view: view as WorkflowDashboardView };
}

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const viewQuery = parseWorkflowViewQuery(req);
    if (!viewQuery.ok) return viewQuery.response;

    // scheduled_date / shift date(@db.Date)比較用: ローカル日付の UTC 深夜
    const today = utcDateFromLocalKey(localDateKey());
    const view = viewQuery.view;
    const assignmentScope = await resolveDashboardAssignmentScope({
      db: prisma,
      orgId: ctx.orgId,
      accessContext: ctx,
    });
    const cacheKey = buildWorkflowCacheKey(
      ctx.orgId,
      ctx.role,
      ctx.userId,
      today,
      buildWorkflowAssignmentScopeFingerprint(assignmentScope),
      view,
    );
    const cachedData = serverCache.get<Record<string, unknown>>(cacheKey);
    if (cachedData) {
      return success(cachedData);
    }

    const upcomingWindow = addUtcDays(today, UPCOMING_WINDOW_DAYS);
    const sevenDaysFromNow = addUtcDays(today, RECENT_WINDOW_DAYS);
    const recentOutcomeWindow = addUtcDays(today, -RECENT_WINDOW_DAYS);

    const core =
      view === 'phase' || view === 'performance'
        ? await fetchWorkflowPhaseCoreData(
            prisma,
            ctx.orgId,
            today,
            upcomingWindow,
            sevenDaysFromNow,
            assignmentScope,
          )
        : view === 'realtime'
          ? await fetchWorkflowRealtimeCoreData(
              prisma,
              ctx.orgId,
              today,
              upcomingWindow,
              sevenDaysFromNow,
              assignmentScope,
            )
          : await fetchWorkflowCoreData(
              prisma,
              ctx.orgId,
              today,
              upcomingWindow,
              sevenDaysFromNow,
              recentOutcomeWindow,
              assignmentScope,
            );
    const dependent =
      view === 'phase' || view === 'realtime' || view === 'performance'
        ? await fetchWorkflowPhaseDependentData(prisma, ctx.orgId, core)
        : await fetchWorkflowDependentData(prisma, ctx.orgId, today, core, assignmentScope);

    const responsePayload = {
      data: buildWorkflowDashboardData({
        core,
        dependent,
        currentRole: ctx.role,
        sevenDaysFromNow,
        upcomingWindow,
      }),
    };

    serverCache.set(cacheKey, responsePayload, WORKFLOW_CACHE_TTL_MS);
    return success(responsePayload);
  });
}

export async function GET(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('dashboard_workflow_unhandled_error', undefined, {
        event: 'dashboard_workflow_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
