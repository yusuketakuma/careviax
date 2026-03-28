import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const view = searchParams.get('view');

  if (view !== 'resource_map') {
    const sites = await prisma.pharmacySite.findMany({
      where: {
        org_id: req.orgId,
      },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        lat: true,
        lng: true,
      },
      orderBy: [{ name: 'asc' }],
    });

    return success({
      data: sites.map((site) => ({
        id: site.id,
        name: site.name,
        address: site.address,
        phone: site.phone,
        lat: site.lat,
        lng: site.lng,
      })),
    });
  }

  const sites = await prisma.pharmacySite.findMany({
    where: {
      org_id: req.orgId,
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
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
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
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
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
        ? shift.user.visit_specialties.filter((value): value is string => typeof value === 'string')
        : []
    );
    const emergencyCapableShiftCount = site.pharmacist_shifts.filter(
      (shift) => shift.available && shift.user.can_accept_emergency
    ).length;
    const holidayGapDates = site.business_holidays
      .filter((holiday) => {
        const dateKey = holiday.date.toISOString().slice(0, 10);
        return !site.pharmacist_shifts.some(
          (shift) =>
            shift.available &&
            shift.user.can_accept_emergency &&
            shift.date.toISOString().slice(0, 10) === dateKey
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
}, {
  permission: 'canVisit',
  message: '店舗情報の閲覧権限がありません',
});
