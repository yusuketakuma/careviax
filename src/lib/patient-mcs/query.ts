import { parsePatientMcsViewData } from './dto';

export class PatientMcsOverviewQueryError extends Error {
  constructor(
    readonly code: 'forbidden' | 'failed',
    message: string
  ) {
    super(message);
    this.name = 'PatientMcsOverviewQueryError';
  }
}

export function createPatientMcsQueryKeyPrefix(patientId: string, orgId: string) {
  return ['patient-mcs', patientId, orgId] as const;
}

export function createPatientMcsQueryKey(
  patientId: string,
  orgId: string,
  limit: number
) {
  return [...createPatientMcsQueryKeyPrefix(patientId, orgId), limit] as const;
}

export async function fetchPatientMcsOverview(
  patientId: string,
  orgId: string,
  limit: number
) {
  const normalizedLimit = Number.isInteger(limit) && limit >= 0 ? limit : 0;
  const params = new URLSearchParams({ limit: String(normalizedLimit) });
  const response = await fetch(`/api/patients/${patientId}/mcs?${params.toString()}`, {
    headers: { 'x-org-id': orgId },
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => null)) as
    | { message?: string; data?: unknown }
    | null;

  if (response.status === 403) {
    throw new PatientMcsOverviewQueryError(
      'forbidden',
      payload?.message ?? 'MCS 連携の閲覧権限がありません'
    );
  }

  if (!response.ok) {
    throw new PatientMcsOverviewQueryError(
      'failed',
      payload?.message ?? 'MCS 連携情報の取得に失敗しました'
    );
  }

  return parsePatientMcsViewData(payload as Parameters<typeof parsePatientMcsViewData>[0]);
}
