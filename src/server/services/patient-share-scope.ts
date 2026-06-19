export const PATIENT_SHARE_SCOPE_KEYS = [
  'prescription_history',
  'medication_profile',
  'care_reports',
  'attachments',
  'print',
  'pdf_output',
  'download',
] as const;

export type PatientShareScopeKey = (typeof PATIENT_SHARE_SCOPE_KEYS)[number];
export type PatientShareScope = Record<PatientShareScopeKey, boolean>;

export const DEFAULT_PATIENT_SHARE_SCOPE: PatientShareScope = {
  prescription_history: true,
  medication_profile: true,
  care_reports: true,
  attachments: false,
  print: false,
  pdf_output: false,
  download: false,
};

export function normalizePatientShareScope(value: Record<string, unknown> | null | undefined) {
  const normalized: PatientShareScope = { ...DEFAULT_PATIENT_SHARE_SCOPE };
  if (!value) return normalized;

  for (const key of PATIENT_SHARE_SCOPE_KEYS) {
    const rawValue = value[key];
    if (typeof rawValue === 'boolean') {
      normalized[key] = rawValue;
    }
  }

  return normalized;
}

export function enabledPatientShareScopeKeys(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const scope = value as Record<string, unknown>;
  return PATIENT_SHARE_SCOPE_KEYS.filter((key) => scope[key] === true);
}

export function patientShareScopeCovers(args: { consentScope: unknown; shareScope: unknown }) {
  const consentKeys = new Set(enabledPatientShareScopeKeys(args.consentScope));
  return enabledPatientShareScopeKeys(args.shareScope).every((key) => consentKeys.has(key));
}
