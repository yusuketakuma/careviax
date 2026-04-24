type VisitPlaceResidence = {
  facility_id?: string | null;
  facility_unit_id?: string | null;
  building_id?: string | null;
  address?: string | null;
  unit_name?: string | null;
};

export type VisitPlaceGroup = {
  key: string;
  label: string;
  kind: 'facility' | 'home_group' | 'address';
};

function normalizeVisitPlaceValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function deriveVisitPlaceGroup(
  residence: VisitPlaceResidence | null
): VisitPlaceGroup | null {
  if (!residence) return null;

  const facilityId = normalizeVisitPlaceValue(residence.facility_id);
  const buildingId = normalizeVisitPlaceValue(residence.building_id);
  const address = normalizeVisitPlaceValue(residence.address);

  if (facilityId) {
    const baseLabel = buildingId ?? address ?? facilityId;
    return {
      key: ['facility', facilityId].join(':'),
      label: baseLabel,
      kind: 'facility',
    };
  }

  if (buildingId) {
    return {
      key: ['home_group', buildingId].join(':'),
      label: buildingId,
      kind: 'home_group',
    };
  }

  if (address) {
    return {
      key: ['address', address].join(':'),
      label: address,
      kind: 'address',
    };
  }

  return null;
}

export function deriveFacilityLabel(
  residence: VisitPlaceResidence | null
): string | null {
  if (!residence) return null;
  return (
    normalizeVisitPlaceValue(residence.building_id) ??
    normalizeVisitPlaceValue(residence.address) ??
    normalizeVisitPlaceValue(residence.facility_id)
  );
}
