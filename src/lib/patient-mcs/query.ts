import { z } from 'zod';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { apiDataSchema } from '@/lib/api/response-schemas';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { parsePatientMcsViewData } from './dto';

const patientMcsOverviewResponseSchema = apiDataSchema(z.unknown()).transform((payload, ctx) => {
  try {
    return parsePatientMcsViewData(payload);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid patient MCS overview response' });
    return z.NEVER;
  }
});

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
  const failureMessage =
    response.status === 403 ? 'MCS 連携の閲覧権限がありません' : 'MCS 連携情報の取得に失敗しました';
  try {
    return await readApiJson(response, {
      fallbackMessage: failureMessage,
      schema: patientMcsOverviewResponseSchema,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : failureMessage;
    throw new PatientMcsOverviewQueryError(
      response.status === 403 ? 'forbidden' : 'failed',
      message,
    );
  }
}
