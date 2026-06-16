import { format, getDay, startOfMonth, startOfYear } from 'date-fns';
import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

function countBusinessDays(from: Date, to: Date) {
  const cursor = new Date(from);
  let count = 0;

  while (cursor <= to) {
    const day = getDay(cursor);
    if (day !== 0 && day !== 6) {
      count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return Math.max(count, 1);
}

export const GET = withAuthContext(
  async (_req, ctx) => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const yearStart = startOfYear(now);

    const [
      prescriptionInstitutionGroups,
      totalPrescriptionLines,
      genericPrescriptionLines,
      activePharmacistCount,
      homeVisitCountYtd,
    ] = await Promise.all([
      prisma.prescriptionIntake.groupBy({
        by: ['prescriber_institution'],
        where: {
          org_id: ctx.orgId,
          prescribed_date: {
            gte: monthStart,
            lte: now,
          },
        },
        _count: {
          id: true,
        },
      }),
      prisma.prescriptionLine.count({
        where: {
          org_id: ctx.orgId,
          intake: {
            prescribed_date: {
              gte: monthStart,
              lte: now,
            },
          },
        },
      }),
      prisma.prescriptionLine.count({
        where: {
          org_id: ctx.orgId,
          is_generic: true,
          intake: {
            prescribed_date: {
              gte: monthStart,
              lte: now,
            },
          },
        },
      }),
      prisma.pharmacistShift.findMany({
        where: {
          org_id: ctx.orgId,
          available: true,
          date: {
            gte: monthStart,
            lte: now,
          },
        },
        select: {
          user_id: true,
        },
        distinct: ['user_id'],
      }),
      prisma.visitRecord.count({
        where: {
          org_id: ctx.orgId,
          visit_date: {
            gte: yearStart,
            lte: now,
          },
          outcome_status: {
            in: ['completed', 'completed_with_issue', 'revisit_needed', 'delivery_only'],
          },
        },
      }),
    ]);

    const topInstitutionCount = prescriptionInstitutionGroups.reduce<Record<string, number>>(
      (acc, group) => {
        const institution = group.prescriber_institution?.trim() || '不明';
        acc[institution] = (acc[institution] ?? 0) + group._count.id;
        return acc;
      },
      {},
    );
    const monthlyPrescriptionCount = Object.values(topInstitutionCount).reduce(
      (sum, count) => sum + count,
      0,
    );
    const highestInstitutionVolume =
      Object.values(topInstitutionCount).sort((left, right) => right - left)[0] ?? 0;
    const prescriptionConcentrationRate =
      monthlyPrescriptionCount === 0
        ? 0
        : Math.round((highestInstitutionVolume / monthlyPrescriptionCount) * 100);
    const genericDispensingRate =
      totalPrescriptionLines === 0
        ? 0
        : Math.round((genericPrescriptionLines / totalPrescriptionLines) * 100);
    const pharmacistCount = activePharmacistCount.length;
    const businessDaysElapsed = countBusinessDays(monthStart, now);
    const prescriptionsPerPharmacist =
      pharmacistCount === 0
        ? 0
        : Number((monthlyPrescriptionCount / pharmacistCount / businessDaysElapsed).toFixed(1));

    return success({
      data: {
        prescription_concentration_rate: prescriptionConcentrationRate,
        generic_dispensing_rate: genericDispensingRate,
        prescriptions_per_pharmacist: prescriptionsPerPharmacist,
        home_visit_count_ytd: homeVisitCountYtd,
        monthly_prescription_count: monthlyPrescriptionCount,
        reference_month: format(monthStart, 'yyyy-MM'),
        active_pharmacist_count: pharmacistCount,
        business_days_elapsed: businessDaysElapsed,
      },
    });
  },
  {
    permission: 'canAdmin',
    message: '経営指標の閲覧権限がありません',
  },
);
