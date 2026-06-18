import { endOfMonth, startOfMonth } from 'date-fns';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

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

function formatMonthLabel(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonthParam(value: string | null) {
  if (!value) {
    const monthStart = startOfMonth(new Date());
    return {
      monthStart,
      monthLabel: formatMonthLabel(monthStart),
    };
  }
  if (!/^\d{4}-\d{2}$/.test(value)) return null;

  const [year, month] = value.split('-').map(Number);
  if (month < 1 || month > 12) return null;
  const parsed = new Date(year, month - 1, 1);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    monthStart: startOfMonth(parsed),
    monthLabel: value,
  };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsedMonth = parseMonthParam(searchParams.get('month'));
    if (!parsedMonth) {
      return validationError('month の形式が不正です（YYYY-MM）');
    }

    const { monthStart, monthLabel } = parsedMonth;
    const monthEnd = endOfMonth(monthStart);
    const visitCountsByPatient = await prisma.visitRecord.groupBy({
      by: ['patient_id'],
      where: {
        org_id: ctx.orgId,
        visit_date: {
          gte: monthStart,
          lte: monthEnd,
        },
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
      month: monthLabel,
      summary: {
        total_patients: patient_stats.length,
        over_limit_count: patient_stats.filter((item) => item.status === 'over_limit').length,
        within_limit_count: patient_stats.filter((item) => item.status === 'within_limit').length,
        under_limit_count: patient_stats.filter((item) => item.status === 'under_limit').length,
      },
      patient_stats,
    });
  },
  {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  },
);
