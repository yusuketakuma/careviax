import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { japanDateKey, japanMonthInstantRange } from '@/lib/utils/date-boundary';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE = '/api/dashboard/monthly-stats';

type MonthlyBucket = {
  patient_id: string;
  patient_name: string;
  insurance_basis: 'medical' | 'care' | 'both';
  visit_count: number;
  monthly_limit: number;
};

type MonthlyPatientStat = MonthlyBucket & {
  status: 'over_limit' | 'within_limit' | 'under_limit';
};

type MonthParseResult =
  | { ok: true; monthLabel: string }
  | { ok: false; response: ReturnType<typeof validationError> };

function parseMonthParam(searchParams: URLSearchParams): MonthParseResult {
  const values = searchParams.getAll('month');
  if (values.length === 0) {
    const monthLabel = japanDateKey().slice(0, 7);
    return {
      ok: true,
      monthLabel,
    };
  }
  if (values.length > 1) {
    return {
      ok: false,
      response: validationError('month の形式が不正です（YYYY-MM）', {
        month: ['month は1つだけ指定してください'],
      }),
    };
  }

  const value = values[0] ?? '';
  if (!value || value.trim() !== value || !/^\d{4}-\d{2}$/.test(value)) {
    return { ok: false, response: validationError('month の形式が不正です（YYYY-MM）') };
  }

  const month = Number(value.slice(5, 7));
  if (month < 1 || month > 12) {
    return { ok: false, response: validationError('month の形式が不正です（YYYY-MM）') };
  }
  return {
    ok: true,
    monthLabel: value,
  };
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const parsedMonth = parseMonthParam(searchParams);
    if (!parsedMonth.ok) {
      return parsedMonth.response;
    }

    const { monthLabel } = parsedMonth;
    const monthRange = japanMonthInstantRange(monthLabel);
    const visitCountsByPatient = await prisma.visitRecord.groupBy({
      by: ['patient_id'],
      where: {
        org_id: ctx.orgId,
        visit_date: monthRange,
        outcome_status: {
          in: ['completed', 'completed_with_issue', 'delivery_only', 'revisit_needed'],
        },
      },
      _count: {
        _all: true,
      },
    });

    const patientIds = visitCountsByPatient.map((row) => row.patient_id);
    const patients =
      patientIds.length === 0
        ? []
        : await prisma.patient.findMany({
            where: {
              org_id: ctx.orgId,
              id: { in: patientIds },
            },
            select: {
              id: true,
              name: true,
              medical_insurance_number: true,
              care_insurance_number: true,
            },
          });
    const patientById = new Map(patients.map((patient) => [patient.id, patient]));

    const buckets = new Map<string, MonthlyBucket>();
    for (const row of visitCountsByPatient) {
      const patient = patientById.get(row.patient_id);
      if (!patient) continue;

      const hasMedical = Boolean(patient.medical_insurance_number);
      const hasCare = Boolean(patient.care_insurance_number);
      const insuranceBasis = hasMedical && hasCare ? 'both' : hasCare ? 'care' : 'medical';
      const monthlyLimit = insuranceBasis === 'care' ? 2 : 4;
      const key = `${patient.id}:${insuranceBasis}`;
      const existing = buckets.get(key) ?? {
        patient_id: patient.id,
        patient_name: patient.name,
        insurance_basis: insuranceBasis,
        visit_count: 0,
        monthly_limit: monthlyLimit,
      };
      existing.visit_count += row._count._all;
      buckets.set(key, existing);
    }

    const patient_stats: MonthlyPatientStat[] = Array.from(buckets.values())
      .map(
        (item): MonthlyPatientStat => ({
          ...item,
          status:
            item.visit_count > item.monthly_limit
              ? 'over_limit'
              : item.visit_count === item.monthly_limit
                ? 'within_limit'
                : 'under_limit',
        }),
      )
      .sort((left, right) => {
        if (left.status !== right.status) {
          const rank: Record<MonthlyPatientStat['status'], number> = {
            over_limit: 0,
            within_limit: 1,
            under_limit: 2,
          };
          return rank[left.status] - rank[right.status];
        }
        return right.visit_count - left.visit_count;
      });

    return success({
      data: {
        month: monthLabel,
        summary: {
          total_patients: patient_stats.length,
          over_limit_count: patient_stats.filter((item) => item.status === 'over_limit').length,
          within_limit_count: patient_stats.filter((item) => item.status === 'within_limit').length,
          under_limit_count: patient_stats.filter((item) => item.status === 'under_limit').length,
        },
        patient_stats,
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
      logger.error(
        {
          event: 'dashboard_monthly_stats_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
