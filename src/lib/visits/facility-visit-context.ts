import { parseJsonOrNull, readJsonObject } from '@/lib/db/json';

export type FacilityVisitContextPatient = {
  scheduleId: string;
  patientId?: string | null;
  patientName: string;
  patientNameKana?: string | null;
  birthDate?: string | null;
  gender?: string | null;
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

  return decodeFacilityVisitContextRaw(raw, true);
}

function decodeFacilityVisitContextRaw(
  raw: string,
  allowUriDecodeRetry: boolean,
): FacilityVisitContext | null {
  const parsed = readJsonObject(parseJsonOrNull(raw));
  if (!parsed || typeof parsed.label !== 'string' || !Array.isArray(parsed.patients)) {
    if (!allowUriDecodeRetry) return null;
    try {
      const decoded = decodeURIComponent(raw);
      return decoded === raw ? null : decodeFacilityVisitContextRaw(decoded, false);
    } catch {
      return null;
    }
  }

  const patients = parsed.patients
    .map((item) => {
      const record = readJsonObject(item);
      return {
        scheduleId: typeof record?.scheduleId === 'string' ? record.scheduleId : '',
        patientId: typeof record?.patientId === 'string' ? record.patientId : null,
        patientName: typeof record?.patientName === 'string' ? record.patientName : '',
        patientNameKana:
          typeof record?.patientNameKana === 'string' ? record.patientNameKana : null,
        birthDate: typeof record?.birthDate === 'string' ? record.birthDate : null,
        gender: typeof record?.gender === 'string' ? record.gender : null,
        unitName: typeof record?.unitName === 'string' ? record.unitName : null,
        routeOrder: typeof record?.routeOrder === 'number' ? record.routeOrder : null,
        scheduleStatus: typeof record?.scheduleStatus === 'string' ? record.scheduleStatus : null,
        medicationStartDate:
          typeof record?.medicationStartDate === 'string' ? record.medicationStartDate : null,
        medicationEndDate:
          typeof record?.medicationEndDate === 'string' ? record.medicationEndDate : null,
        preparationBlockersCount:
          typeof record?.preparationBlockersCount === 'number'
            ? record.preparationBlockersCount
            : undefined,
        visitRecordId: typeof record?.visitRecordId === 'string' ? record.visitRecordId : null,
        visitOutcomeStatus:
          typeof record?.visitOutcomeStatus === 'string' ? record.visitOutcomeStatus : null,
      };
    })
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
}

export function createFacilityVisitRecordHref(scheduleId: string, context: FacilityVisitContext) {
  void context;
  return `/visits/${encodeURIComponent(scheduleId)}/record`;
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
