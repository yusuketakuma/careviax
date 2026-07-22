import type { CreatePatientInput } from '@/lib/validations/patient';
import { isHomeVisitSchedulingPreferenceKey } from '@/lib/patient/home-visit-intake-patch';

export interface PatientCareCaseRevision {
  id: string;
  version: number;
}

export type PatientEditConflictType = 'stale_patient' | 'stale_care_case';

export interface PatientEditConcurrencyAuthority {
  expectedUpdatedAt: string;
  selectedCareCase: PatientCareCaseRevision | null;
}

export interface PatientEditAcknowledgement {
  data: {
    id: string;
    updated_at: string;
  };
  meta: {
    version_basis: {
      patient_updated_at: string;
      care_case_id: string | null;
      care_case_version: number | null;
    };
  };
}

export interface PendingPatientEditAcknowledgement {
  patientId: string;
  expectedUpdatedAt: string;
  careCaseId: string | null;
  expectedCareCaseVersion: number | null;
}

export function isPatientSchedulingPreferenceFieldName(fieldName: string) {
  if (!fieldName.startsWith('intake.')) return false;
  return isHomeVisitSchedulingPreferenceKey(fieldName.slice('intake.'.length));
}

function compactObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compactObject).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;

  const entries = Object.entries(value)
    .map(([key, item]) => [key, compactObject(item)] as const)
    .filter(([, item]) => item !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function materializeDirtyClearSentinels(value: unknown, dirtyFields: unknown) {
  if (dirtyFields === true) {
    return value === undefined || value === '' ? null : value;
  }
  if (!dirtyFields || Array.isArray(dirtyFields) || typeof dirtyFields !== 'object') return value;

  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result: Record<string, unknown> = { ...(source as Record<string, unknown>) };
  for (const [key, childDirtyFields] of Object.entries(dirtyFields)) {
    result[key] = materializeDirtyClearSentinels(result[key], childDirtyFields);
  }
  return result;
}

export function buildPatientEditPayload({
  data,
  expectedUpdatedAt,
  selectedCareCase,
  duplicateAcknowledged,
  dirtyFields,
}: {
  data: CreatePatientInput;
  expectedUpdatedAt: string;
  selectedCareCase: PatientCareCaseRevision | null;
  duplicateAcknowledged: boolean;
  dirtyFields?: { intake?: unknown };
}) {
  const editData = dirtyFields?.intake
    ? {
        ...data,
        intake: materializeDirtyClearSentinels(data.intake, dirtyFields.intake),
      }
    : data;
  const compacted = compactObject(editData) as Record<string, unknown>;
  const requester = compacted.requester;
  const intake = (compacted.intake ?? null) as Record<string, unknown> | null;
  const schedulingIntake = intake
    ? Object.fromEntries(
        Object.entries(intake).filter(([key]) => isHomeVisitSchedulingPreferenceKey(key)),
      )
    : undefined;
  const hasCareCaseMutation =
    requester !== undefined || Boolean(intake && Object.keys(intake).length);
  const hasCareCaseOwnedMutation =
    requester !== undefined ||
    Boolean(intake && Object.keys(intake).some((key) => !isHomeVisitSchedulingPreferenceKey(key)));

  if (!selectedCareCase && hasCareCaseOwnedMutation) {
    throw new Error('Care-case-owned patient intake requires a selected care case');
  }

  return {
    ...compacted,
    ...(selectedCareCase ? {} : { intake: compactObject(schedulingIntake) }),
    ...(duplicateAcknowledged ? { duplicate_acknowledged: true } : {}),
    expected_updated_at: expectedUpdatedAt,
    ...(selectedCareCase && hasCareCaseMutation
      ? {
          care_case_id: selectedCareCase.id,
          expected_care_case_version: selectedCareCase.version,
        }
      : !selectedCareCase && schedulingIntake && Object.keys(schedulingIntake).length > 0
        ? { care_case_id: null, expected_care_case_version: null }
        : {}),
  };
}

export function hasPatientEditConcurrencyAuthority(expectedUpdatedAt: string | null | undefined) {
  return typeof expectedUpdatedAt === 'string' && expectedUpdatedAt.trim().length > 0;
}

function hasCoherentCasePair(caseId: string | null, caseVersion: number | null) {
  return (caseId === null) === (caseVersion === null);
}

export function isValidPatientEditAcknowledgement(
  acknowledgement: PatientEditAcknowledgement,
  pending: PendingPatientEditAcknowledgement,
) {
  const basis = acknowledgement.meta.version_basis;
  const previousPatientVersion = new Date(pending.expectedUpdatedAt).getTime();
  const acknowledgedPatientVersion = new Date(basis.patient_updated_at).getTime();
  if (
    acknowledgement.data.id !== pending.patientId ||
    acknowledgement.data.updated_at !== basis.patient_updated_at ||
    !Number.isFinite(previousPatientVersion) ||
    !Number.isFinite(acknowledgedPatientVersion) ||
    acknowledgedPatientVersion <= previousPatientVersion ||
    !hasCoherentCasePair(pending.careCaseId, pending.expectedCareCaseVersion) ||
    !hasCoherentCasePair(basis.care_case_id, basis.care_case_version)
  ) {
    return false;
  }

  if (pending.careCaseId === null) {
    return basis.care_case_id === null && basis.care_case_version === null;
  }

  return (
    pending.expectedCareCaseVersion !== null &&
    basis.care_case_id === pending.careCaseId &&
    basis.care_case_version === pending.expectedCareCaseVersion + 1
  );
}

export function isPatientEditConflictType(value: unknown): value is PatientEditConflictType {
  return value === 'stale_patient' || value === 'stale_care_case';
}
