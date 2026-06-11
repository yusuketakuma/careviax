import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { resolveDashboardAssignmentScope } from '@/server/services/dashboard-assignment-scope';
import type { DashboardAssignmentScope } from '@/server/services/dashboard-assignment-scope';

function buildOverdueTaskAssignmentWhere(scope: DashboardAssignmentScope) {
  if (scope.caseIds === undefined && scope.patientIds === undefined) return {};

  const relatedEntityScope = [
    ...(scope.patientIds && scope.patientIds.length > 0
      ? [
          {
            related_entity_type: 'patient',
            related_entity_id: { in: scope.patientIds },
          },
        ]
      : []),
    ...(scope.caseIds && scope.caseIds.length > 0
      ? [
          {
            related_entity_type: 'case',
            related_entity_id: { in: scope.caseIds },
          },
        ]
      : []),
  ];

  return relatedEntityScope.length > 0 ? { OR: relatedEntityScope } : { id: { in: [] } };
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    // scheduled_date(@db.Date)比較用: ローカル日付の UTC 深夜
    const today = utcDateFromLocalKey(localDateKey());
    const now = new Date();
    const assignmentScope = await resolveDashboardAssignmentScope({
      db: prisma,
      orgId: req.orgId,
      accessContext: req,
    });
    const caseScope =
      assignmentScope.caseIds === undefined ? {} : { case_id: { in: assignmentScope.caseIds } };
    const patientScope =
      assignmentScope.patientIds === undefined
        ? {}
        : { patient_id: { in: assignmentScope.patientIds } };
    const taskAssignmentWhere = buildOverdueTaskAssignmentWhere(assignmentScope);
    const overdueTaskWhere = { OR: [{ due_date: { lt: now } }, { sla_due_at: { lt: now } }] };

    const [unrecordedVisits, unsentReports, overdueTasks] = await Promise.all([
      prisma.visitSchedule.findMany({
        where: {
          org_id: req.orgId,
          ...caseScope,
          scheduled_date: { lt: today },
          schedule_status: {
            notIn: ['completed', 'cancelled', 'postponed', 'rescheduled', 'no_show'],
          },
          visit_record: { is: null },
        },
        orderBy: [{ scheduled_date: 'asc' }, { time_window_start: 'asc' }],
        take: 20,
        select: {
          id: true,
          scheduled_date: true,
          schedule_status: true,
          case_: {
            select: {
              patient: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      }),
      prisma.careReport.findMany({
        where: {
          org_id: req.orgId,
          ...patientScope,
          status: { in: ['draft', 'failed', 'response_waiting'] },
        },
        orderBy: [{ updated_at: 'asc' }, { created_at: 'asc' }],
        take: 20,
        select: {
          id: true,
          patient_id: true,
          report_type: true,
          status: true,
          created_at: true,
          updated_at: true,
        },
      }),
      prisma.task.findMany({
        where: {
          org_id: req.orgId,
          status: { in: ['pending', 'in_progress'] },
          AND:
            Object.keys(taskAssignmentWhere).length === 0
              ? [overdueTaskWhere]
              : [taskAssignmentWhere, overdueTaskWhere],
        },
        orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
        take: 20,
        select: {
          id: true,
          task_type: true,
          title: true,
          priority: true,
          due_date: true,
          sla_due_at: true,
        },
      }),
    ]);

    const reportPatientIds = Array.from(new Set(unsentReports.map((item) => item.patient_id)));
    const reportPatients =
      reportPatientIds.length === 0
        ? []
        : await prisma.patient.findMany({
            where: {
              org_id: req.orgId,
              id: { in: reportPatientIds },
            },
            select: {
              id: true,
              name: true,
            },
          });
    const reportPatientNameById = new Map(
      reportPatients.map((patient) => [patient.id, patient.name]),
    );

    return success({
      summary: {
        unrecorded_visits: unrecordedVisits.length,
        unsent_reports: unsentReports.length,
        overdue_tasks: overdueTasks.length,
        total: unrecordedVisits.length + unsentReports.length + overdueTasks.length,
      },
      unrecorded_visits: unrecordedVisits.map((item) => ({
        id: item.id,
        patient_id: item.case_.patient.id,
        patient_name: item.case_.patient.name,
        scheduled_date: item.scheduled_date.toISOString(),
        schedule_status: item.schedule_status,
      })),
      unsent_reports: unsentReports.map((item) => ({
        id: item.id,
        patient_id: item.patient_id,
        patient_name: reportPatientNameById.get(item.patient_id) ?? '患者未登録',
        report_type: item.report_type,
        status: item.status,
        created_at: item.created_at.toISOString(),
        updated_at: item.updated_at.toISOString(),
      })),
      overdue_tasks: overdueTasks.map((item) => ({
        id: item.id,
        task_type: item.task_type,
        title: item.title,
        priority: item.priority,
        due_date: item.due_date?.toISOString() ?? null,
        sla_due_at: item.sla_due_at?.toISOString() ?? null,
      })),
    });
  },
  {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  },
);
