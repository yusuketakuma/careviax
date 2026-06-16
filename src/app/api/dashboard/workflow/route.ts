import { withAuthContext } from '@/lib/auth/context';
import {
  RECENT_WINDOW_DAYS,
  UPCOMING_WINDOW_DAYS,
  WORKFLOW_CACHE_TTL_MS,
} from '@/lib/constants/workflow';
import { success } from '@/lib/api/response';
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
} from '@/server/services/workflow-dashboard-cache';
import { buildWorkflowDashboardData } from '@/server/services/workflow-dashboard-sections';
import { resolveDashboardAssignmentScope } from '@/server/services/dashboard-assignment-scope';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';

export const GET = withAuthContext(
  async (req, ctx) => {
    // scheduled_date / shift date(@db.Date)比較用: ローカル日付の UTC 深夜
    const today = utcDateFromLocalKey(localDateKey());
    const requestedView = new URL(req.url).searchParams.get('view');
    const view = requestedView === 'phase' || requestedView === 'realtime' ? requestedView : 'full';
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
      view === 'phase'
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
      view === 'phase' || view === 'realtime'
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
