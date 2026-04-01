import { isAddressCoveredByServiceArea, type ServiceAreaRecord } from '@/lib/patient/service-area';

type AuditMembership = {
  role: string;
  site_id: string | null;
  site_name: string | null;
  is_active: boolean;
  user: {
    is_active: boolean;
    account_status: string;
  };
};

type AuditSite = {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  service_areas: ServiceAreaRecord[];
};

type AuditCase = {
  id: string;
  status: string;
  required_visit_support: unknown;
  patient: {
    id: string;
    name: string;
    residences: Array<{
      address: string;
      facility_id: string | null;
      lat: number | null;
      lng: number | null;
      geocode_status: string | null;
    }>;
  };
};

export type PilotOrgAuditSnapshot = {
  generated_at: string;
  org_structure: {
    site_count: number;
    active_member_count: number;
    role_counts: Record<string, number>;
    site_breakdown: Array<{
      site_id: string;
      site_name: string;
      active_member_count: number;
      service_area_count: number;
      has_geo: boolean;
    }>;
  };
  pilot_targets: {
    active_case_count: number;
    facility_linked_case_count: number;
    set_pilot_case_count: number;
  };
  coverage: {
    total_primary_residences: number;
    flagged_patient_count: number;
    flagged_patients_truncated: boolean;
    service_area_covered_count: number;
    radius_16km_covered_count: number;
    uncovered_count: number;
    review_required_count: number;
    flagged_patients: Array<{
      patient_id: string;
      patient_name: string;
      address: string;
      reason: string;
      nearest_site_name: string | null;
      nearest_site_distance_km: number | null;
    }>;
  };
  recommendations: string[];
};

function hasSetPilotEnabled(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.set_pilot_enabled === true;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function haversineDistanceKm(args: {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(args.toLat - args.fromLat);
  const dLng = toRadians(args.toLng - args.fromLng);
  const lat1 = toRadians(args.fromLat);
  const lat2 = toRadians(args.toLat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function findNearestSite(args: {
  sites: AuditSite[];
  lat: number | null;
  lng: number | null;
}) {
  if (args.lat == null || args.lng == null) {
    return { site: null, distanceKm: null };
  }

  let nearestSite: AuditSite | null = null;
  let nearestDistanceKm: number | null = null;

  for (const site of args.sites) {
    if (site.lat == null || site.lng == null) continue;
    const distanceKm = haversineDistanceKm({
      fromLat: args.lat,
      fromLng: args.lng,
      toLat: site.lat,
      toLng: site.lng,
    });
    if (nearestDistanceKm == null || distanceKm < nearestDistanceKm) {
      nearestSite = site;
      nearestDistanceKm = distanceKm;
    }
  }

  return { site: nearestSite, distanceKm: nearestDistanceKm };
}

export function buildPilotOrgAuditSnapshot(args: {
  memberships: AuditMembership[];
  sites: AuditSite[];
  cases: AuditCase[];
  now?: Date;
}): PilotOrgAuditSnapshot {
  const now = args.now ?? new Date();
  const activeMemberships = args.memberships.filter(
    (membership) =>
      membership.is_active &&
      membership.user.is_active &&
      membership.user.account_status === 'active'
  );

  const roleCounts = activeMemberships.reduce<Record<string, number>>((acc, membership) => {
    acc[membership.role] = (acc[membership.role] ?? 0) + 1;
    return acc;
  }, {});

  const siteBreakdown = args.sites.map((site) => ({
    site_id: site.id,
    site_name: site.name,
    active_member_count: activeMemberships.filter((membership) => membership.site_id === site.id).length,
    service_area_count: site.service_areas.length,
    has_geo: site.lat != null && site.lng != null,
  }));

  const flaggedPatients: PilotOrgAuditSnapshot['coverage']['flagged_patients'] = [];
  let facilityLinkedCaseCount = 0;
  let setPilotCaseCount = 0;
  let serviceAreaCoveredCount = 0;
  let radiusCoveredCount = 0;
  let uncoveredCount = 0;
  let reviewRequiredCount = 0;
  let inspectedPrimaryResidenceCount = 0;

  for (const careCase of args.cases) {
    if (hasSetPilotEnabled(careCase.required_visit_support)) {
      setPilotCaseCount += 1;
    }

    const residence = careCase.patient.residences[0];
    if (!residence) {
      reviewRequiredCount += 1;
      flaggedPatients.push({
        patient_id: careCase.patient.id,
        patient_name: careCase.patient.name,
        address: '主住所未登録',
        reason: 'primary residence が未登録のため訪問カバレッジ判定不可',
        nearest_site_name: null,
        nearest_site_distance_km: null,
      });
      continue;
    }

    inspectedPrimaryResidenceCount += 1;

    if (residence.facility_id) {
      facilityLinkedCaseCount += 1;
    }

    const serviceAreaCovered = args.sites.some((site) =>
      site.service_areas.some((area) =>
        isAddressCoveredByServiceArea({
          area,
          address: residence.address,
          facilityId: residence.facility_id,
        })
      )
    );
    if (serviceAreaCovered) {
      serviceAreaCoveredCount += 1;
      continue;
    }

    const nearest = findNearestSite({
      sites: args.sites,
      lat: residence.lat,
      lng: residence.lng,
    });

    if (nearest.distanceKm != null && nearest.distanceKm <= 16) {
      radiusCoveredCount += 1;
      continue;
    }

    if (nearest.distanceKm == null) {
      reviewRequiredCount += 1;
      flaggedPatients.push({
        patient_id: careCase.patient.id,
        patient_name: careCase.patient.name,
        address: residence.address,
        reason: '位置情報未設定のため 16km 圏判定不可',
        nearest_site_name: nearest.site?.name ?? null,
        nearest_site_distance_km: null,
      });
      continue;
    }

    uncoveredCount += 1;
    flaggedPatients.push({
      patient_id: careCase.patient.id,
      patient_name: careCase.patient.name,
      address: residence.address,
      reason: '既存拠点から 16km 圏外',
      nearest_site_name: nearest.site?.name ?? null,
      nearest_site_distance_km: Number(nearest.distanceKm.toFixed(1)),
    });
  }

  const flaggedPatientCount = flaggedPatients.length;
  const truncatedFlaggedPatients = flaggedPatientCount > 20;

  const recommendations: string[] = [];
  if (args.sites.length === 0) {
    recommendations.push('対象 org に pharmacy site がありません。店舗構成を先に確定してください。');
  }
  if (siteBreakdown.some((site) => site.service_area_count === 0)) {
    recommendations.push('service area 未設定の店舗があります。16km 圏確認前に訪問エリアを登録してください。');
  }
  if (reviewRequiredCount > 0) {
    recommendations.push(`位置情報不足で ${reviewRequiredCount} 件の患者住所が要確認です。緯度経度または facility 紐付けを補完してください。`);
  }
  if (uncoveredCount > 0) {
    recommendations.push(`${uncoveredCount} 件の患者住所が既存拠点の 16km 圏外です。対象店舗か訪問体制を見直してください。`);
  }
  if (facilityLinkedCaseCount === 0) {
    recommendations.push('施設患者が未確認です。FacilityVisitBatch は Phase 2 候補として扱ってください。');
  }
  if (setPilotCaseCount === 0) {
    recommendations.push('セット pilot 対象ケースが未確認です。セット本格機能は pilot 対象明示後に有効化してください。');
  }
  if (truncatedFlaggedPatients) {
    recommendations.push(`要確認患者は ${flaggedPatientCount} 件あります。画面と CLI には先頭 20 件のみ表示しています。`);
  }
  if (recommendations.length === 0) {
    recommendations.push('対象 org の店舗構成・pilot 対象・16km 圏カバレッジに大きな欠落は見当たりません。');
  }

  return {
    generated_at: now.toISOString(),
    org_structure: {
      site_count: args.sites.length,
      active_member_count: activeMemberships.length,
      role_counts: roleCounts,
      site_breakdown: siteBreakdown,
    },
    pilot_targets: {
      active_case_count: args.cases.length,
      facility_linked_case_count: facilityLinkedCaseCount,
      set_pilot_case_count: setPilotCaseCount,
    },
    coverage: {
      total_primary_residences: inspectedPrimaryResidenceCount,
      flagged_patient_count: flaggedPatientCount,
      flagged_patients_truncated: truncatedFlaggedPatients,
      service_area_covered_count: serviceAreaCoveredCount,
      radius_16km_covered_count: radiusCoveredCount,
      uncovered_count: uncoveredCount,
      review_required_count: reviewRequiredCount,
      flagged_patients: flaggedPatients.slice(0, 20),
    },
    recommendations,
  };
}

export async function getPilotOrgAuditSnapshot(orgId: string): Promise<PilotOrgAuditSnapshot> {
  const { prisma } = await import('@/lib/db/client');
  const [memberships, sites, cases] = await Promise.all([
    prisma.membership.findMany({
      where: { org_id: orgId },
      orderBy: [{ role: 'asc' }],
      select: {
        role: true,
        site_id: true,
        is_active: true,
        site: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            is_active: true,
            account_status: true,
          },
        },
      },
    }),
    prisma.pharmacySite.findMany({
      where: { org_id: orgId },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        address: true,
        lat: true,
        lng: true,
        service_areas: {
          select: {
            id: true,
            site_id: true,
            name: true,
            area_type: true,
            geo_data: true,
            notes: true,
          },
        },
      },
    }),
    prisma.careCase.findMany({
      where: {
        org_id: orgId,
        status: {
          in: ['assessment', 'active', 'on_hold'],
        },
      },
      orderBy: [{ created_at: 'desc' }],
      select: {
        id: true,
        status: true,
        required_visit_support: true,
        patient: {
          select: {
            id: true,
            name: true,
            residences: {
              where: { is_primary: true },
              select: {
                address: true,
                facility_id: true,
                lat: true,
                lng: true,
                geocode_status: true,
              },
              take: 1,
            },
          },
        },
      },
    }),
  ]);

  return buildPilotOrgAuditSnapshot({
    memberships: memberships.map((membership) => ({
      role: membership.role,
      site_id: membership.site_id,
      site_name: membership.site?.name ?? null,
      is_active: membership.is_active,
      user: membership.user,
    })),
    sites: sites.map((site) => ({
      ...site,
      service_areas: site.service_areas.map((area) => ({
        id: area.id,
        site_id: area.site_id,
        name: area.name,
        area_type: area.area_type,
        geo_data:
          area.geo_data && typeof area.geo_data === 'object'
            ? (area.geo_data as Record<string, unknown>)
            : null,
        notes: area.notes,
      })),
    })),
    cases,
  });
}
