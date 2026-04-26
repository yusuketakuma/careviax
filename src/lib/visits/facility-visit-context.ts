export type FacilityVisitContextPatient = {
  scheduleId: string;
  patientName: string;
  unitName: string | null;
  routeOrder: number | null;
  scheduleStatus?: string | null;
  medicationStartDate?: string | null;
  medicationEndDate?: string | null;
  preparationBlockersCount?: number;
  visitRecordId?: string | null;
  visitOutcomeStatus?: string | null;
};

export type FacilityVisitContext = {
  label: string;
  siteName: string | null;
  placeKind?: 'facility' | 'home_group' | 'address' | null;
  commonNotes?: string | null;
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
        scheduleStatus: typeof item?.scheduleStatus === 'string' ? item.scheduleStatus : null,
        medicationStartDate:
          typeof item?.medicationStartDate === 'string' ? item.medicationStartDate : null,
        medicationEndDate:
          typeof item?.medicationEndDate === 'string' ? item.medicationEndDate : null,
        preparationBlockersCount:
          typeof item?.preparationBlockersCount === 'number'
            ? item.preparationBlockersCount
            : undefined,
        visitRecordId: typeof item?.visitRecordId === 'string' ? item.visitRecordId : null,
        visitOutcomeStatus:
          typeof item?.visitOutcomeStatus === 'string' ? item.visitOutcomeStatus : null,
      }))
      .filter((item) => item.scheduleId && item.patientName);

    if (patients.length === 0) return null;

    return {
      label: parsed.label,
      siteName: typeof parsed.siteName === 'string' ? parsed.siteName : null,
      placeKind:
        parsed.placeKind === 'facility' ||
        parsed.placeKind === 'home_group' ||
        parsed.placeKind === 'address'
          ? parsed.placeKind
          : null,
      commonNotes: typeof parsed.commonNotes === 'string' ? parsed.commonNotes : null,
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

export function createFacilityVisitRecordHref(scheduleId: string, context: FacilityVisitContext) {
  void context;
  return `/visits/${scheduleId}/record`;
}

export function getNextGroupedVisitScheduleId(
  currentScheduleId: string,
  context: FacilityVisitContext | null,
) {
  if (!context || context.patients.length < 2) return null;

  const orderedPatients = context.patients
    .slice()
    .sort((left, right) => (left.routeOrder ?? 9999) - (right.routeOrder ?? 9999));
  const currentIndex = orderedPatients.findIndex(
    (patient) => patient.scheduleId === currentScheduleId,
  );
  if (currentIndex === -1) return null;

  const forwardCandidate = orderedPatients
    .slice(currentIndex + 1)
    .find((patient) => !patient.visitRecordId);
  if (forwardCandidate) return forwardCandidate.scheduleId;

  const earlierCandidate = orderedPatients
    .slice(0, currentIndex)
    .find((patient) => !patient.visitRecordId);
  return earlierCandidate?.scheduleId ?? null;
}
