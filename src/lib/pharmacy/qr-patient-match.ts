import { formatUtcDateKey } from '@/lib/date-key';

type QrPatientIdentity = {
  name?: string | null;
  nameKana?: string | null;
  birthDate?: string | null;
  gender?: string | null;
};

type PatientMasterIdentity = {
  name: string;
  name_kana?: string | null;
  birth_date: Date | string;
  gender?: string | null;
};

export type QrPatientIdentityMismatch = 'name' | 'name_kana' | 'birth_date' | 'gender';
export type QrPatientIdentityMissingField = 'name' | 'birth_date';
export type QrPatientIdentityAssessment =
  | { kind: 'matched' }
  | { kind: 'mismatch'; mismatches: QrPatientIdentityMismatch[] }
  | { kind: 'unverifiable'; missing: QrPatientIdentityMissingField[] };

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeIdentityText(value: string | null | undefined) {
  return value?.normalize('NFKC').replace(/[\s\u3000]+/g, '') ?? '';
}

function formatDateKey(value: Date | string) {
  if (value instanceof Date) {
    return formatUtcDateKey(value);
  }

  return value.slice(0, 10);
}

export function readQrPatientIdentityFromDraftParsedData(value: unknown): QrPatientIdentity {
  const parsedData = readObject(value);
  const patient = readObject(parsedData?.patient);

  return {
    name: readString(parsedData?.patientName) ?? readString(patient?.name),
    nameKana: readString(parsedData?.patientNameKana) ?? readString(patient?.nameKana),
    birthDate: readString(parsedData?.patientBirthdate) ?? readString(patient?.birthDate),
    gender: readString(parsedData?.patientGender) ?? readString(patient?.gender),
  };
}

export function collectQrPatientIdentityMismatches(
  qrPatient: QrPatientIdentity,
  patient: PatientMasterIdentity,
) {
  const mismatches: QrPatientIdentityMismatch[] = [];

  if (
    qrPatient.name &&
    normalizeIdentityText(qrPatient.name) !== normalizeIdentityText(patient.name)
  ) {
    mismatches.push('name');
  }

  if (
    qrPatient.nameKana &&
    normalizeIdentityText(qrPatient.nameKana) !== normalizeIdentityText(patient.name_kana)
  ) {
    mismatches.push('name_kana');
  }

  if (qrPatient.birthDate && qrPatient.birthDate !== formatDateKey(patient.birth_date)) {
    mismatches.push('birth_date');
  }

  if (qrPatient.gender && patient.gender && qrPatient.gender !== patient.gender) {
    mismatches.push('gender');
  }

  return mismatches;
}

export function collectMissingQrPatientIdentityFields(qrPatient: QrPatientIdentity) {
  const missing: QrPatientIdentityMissingField[] = [];
  if (!qrPatient.name) missing.push('name');
  if (!qrPatient.birthDate) missing.push('birth_date');
  return missing;
}

export function assessQrPatientIdentity(
  qrPatient: QrPatientIdentity,
  patient: PatientMasterIdentity,
): QrPatientIdentityAssessment {
  const missing = collectMissingQrPatientIdentityFields(qrPatient);
  if (missing.length > 0) return { kind: 'unverifiable', missing };

  const mismatches = collectQrPatientIdentityMismatches(qrPatient, patient);
  if (mismatches.length > 0) return { kind: 'mismatch', mismatches };

  return { kind: 'matched' };
}
