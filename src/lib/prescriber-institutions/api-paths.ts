import { encodePathSegment } from '@/lib/http/path-segment';

export const PRESCRIBER_INSTITUTIONS_API_PATH = '/api/prescriber-institutions';

export function buildPrescriberInstitutionsApiPath(params: URLSearchParams) {
  return `${PRESCRIBER_INSTITUTIONS_API_PATH}?${params.toString()}`;
}

export function buildPrescriberInstitutionApiPath(institutionId: string) {
  return `${PRESCRIBER_INSTITUTIONS_API_PATH}/${encodePathSegment(institutionId)}`;
}
