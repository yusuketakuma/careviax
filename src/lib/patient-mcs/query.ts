import { buildOrgHeaders } from '@/lib/api/org-headers';
import { readJsonObjectResponseBody } from '@/lib/api/response-body';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { parsePatientMcsViewData } from './dto';

export class PatientMcsOverviewQueryError extends Error {
  constructor(
    readonly code: 'forbidden' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'PatientMcsOverviewQueryError';
  }
}

export function createPatientMcsQueryKeyPrefix(patientId: string, orgId: string) {
  return ['patient-mcs', patientId, orgId] as const;
}

export function createPatientMcsQueryKey(patientId: string, orgId: string, limit: number) {
  return [...createPatientMcsQueryKeyPrefix(patientId, orgId), limit] as const;
}

export async function fetchPatientMcsOverview(patientId: string, orgId: string, limit: number) {
  const normalizedLimit = Number.isInteger(limit) && limit >= 0 ? limit : 0;
  const params = new URLSearchParams({ limit: String(normalizedLimit) });
  const response = await fetch(`${buildPatientApiPath(patientId, '/mcs')}?${params.toString()}`, {
    headers: buildOrgHeaders(orgId),
    cache: 'no-store',
  });
  const payload = await readJsonObjectResponseBody(response);
  const message = typeof payload?.message === 'string' ? payload.message : undefined;

  if (response.status === 403) {
    throw new PatientMcsOverviewQueryError(
      'forbidden',
      message ?? 'MCS 連携の閲覧権限がありません',
    );
  }

  if (!response.ok) {
    throw new PatientMcsOverviewQueryError('failed', message ?? 'MCS 連携情報の取得に失敗しました');
  }

  try {
    return parsePatientMcsViewData(payload);
  } catch {
    throw new PatientMcsOverviewQueryError('failed', 'MCS 連携情報の取得に失敗しました');
  }
}
