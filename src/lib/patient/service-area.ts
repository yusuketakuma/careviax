export type ServiceAreaRecord = {
  id: string;
  site_id: string;
  name: string;
  area_type: string;
  geo_data: Record<string, unknown> | null;
  notes: string | null;
};

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function isAddressCoveredByServiceArea(args: {
  area: ServiceAreaRecord;
  address: string;
  facilityId?: string | null;
}) {
  const geoData = args.area.geo_data ?? {};
  const facilityIds = readStringArray(geoData.facility_ids);
  if (args.facilityId && facilityIds.includes(args.facilityId)) {
    return true;
  }

  const normalizedAddress = args.address.trim();
  if (!normalizedAddress) return false;

  const keywords = readStringArray(geoData.match_keywords);
  if (keywords.some((keyword) => normalizedAddress.includes(keyword))) {
    return true;
  }

  const postalPrefixes = readStringArray(geoData.postal_prefixes);
  if (postalPrefixes.some((prefix) => normalizedAddress.startsWith(prefix))) {
    return true;
  }

  return false;
}

export function evaluateServiceAreaWarning(args: {
  serviceAreas: ServiceAreaRecord[];
  address: string;
  facilityId?: string | null;
}) {
  if (args.serviceAreas.length === 0) return null;
  if (!args.address.trim() && !args.facilityId) return null;

  const matchedArea = args.serviceAreas.find((area) =>
    isAddressCoveredByServiceArea({
      area,
      address: args.address,
      facilityId: args.facilityId,
    })
  );

  if (matchedArea) {
    return {
      level: 'covered' as const,
      message: `訪問可能エリア: ${matchedArea.name}`,
    };
  }

  return {
    level: 'warning' as const,
    message: '登録住所が既存の訪問エリアに一致していません。訪問可否を確認してください。',
  };
}
