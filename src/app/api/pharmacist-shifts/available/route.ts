import type { Prisma } from '@prisma/client';

import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  availablePharmacistShiftQuerySchema,
  toShiftTimeValue,
} from '@/lib/validations/pharmacist-shift';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');

    if (!date) return validationError('dateパラメータは必須です');

    const parsed = availablePharmacistShiftQuerySchema.safeParse({
      date,
      ...(searchParams.has('time_from') ? { time_from: searchParams.get('time_from') } : {}),
      ...(searchParams.has('time_to') ? { time_to: searchParams.get('time_to') } : {}),
    });
    if (!parsed.success) {
      return validationError('検索条件が不正です', parsed.error.flatten().fieldErrors);
    }

    const { date: dateKey, time_from: timeFrom, time_to: timeTo } = parsed.data;
    const targetDate = new Date(dateKey);
    const timeWindowFilters: Prisma.PharmacistShiftWhereInput[] = [];

    if (timeFrom) {
      const requestedFrom = toShiftTimeValue(timeFrom);
      if (requestedFrom) {
        timeWindowFilters.push({
          OR: [{ available_from: null }, { available_from: { lte: requestedFrom } }],
        });
      }
    }

    if (timeTo) {
      const requestedTo = toShiftTimeValue(timeTo);
      if (requestedTo) {
        timeWindowFilters.push({
          OR: [{ available_to: null }, { available_to: { gte: requestedTo } }],
        });
      }
    }

    const shifts = await prisma.pharmacistShift.findMany({
      where: {
        org_id: req.orgId,
        date: targetDate,
        available: true,
        ...(timeWindowFilters.length > 0 ? { AND: timeWindowFilters } : {}),
      },
      include: {
        user: { select: { id: true, name: true, name_kana: true } },
      },
      orderBy: { user: { name_kana: 'asc' } },
    });

    const holidays = await prisma.businessHoliday.findMany({
      where: {
        org_id: req.orgId,
        date: targetDate,
        is_closed: true,
        OR: [
          { site_id: null },
          { site_id: { in: [...new Set(shifts.map((shift) => shift.site_id))] } },
        ],
      },
      select: {
        site_id: true,
      },
    });
    const blockedSiteIds = new Set(
      holidays
        .map((holiday) => holiday.site_id)
        .filter((siteId): siteId is string => siteId != null),
    );
    const hasOrgWideClosure = holidays.some((holiday) => holiday.site_id == null);
    const availableShifts = hasOrgWideClosure
      ? []
      : shifts.filter((shift) => !blockedSiteIds.has(shift.site_id));

    return success({ data: availableShifts });
  },
  {
    permission: 'canVisit',
    message: 'シフト空き状況の閲覧権限がありません',
  },
);
