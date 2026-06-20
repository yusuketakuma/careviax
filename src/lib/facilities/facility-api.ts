export type FacilityContactApiSource = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  is_primary: boolean;
  notes: string | null;
};

export type FacilityApiSource = {
  id: string;
  name: string;
  facility_type: string;
  address: string | null;
  phone: string | null;
  fax: string | null;
  acceptance_time_from: Date | null;
  acceptance_time_to: Date | null;
  regular_visit_weekdays: unknown;
  notes: string | null;
  patient_count?: number;
  contacts: FacilityContactApiSource[];
  _count?: {
    residences: number;
  };
  created_at?: Date;
  updated_at?: Date;
};

export function toFacilityTimeValue(value?: string | null): Date | null {
  if (!value) return null;
  const [hours = '0', minutes = '0'] = value.split(':');
  return new Date(Date.UTC(1970, 0, 1, Number.parseInt(hours, 10), Number.parseInt(minutes, 10)));
}

export function formatFacilityTimeValue(value: Date | null): string | null {
  if (!value) return null;
  const hours = `${value.getUTCHours()}`.padStart(2, '0');
  const minutes = `${value.getUTCMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function serializeFacilityResponse(
  facility: FacilityApiSource,
  options: { includeTimestamps?: boolean } = {},
) {
  return {
    id: facility.id,
    name: facility.name,
    facility_type: facility.facility_type,
    address: facility.address,
    phone: facility.phone,
    fax: facility.fax,
    acceptance_time_from: formatFacilityTimeValue(facility.acceptance_time_from),
    acceptance_time_to: formatFacilityTimeValue(facility.acceptance_time_to),
    regular_visit_weekdays: Array.isArray(facility.regular_visit_weekdays)
      ? facility.regular_visit_weekdays
      : [],
    notes: facility.notes,
    patient_count: facility.patient_count ?? facility._count?.residences ?? 0,
    contacts: facility.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      role: contact.role,
      phone: contact.phone,
      email: contact.email,
      fax: contact.fax,
      is_primary: contact.is_primary,
      notes: contact.notes,
    })),
    ...(options.includeTimestamps
      ? {
          created_at: facility.created_at?.toISOString(),
          updated_at: facility.updated_at?.toISOString(),
        }
      : {}),
  };
}
