import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { listCommunicationQueue } from '@/server/services/communication-queue';

function isPreparationReady(preparation: {
  medication_changes_reviewed: boolean;
  carry_items_confirmed: boolean;
  previous_issues_reviewed: boolean;
  route_confirmed: boolean;
  offline_synced: boolean;
} | null) {
  return Boolean(
    preparation?.medication_changes_reviewed &&
      preparation.carry_items_confirmed &&
      preparation.previous_issues_reviewed &&
      preparation.route_confirmed &&
      preparation.offline_synced
  );
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const [
      totalVisits,
      completedVisits,
      inPreparationVisits,
      readyVisits,
      cancelledVisits,
      todaySchedules,
      reportBacklog,
      intakeDeadlines,
      taskBuckets,
      billingBlocked,
      overridePending,
      communicationQueue,
    ] = await Promise.all([
      prisma.visitSchedule.count({
        where: {
          org_id: req.orgId,
          scheduled_date: { gte: today, lt: tomorrow },
          schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        },
      }),
      prisma.visitSchedule.count({
        where: {
          org_id: req.orgId,
          scheduled_date: { gte: today, lt: tomorrow },
          schedule_status: 'completed',
        },
      }),
      prisma.visitSchedule.count({
        where: {
          org_id: req.orgId,
          scheduled_date: { gte: today, lt: tomorrow },
          schedule_status: 'in_preparation',
        },
      }),
      prisma.visitSchedule.count({
        where: {
          org_id: req.orgId,
          scheduled_date: { gte: today, lt: tomorrow },
          schedule_status: 'ready',
        },
      }),
      prisma.visitSchedule.count({
        where: {
          org_id: req.orgId,
          scheduled_date: { gte: today, lt: tomorrow },
          schedule_status: 'cancelled',
        },
      }),
      prisma.visitSchedule.findMany({
        where: {
          org_id: req.orgId,
          scheduled_date: {
            gte: today,
            lt: tomorrow,
          },
          schedule_status: {
            notIn: ['cancelled', 'rescheduled'],
          },
        },
        orderBy: [{ route_order: 'asc' }, { time_window_start: 'asc' }],
        take: 5,
        select: {
          id: true,
          scheduled_date: true,
          time_window_start: true,
          schedule_status: true,
          route_order: true,
          confirmed_at: true,
          carry_items_status: true,
          preparation: {
            select: {
              medication_changes_reviewed: true,
              carry_items_confirmed: true,
              previous_issues_reviewed: true,
              route_confirmed: true,
              offline_synced: true,
            },
          },
          case_: {
            select: {
              patient: {
                select: {
                  name: true,
                  residences: {
                    where: { is_primary: true },
                    take: 1,
                    select: {
                      address: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.careReport.findMany({
        where: {
          org_id: req.orgId,
          status: { in: ['draft', 'failed', 'response_waiting'] },
        },
        orderBy: [{ updated_at: 'desc' }],
        take: 5,
        select: {
          id: true,
          patient_id: true,
          report_type: true,
          status: true,
          created_at: true,
          updated_at: true,
          delivery_records: {
            select: {
              status: true,
            },
          },
        },
      }),
      prisma.prescriptionIntake.findMany({
        where: {
          org_id: req.orgId,
          OR: [
            {
              source_type: 'refill',
              refill_remaining_count: { gt: 0 },
              refill_next_dispense_date: {
                gte: today,
                lte: sevenDaysFromNow,
              },
            },
            {
              prescription_expiry_date: {
                gte: today,
                lte: sevenDaysFromNow,
              },
            },
          ],
        },
        orderBy: [
          { refill_next_dispense_date: 'asc' },
          { prescription_expiry_date: 'asc' },
          { prescribed_date: 'asc' },
        ],
        take: 5,
        select: {
          id: true,
          source_type: true,
          prescribed_date: true,
          prescription_expiry_date: true,
          refill_next_dispense_date: true,
          cycle: {
            select: {
              case_: {
                select: {
                  patient: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.task.groupBy({
        by: ['task_type'],
        where: {
          org_id: req.orgId,
          status: { in: ['pending', 'in_progress'] },
        },
        _count: { id: true },
      }),
      prisma.billingCandidate.count({
        where: {
          org_id: req.orgId,
          status: 'candidate',
        },
      }),
      prisma.visitScheduleOverride.count({
        where: {
          org_id: req.orgId,
          status: 'pending',
        },
      }),
      listCommunicationQueue(prisma, {
        orgId: req.orgId,
        limit: 5,
      }),
    ]);

    const reportPatientIds = Array.from(
      new Set(reportBacklog.map((item) => item.patient_id))
    );
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
    const reportPatientNameById = new Map(reportPatients.map((patient) => [patient.id, patient.name]));

    const pendingVisits = totalVisits - completedVisits;
    const taskCountByType = Object.fromEntries(taskBuckets.map((bucket) => [bucket.task_type, bucket._count.id]));
    const openTaskCount = taskBuckets.reduce((total, bucket) => total + bucket._count.id, 0);

    const roleFocusItems =
      req.role === 'pharmacist' || req.role === 'pharmacist_trainee'
        ? [
            { label: '本日の訪問', count: totalVisits, action_href: '/schedules' },
            { label: '準備未完了', count: taskCountByType.visit_preparation ?? 0, action_href: '/schedules' },
            { label: '報告送達待ち', count: reportBacklog.length, action_href: '/reports' },
          ]
        : req.role === 'clerk'
          ? [
              { label: '再架電待ち', count: communicationQueue.summary.callback_followups, action_href: '/external' },
              { label: '自己申告', count: communicationQueue.summary.self_reports, action_href: '/external' },
              { label: '請求レビュー', count: taskCountByType.billing_evidence_review ?? 0, action_href: '/billing/candidates' },
            ]
          : [
              { label: '例外変更承認', count: overridePending, action_href: '/schedules' },
              { label: '計画見直し', count: taskCountByType.management_plan_review ?? 0, action_href: '/workflow' },
              { label: '締めブロック', count: billingBlocked, action_href: '/billing' },
            ];

    return success({
      visits: {
        total: totalVisits,
        completed: completedVisits,
        pending: pendingVisits,
        in_preparation: inPreparationVisits,
        ready: readyVisits,
        cancelled: cancelledVisits,
      },
      tasks: {
        open: openTaskCount,
      },
      today_visits: todaySchedules.map((schedule) => ({
        id: schedule.id,
        patient_name: schedule.case_.patient.name,
        address: schedule.case_.patient.residences[0]?.address ?? '住所未登録',
        scheduled_time: schedule.time_window_start?.toISOString() ?? null,
        status: schedule.schedule_status,
        route_order: schedule.route_order,
        confirmed: Boolean(schedule.confirmed_at),
        preparation_ready: isPreparationReady(schedule.preparation),
        carry_items_status: schedule.carry_items_status,
      })),
      reports_backlog: reportBacklog.map((report) => ({
        id: report.id,
        patient_name: reportPatientNameById.get(report.patient_id) ?? '患者未登録',
        report_type: report.report_type,
        status: report.status,
        created_at: report.created_at.toISOString(),
        delivery_pending_count: report.delivery_records.filter((item) =>
          ['draft', 'failed', 'response_waiting'].includes(item.status)
        ).length,
      })),
      medication_deadlines: intakeDeadlines.map((intake) => {
        const dueAt =
          intake.refill_next_dispense_date ??
          intake.prescription_expiry_date ??
          intake.prescribed_date;
        const daysLeft = Math.max(
          0,
          Math.ceil((dueAt.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
        );
        return {
          id: intake.id,
          patient_name: intake.cycle?.case_?.patient.name ?? '患者未登録',
          due_at: dueAt.toISOString(),
          days_left: daysLeft,
          source_type: intake.source_type,
        };
      }),
      communication_queue: communicationQueue,
      role_focus: {
        role: req.role,
        items: roleFocusItems,
      },
    });
  },
  {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  }
);
