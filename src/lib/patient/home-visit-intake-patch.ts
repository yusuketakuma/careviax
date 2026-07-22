import type { UpdatePatientData } from '@/lib/validations/patient';

export const HOME_VISIT_SCHEDULING_PREFERENCE_KEYS = [
  'primary_contact_preference',
  'visit_before_contact_required',
  'first_visit_preferred_date',
  'first_visit_time_slot',
  'first_visit_time_note',
  'parking_available',
  'mcs_linked',
  'adl_level',
  'dementia_level',
  'swallowing_route',
  'care_level',
  'infection_isolation',
] as const;

const SCHEDULE_PREFERENCE_INTAKE_KEYS = new Set<string>(HOME_VISIT_SCHEDULING_PREFERENCE_KEYS);

export function isHomeVisitSchedulingPreferenceKey(key: string): boolean {
  return SCHEDULE_PREFERENCE_INTAKE_KEYS.has(key);
}

function isSemanticValue(value: unknown): boolean {
  if (value === undefined) return false;
  // Empty strings, nulls, and empty arrays are intentional clear operations.
  // Only absent values and structurally empty nested objects are omitted.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return true;
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(isSemanticValue);
  }
  return false;
}

export function classifyHomeVisitIntakePatch(args: {
  requester?: UpdatePatientData['requester'];
  intake?: UpdatePatientData['intake'];
}) {
  const requesterEntries = Object.entries(args.requester ?? {}).filter(([, value]) =>
    isSemanticValue(value),
  );
  const intakeEntries = Object.entries(args.intake ?? {}).filter(([, value]) =>
    isSemanticValue(value),
  );
  const schedulePreferenceEntries = intakeEntries.filter(([key]) =>
    isHomeVisitSchedulingPreferenceKey(key),
  );
  const careCaseEntries = intakeEntries.filter(([key]) => !isHomeVisitSchedulingPreferenceKey(key));

  return {
    hasRequesterWrites: requesterEntries.length > 0,
    hasSchedulePreferenceWrites: schedulePreferenceEntries.length > 0,
    hasCareCaseWrites: requesterEntries.length > 0 || careCaseEntries.length > 0,
    hasAnyWrites:
      requesterEntries.length > 0 ||
      schedulePreferenceEntries.length > 0 ||
      careCaseEntries.length > 0,
  };
}
