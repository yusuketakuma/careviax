import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { formatDateKey } from '@/lib/date-key';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';

export const GET = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view');

    if (view !== 'resource_map') {
      const sites = await prisma.pharmacySite.findMany({
        where: {
          org_id: ctx.orgId,
        },
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          fax: true,
          lat: true,
          lng: true,
          is_health_support_pharmacy: true,
          is_regional_support: true,
          is_specialized_pharmacy: true,
          dispensing_fee_category: true,
        },
        orderBy: [{ name: 'asc' }],
      });

      return success({
        data: sites.map((site) => ({
          id: site.id,
          name: site.name,
          address: site.address,
          phone: site.phone,
          fax: site.fax,
          lat: site.lat,
          lng: site.lng,
          is_health_support_pharmacy: site.is_health_support_pharmacy,
          is_regional_support: site.is_regional_support,
          is_specialized_pharmacy: site.is_specialized_pharmacy,
          dispensing_fee_category: site.dispensing_fee_category,
        })),
      });
    }

    // shift / holiday の date(@db.Date)は UTC 深夜で保存されるため UTC 深夜の今日で比較する
    const todayUtc = utcDateFromLocalKey(localDateKey());
    const sites = await prisma.pharmacySite.findMany({
      where: {
        org_id: ctx.orgId,
      },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        lat: true,
        lng: true,
        is_health_support_pharmacy: true,
        is_regional_support: true,
        facility_standards: {
          select: {
            standard_type: true,
          },
        },
        pharmacist_shifts: {
          where: {
            date: {
              gte: todayUtc,
            },
          },
          select: {
            date: true,
            available: true,
            user: {
              select: {
                can_accept_emergency: true,
                visit_specialties: true,
              },
            },
          },
        },
        business_holidays: {
          where: {
            is_closed: true,
            date: {
              gte: todayUtc,
            },
          },
          select: {
            id: true,
            date: true,
            name: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }],
    });

    const data = sites.map((site) => {
      const standards = site.facility_standards.map((item) => item.standard_type);
      const specialties = site.pharmacist_shifts.flatMap((shift) =>
        Array.isArray(shift.user.visit_specialties)
          ? shift.user.visit_specialties.filter(
              (value): value is string => typeof value === 'string',
            )
          : [],
      );
      const emergencyCapableShiftCount = site.pharmacist_shifts.filter(
        (shift) => shift.available && shift.user.can_accept_emergency,
      ).length;
      const holidayGapDates = site.business_holidays
        .filter((holiday) => {
          const dateKey = formatDateKey(holiday.date);
          return !site.pharmacist_shifts.some(
            (shift) =>
              shift.available &&
              shift.user.can_accept_emergency &&
              formatDateKey(shift.date) === dateKey,
          );
        })
        .map((holiday) => ({
          id: holiday.id,
          date: holiday.date.toISOString(),
          name: holiday.name,
        }));

      const supportsNarcotic = standards.some((value) => /麻薬/.test(value));
      const supportsSterile =
        standards.some((value) => /無菌/.test(value)) ||
        specialties.some((value) => /無菌/.test(value));
      const canDelegate =
        site.is_regional_support ||
        emergencyCapableShiftCount > 1 ||
        standards.some((value) => /代行|共同/.test(value));

      return {
        id: site.id,
        name: site.name,
        address: site.address,
        phone: site.phone,
        lat: site.lat,
        lng: site.lng,
        is_health_support_pharmacy: site.is_health_support_pharmacy,
        is_regional_support: site.is_regional_support,
        emergency_capable_shift_count: emergencyCapableShiftCount,
        holiday_gap_dates: holidayGapDates,
        supports_narcotic: supportsNarcotic,
        supports_sterile: supportsSterile,
        can_delegate: canDelegate,
        has_geo: site.lat != null && site.lng != null,
        capability_tags: [
          ...(site.is_regional_support ? ['地域連携'] : []),
          ...(site.is_health_support_pharmacy ? ['健康サポート'] : []),
          ...(supportsNarcotic ? ['麻薬'] : []),
          ...(supportsSterile ? ['無菌'] : []),
          ...(canDelegate ? ['代行可'] : []),
        ],
        action_href: '/workflow',
      };
    });

    return success({
      data,
      summary: {
        total_sites: data.length,
        emergency_ready_sites: data.filter((site) => site.emergency_capable_shift_count > 0).length,
        holiday_gap_sites: data.filter((site) => site.holiday_gap_dates.length > 0).length,
        missing_geo_sites: data.filter((site) => !site.has_geo).length,
      },
    });
  },
  {
    permission: 'canVisit',
    message: '店舗情報の閲覧権限がありません',
  },
);
