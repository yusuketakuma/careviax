import { z } from 'zod';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import {
  decryptOfflinePayload,
  encryptOfflinePayloadRequired,
  isEncryptedOfflinePayload,
} from '@/lib/offline/crypto';
import { isHomeVisitSchedulingPreferenceKey } from '@/lib/patient/home-visit-intake-patch';
import { offlineDb } from '@/lib/stores/offline-db';

const LEGACY_STORAGE_PREFIX = 'careviax:visit-patient-reflection:v1';
const ENCRYPTION_CONTEXT = 'visit patient reflection continuation';

export type PendingPatientReflection = {
  patientId: string;
  sourceVisitRecordId: string;
  intake: Record<string, string>;
  expectedUpdatedAt: string;
  careCaseId: string | null;
  expectedCareCaseVersion: number | null;
};

export type DurablePatientReflectionContinuation = {
  scheduleId: string;
  reflection: PendingPatientReflection;
  record: { id: string; version: number; patient_id: string };
  status: 'stale' | 'failed' | 'resolved';
};

export type PatientReflectionContinuationLoadResult =
  | { kind: 'loaded'; continuation: DurablePatientReflectionContinuation }
  | { kind: 'unavailable'; recordId: string };

export type PatientReflectionResult = { ok: true } | { ok: false; reason: 'stale' | 'failed' };

const patientPatchSuccessSchema = z
  .object({
    data: z
      .object({
        id: z.string().trim().min(1),
        updated_at: z.string().datetime({ offset: true }),
      })
      .strict(),
    meta: z
      .object({
        warnings: z.array(
          z
            .object({
              code: z.string(),
              severity: z.literal('warning'),
              message: z.string(),
            })
            .strict(),
        ),
        duplicate_candidates: z.array(z.unknown()),
        version_basis: z
          .object({
            patient_updated_at: z.string().datetime({ offset: true }),
            care_case_id: z.string().trim().min(1).nullable(),
            care_case_version: z.number().int().positive().nullable(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

function hasCoherentCasePair(caseId: string | null, caseVersion: number | null) {
  return (caseId === null) === (caseVersion === null);
}

export function buildPatientReflectionPayload(pending: PendingPatientReflection) {
  return {
    intake: pending.intake,
    source_visit_record_id: pending.sourceVisitRecordId,
    expected_updated_at: pending.expectedUpdatedAt,
    care_case_id: pending.careCaseId,
    expected_care_case_version: pending.expectedCareCaseVersion,
  };
}

export function requiresPatientReflectionCareCaseTarget(intake: Record<string, string>) {
  return Object.keys(intake).some((key) => !isHomeVisitSchedulingPreferenceKey(key));
}

export function purgeLegacyPatientReflectionStorage() {
  try {
    if (typeof window === 'undefined') return;
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(LEGACY_STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Best-effort legacy purge. No value is ever read into application memory.
  }
}

function isDurableContinuation(
  value: unknown,
  scheduleId: string,
  recordId: string,
): value is DurablePatientReflectionContinuation {
  if (!value || typeof value !== 'object') return false;
  const continuation = value as Partial<DurablePatientReflectionContinuation>;
  const reflection = continuation.reflection as Partial<PendingPatientReflection> | undefined;
  const record = continuation.record as DurablePatientReflectionContinuation['record'] | undefined;
  return (
    continuation.scheduleId === scheduleId &&
    (continuation.status === 'stale' ||
      continuation.status === 'failed' ||
      continuation.status === 'resolved') &&
    record?.id === recordId &&
    typeof record.version === 'number' &&
    typeof record.patient_id === 'string' &&
    typeof reflection?.patientId === 'string' &&
    reflection.patientId === record.patient_id &&
    reflection.sourceVisitRecordId === record.id &&
    Boolean(reflection.intake) &&
    typeof reflection.intake === 'object' &&
    Object.values(reflection.intake).every((entry) => typeof entry === 'string') &&
    typeof reflection.expectedUpdatedAt === 'string' &&
    (reflection.careCaseId === null || typeof reflection.careCaseId === 'string') &&
    (reflection.expectedCareCaseVersion === null ||
      (typeof reflection.expectedCareCaseVersion === 'number' &&
        Number.isInteger(reflection.expectedCareCaseVersion) &&
        reflection.expectedCareCaseVersion > 0)) &&
    hasCoherentCasePair(reflection.careCaseId ?? null, reflection.expectedCareCaseVersion ?? null)
  );
}

export async function persistPatientReflectionContinuation(
  orgId: string,
  continuation: DurablePatientReflectionContinuation,
) {
  purgeLegacyPatientReflectionStorage();
  if (!orgId.trim() || !continuation.scheduleId.trim() || !continuation.record.id.trim()) {
    throw new Error('visit patient reflection continuation identity is required');
  }
  const payload = await encryptOfflinePayloadRequired(
    JSON.stringify(continuation),
    ENCRYPTION_CONTEXT,
  );
  await offlineDb.transaction('rw', offlineDb.visitReflectionContinuations, async () => {
    await offlineDb.visitReflectionContinuations
      .where('[orgId+scheduleId]')
      .equals([orgId, continuation.scheduleId])
      .delete();
    await offlineDb.visitReflectionContinuations.add({
      orgId,
      scheduleId: continuation.scheduleId,
      recordId: continuation.record.id,
      payload,
      updatedAt: new Date(),
    });
  });
}

export async function loadPatientReflectionContinuation(
  orgId: string,
  scheduleId: string,
): Promise<PatientReflectionContinuationLoadResult | null> {
  purgeLegacyPatientReflectionStorage();
  if (!orgId.trim() || !scheduleId.trim()) return null;
  const row = await offlineDb.visitReflectionContinuations
    .where('[orgId+scheduleId]')
    .equals([orgId, scheduleId])
    .reverse()
    .first();
  if (!row) return null;
  if (!isEncryptedOfflinePayload(row.payload)) {
    return { kind: 'unavailable', recordId: row.recordId };
  }
  const raw = await decryptOfflinePayload(row.payload);
  if (!raw) return { kind: 'unavailable', recordId: row.recordId };
  try {
    const parsed: unknown = JSON.parse(raw);
    return isDurableContinuation(parsed, scheduleId, row.recordId)
      ? { kind: 'loaded', continuation: parsed }
      : { kind: 'unavailable', recordId: row.recordId };
  } catch {
    return { kind: 'unavailable', recordId: row.recordId };
  }
}

export async function clearPatientReflectionContinuation(
  orgId: string,
  scheduleId: string,
  recordId: string,
) {
  if (!orgId.trim() || !scheduleId.trim() || !recordId.trim()) {
    throw new Error('visit patient reflection continuation identity is required');
  }
  await offlineDb.visitReflectionContinuations
    .where('[orgId+scheduleId+recordId]')
    .equals([orgId, scheduleId, recordId])
    .delete();
}

export async function finalizeResolvedReflectionContinuation(
  orgId: string,
  scheduleId: string,
  reflection: PendingPatientReflection,
  record: DurablePatientReflectionContinuation['record'],
) {
  try {
    await persistPatientReflectionContinuation(orgId, {
      scheduleId,
      reflection,
      record,
      status: 'resolved',
    });
    await clearPatientReflectionContinuation(orgId, scheduleId, record.id);
    return true;
  } catch {
    return false;
  }
}

export async function patchPatientReflection(
  pending: PendingPatientReflection,
  orgId: string,
): Promise<PatientReflectionResult> {
  try {
    if (!hasCoherentCasePair(pending.careCaseId, pending.expectedCareCaseVersion)) {
      return { ok: false, reason: 'failed' };
    }
    const response = await fetch(buildPatientApiPath(pending.patientId), {
      method: 'PATCH',
      headers: buildOrgJsonHeaders(orgId),
      body: JSON.stringify(buildPatientReflectionPayload(pending)),
    });
    if (!response.ok) {
      return { ok: false, reason: response.status === 409 ? 'stale' : 'failed' };
    }
    const parsed = patientPatchSuccessSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.data.id !== pending.patientId) {
      return { ok: false, reason: 'failed' };
    }
    const { data, meta } = parsed.data;
    const basis = meta.version_basis;
    const previousPatientVersion = new Date(pending.expectedUpdatedAt).getTime();
    if (
      !Number.isFinite(previousPatientVersion) ||
      !hasCoherentCasePair(basis.care_case_id, basis.care_case_version) ||
      data.updated_at !== basis.patient_updated_at ||
      new Date(basis.patient_updated_at).getTime() <= previousPatientVersion
    ) {
      return { ok: false, reason: 'failed' };
    }
    if (pending.careCaseId === null) {
      if (basis.care_case_id !== null || basis.care_case_version !== null) {
        return { ok: false, reason: 'failed' };
      }
    } else if (
      pending.expectedCareCaseVersion === null ||
      basis.care_case_id !== pending.careCaseId ||
      basis.care_case_version !== pending.expectedCareCaseVersion + 1
    ) {
      return { ok: false, reason: 'failed' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
