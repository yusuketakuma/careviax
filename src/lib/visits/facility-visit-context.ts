export type FacilityVisitContextPatient = {
  scheduleId: string;
  patientName: string;
  unitName: string | null;
  routeOrder: number | null;
};

export type FacilityVisitContext = {
  label: string;
  siteName: string | null;
  patients: FacilityVisitContextPatient[];
};

export const FACILITY_VISIT_CONTEXT_PARAM = 'facility_visit_context';

export function encodeFacilityVisitContext(context: FacilityVisitContext) {
  return JSON.stringify(context);
}

export function decodeFacilityVisitContext(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<FacilityVisitContext>;
    if (!parsed || typeof parsed.label !== 'string' || !Array.isArray(parsed.patients)) {
      return null;
    }

    const patients = parsed.patients
      .map((item) => ({
        scheduleId: typeof item?.scheduleId === 'string' ? item.scheduleId : '',
        patientName: typeof item?.patientName === 'string' ? item.patientName : '',
        unitName: typeof item?.unitName === 'string' ? item.unitName : null,
        routeOrder: typeof item?.routeOrder === 'number' ? item.routeOrder : null,
      }))
      .filter((item) => item.scheduleId && item.patientName);

    if (patients.length === 0) return null;

    return {
      label: parsed.label,
      siteName: typeof parsed.siteName === 'string' ? parsed.siteName : null,
      patients,
    } satisfies FacilityVisitContext;
  } catch {
    try {
      return decodeFacilityVisitContext(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
}

export function createFacilityVisitRecordHref(
  scheduleId: string,
  context: FacilityVisitContext,
) {
  const params = new URLSearchParams({
    [FACILITY_VISIT_CONTEXT_PARAM]: encodeFacilityVisitContext(context),
  });
  return `/visits/${scheduleId}/record?${params.toString()}`;
}
