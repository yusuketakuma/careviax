import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { formatDateKey } from '@/lib/date-key';
import { prisma } from '@/lib/db/client';

const KPI_ROLES = ['owner', 'admin', 'pharmacist', 'pharmacist_trainee'] as const;

function parseMonthRange(month: string | null) {
  if (month === null) {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      label: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    };
  }

  const normalizedMonth = month.trim();
  const match = normalizedMonth.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  const monthIndex = monthNumber - 1;
  const start = new Date(year, monthIndex, 1);
  if (start.getFullYear() !== year || start.getMonth() !== monthIndex) {
    return null;
  }

  return {
    start,
    end: new Date(year, monthIndex + 1, 1),
    label: normalizedMonth,
  };
}

function diffMinutes(start: Date | null, end: Date | null) {
  if (!start || !end) return null;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}

function round(value: number, digits = 1) {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const range = parseMonthRange(searchParams.get('month'));
    if (!range) {
      return validationError('month の形式が不正です', {
        month: ['month は YYYY-MM 形式で指定してください'],
      });
    }

    const memberships = await prisma.membership.findMany({
      where: {
        org_id: req.orgId,
        is_active: true,
        role: {
          in: [...KPI_ROLES],
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            name_kana: true,
            email: true,
            max_weekly_visits: true,
            max_travel_minutes: true,
          },
        },
        site: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ user: { name_kana: 'asc' } }],
    });

    const userIds = memberships.map((membership) => membership.user.id);
    if (userIds.length === 0) {
      return success({
        data: {
          month: range.label,
          summary: {
            total_staff: 0,
            avg_monthly_visits: 0,
            avg_report_submission_rate: 0,
            overloaded_count: 0,
            underutilized_count: 0,
          },
          items: [],
        },
      });
    }

    const [visitRecords, careReports, shifts] = await Promise.all([
      prisma.visitRecord.findMany({
        where: {
          org_id: req.orgId,
          pharmacist_id: {
            in: userIds,
          },
          visit_date: {
            gte: range.start,
            lt: range.end,
          },
        },
        select: {
          pharmacist_id: true,
          patient_id: true,
          schedule: {
            select: {
              time_window_start: true,
              time_window_end: true,
            },
          },
        },
      }),
      prisma.careReport.findMany({
        where: {
          org_id: req.orgId,
          created_by: {
            in: userIds,
          },
          created_at: {
            gte: range.start,
            lt: range.end,
          },
          visit_record_id: {
            not: null,
          },
        },
        select: {
          created_by: true,
          visit_record_id: true,
        },
      }),
      prisma.pharmacistShift.findMany({
        where: {
          org_id: req.orgId,
          user_id: {
            in: userIds,
          },
          date: {
            gte: range.start,
            lt: range.end,
          },
          available: true,
        },
        select: {
          user_id: true,
          date: true,
          available_from: true,
          available_to: true,
        },
      }),
    ]);

    const stats = new Map(
      memberships.map((membership) => [
        membership.user.id,
        {
          monthlyVisitCount: 0,
          patientIds: new Set<string>(),
          totalVisitMinutes: 0,
          durationSamples: 0,
          reportVisitRecordIds: new Set<string>(),
          shiftDays: new Set<string>(),
          totalShiftMinutes: 0,
        },
      ]),
    );

    for (const record of visitRecords) {
      const current = stats.get(record.pharmacist_id);
      if (!current) continue;
      current.monthlyVisitCount += 1;
      current.patientIds.add(record.patient_id);
      const duration = diffMinutes(
        record.schedule?.time_window_start ?? null,
        record.schedule?.time_window_end ?? null,
      );
      if (duration != null) {
        current.totalVisitMinutes += duration;
        current.durationSamples += 1;
      }
    }

    for (const report of careReports) {
      const current = stats.get(report.created_by);
      if (!current || !report.visit_record_id) continue;
      current.reportVisitRecordIds.add(report.visit_record_id);
    }

    for (const shift of shifts) {
      const current = stats.get(shift.user_id);
      if (!current) continue;
      current.shiftDays.add(formatDateKey(shift.date));
      const minutes = diffMinutes(shift.available_from ?? null, shift.available_to ?? null);
      if (minutes != null) {
        current.totalShiftMinutes += minutes;
      }
    }

    const averageMonthlyVisits =
      memberships.length > 0 ? visitRecords.length / memberships.length : 0;

    const items = memberships.map((membership) => {
      const current = stats.get(membership.user.id)!;
      const reportSubmissionRate =
        current.monthlyVisitCount > 0
          ? round((current.reportVisitRecordIds.size / current.monthlyVisitCount) * 100, 0)
          : 0;
      const workloadBalanceDeltaPercent =
        averageMonthlyVisits > 0
          ? round(
              ((current.monthlyVisitCount - averageMonthlyVisits) / averageMonthlyVisits) * 100,
              0,
            )
          : 0;
      const weeklyCapacity = membership.user.max_weekly_visits;
      const monthlyCapacity = weeklyCapacity != null ? weeklyCapacity * 4.3 : null;
      const workloadUtilizationPercent =
        monthlyCapacity && monthlyCapacity > 0
          ? round((current.monthlyVisitCount / monthlyCapacity) * 100, 0)
          : null;

      return {
        id: membership.user.id,
        name: membership.user.name,
        name_kana: membership.user.name_kana,
        email: membership.user.email,
        role: membership.role,
        site_name: membership.site?.name ?? null,
        monthly_visit_count: current.monthlyVisitCount,
        assigned_patient_count: current.patientIds.size,
        avg_visit_minutes:
          current.durationSamples > 0
            ? round(current.totalVisitMinutes / current.durationSamples, 1)
            : null,
        report_submission_rate: reportSubmissionRate,
        shift_days: current.shiftDays.size,
        shift_hours: current.totalShiftMinutes > 0 ? round(current.totalShiftMinutes / 60, 1) : 0,
        workload_balance_delta_percent: workloadBalanceDeltaPercent,
        workload_utilization_percent: workloadUtilizationPercent,
        max_weekly_visits: membership.user.max_weekly_visits,
        max_travel_minutes: membership.user.max_travel_minutes,
      };
    });

    const overloadedCount = items.filter(
      (item) => item.workload_balance_delta_percent >= 20,
    ).length;
    const underutilizedCount = items.filter(
      (item) => item.workload_balance_delta_percent <= -20,
    ).length;
    const avgReportSubmissionRate =
      items.length > 0
        ? round(items.reduce((sum, item) => sum + item.report_submission_rate, 0) / items.length, 0)
        : 0;

    return success({
      data: {
        month: range.label,
        summary: {
          total_staff: items.length,
          avg_monthly_visits: round(averageMonthlyVisits, 1),
          avg_report_submission_rate: avgReportSubmissionRate,
          overloaded_count: overloadedCount,
          underutilized_count: underutilizedCount,
        },
        items,
      },
    });
  },
  {
    permission: 'canAdmin',
    message: 'スタッフKPIの閲覧権限がありません',
  },
);
