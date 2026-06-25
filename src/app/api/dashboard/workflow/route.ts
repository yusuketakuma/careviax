import { withAuthContext } from '@/lib/auth/context';
import {
  RECENT_WINDOW_DAYS,
  UPCOMING_WINDOW_DAYS,
  WORKFLOW_CACHE_TTL_MS,
} from '@/lib/constants/workflow';
import { success, validationError } from '@/lib/api/response';
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
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';

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

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
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
  },
  {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedGET(req, routeContext));
