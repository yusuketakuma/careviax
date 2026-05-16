import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
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
} from '@/server/services/workflow-dashboard-queries';
import {
  buildWorkflowAssignmentScopeFingerprint,
  buildWorkflowCacheKey,
} from '@/server/services/workflow-dashboard-cache';
import { buildWorkflowDashboardData } from '@/server/services/workflow-dashboard-sections';
import { resolveDashboardAssignmentScope } from '@/server/services/dashboard-assignment-scope';

function startOfDay(value = new Date()) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const today = startOfDay();
    const assignmentScope = await resolveDashboardAssignmentScope({
      db: prisma,
      orgId: req.orgId,
      accessContext: req,
    });
    const cacheKey = buildWorkflowCacheKey(
      req.orgId,
      req.role,
      req.userId,
      today,
      buildWorkflowAssignmentScopeFingerprint(assignmentScope),
    );
    const cachedData = serverCache.get<Record<string, unknown>>(cacheKey);
    if (cachedData) {
      return success(cachedData);
    }

    const upcomingWindow = new Date(today);
    upcomingWindow.setDate(upcomingWindow.getDate() + UPCOMING_WINDOW_DAYS);
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + RECENT_WINDOW_DAYS);
    const recentOutcomeWindow = new Date(today);
    recentOutcomeWindow.setDate(recentOutcomeWindow.getDate() - RECENT_WINDOW_DAYS);

    const core = await fetchWorkflowCoreData(
      prisma,
      req.orgId,
      today,
      upcomingWindow,
      sevenDaysFromNow,
      recentOutcomeWindow,
      assignmentScope,
    );
    const dependent = await fetchWorkflowDependentData(
      prisma,
      req.orgId,
      today,
      core,
      assignmentScope,
    );

    const responsePayload = {
      data: buildWorkflowDashboardData({
        core,
        dependent,
        currentRole: req.role,
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
