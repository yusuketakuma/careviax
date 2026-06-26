import { withAuthContext } from '@/lib/auth/context';
import { internalError, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import {
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';

const authenticatedGET = withAuthContext(
  async (_req, ctx) => {
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
  },
  {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
};
