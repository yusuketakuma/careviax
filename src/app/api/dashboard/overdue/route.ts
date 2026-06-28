import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { internalError, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { withRoutePerformance } from '@/lib/utils/performance';
import {
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';

const ROUTE = '/api/dashboard/overdue';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

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
    // scheduled_date(@db.Date)比較用: ローカル日付の UTC 深夜
    const today = utcDateFromLocalKey(localDateKey());
    const now = new Date();
    const assignmentScope = await resolveDashboardAssignmentScope({
      db: prisma,
      orgId: ctx.orgId,
      accessContext: ctx,
    });
    const caseScope =
      assignmentScope.caseIds === undefined ? {} : { case_id: { in: assignmentScope.caseIds } };
    const patientScope =
      assignmentScope.patientIds === undefined
        ? {}
        : { patient_id: { in: assignmentScope.patientIds } };
    const taskAssignmentWhere = buildDashboardTaskAssignmentWhere(assignmentScope);
    const overdueTaskWhere = { OR: [{ due_date: { lt: now } }, { sla_due_at: { lt: now } }] };

    const [unrecordedVisitCount, unsentReportCount, overdueTaskCount] = await Promise.all([
      prisma.visitSchedule.count({
        where: {
          org_id: ctx.orgId,
          ...caseScope,
          scheduled_date: { lt: today },
          schedule_status: {
            notIn: ['completed', 'cancelled', 'postponed', 'rescheduled', 'no_show'],
          },
          visit_record: { is: null },
        },
      }),
      prisma.careReport.count({
        where: {
          org_id: ctx.orgId,
          ...patientScope,
          status: { in: ['draft', 'failed', 'response_waiting'] },
        },
      }),
      prisma.task.count({
        where: {
          org_id: ctx.orgId,
          status: { in: ['pending', 'in_progress'] },
          AND:
            Object.keys(taskAssignmentWhere).length === 0
              ? [overdueTaskWhere]
              : [taskAssignmentWhere, overdueTaskWhere],
        },
      }),
    ]);

    return success({
      summary: {
        unrecorded_visits: unrecordedVisitCount,
        unsent_reports: unsentReportCount,
        overdue_tasks: overdueTaskCount,
        total: unrecordedVisitCount + unsentReportCount + overdueTaskCount,
      },
    });
  });
}

export async function GET(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('dashboard_overdue_unhandled_error', undefined, {
        event: 'dashboard_overdue_unhandled_error',
        route: ROUTE,
        method: 'GET',
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
