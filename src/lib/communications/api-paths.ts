import { encodePathSegment } from '@/lib/http/path-segment';

export const COMMUNICATION_REQUESTS_API_PATH = '/api/communication-requests';

export type CommunicationRequestsApiPathParams = {
  requestType?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  patientId?: string | null;
  status?: string | null;
  limit?: number | null;
  cursor?: string | null;
};

function appendSearchParam(
  params: URLSearchParams,
  key: string,
  value: string | number | null | undefined,
) {
  if (value === null || value === undefined) return;
  const text = String(value);
  if (text.length === 0) return;
  params.set(key, text);
}

function toSearchParams(
  params: URLSearchParams | CommunicationRequestsApiPathParams | undefined,
): URLSearchParams | undefined {
  if (!params) return undefined;
  if (params instanceof URLSearchParams) return params;
  const searchParams = new URLSearchParams();
  appendSearchParam(searchParams, 'request_type', params.requestType);
  appendSearchParam(searchParams, 'related_entity_type', params.relatedEntityType);
  appendSearchParam(searchParams, 'related_entity_id', params.relatedEntityId);
  appendSearchParam(searchParams, 'patient_id', params.patientId);
  appendSearchParam(searchParams, 'status', params.status);
  appendSearchParam(searchParams, 'limit', params.limit);
  appendSearchParam(searchParams, 'cursor', params.cursor);
  return searchParams;
}

export function buildCommunicationRequestsApiPath(
  params?: URLSearchParams | CommunicationRequestsApiPathParams,
) {
  const query = toSearchParams(params)?.toString() ?? '';
  return query ? `${COMMUNICATION_REQUESTS_API_PATH}?${query}` : COMMUNICATION_REQUESTS_API_PATH;
}

export function buildCommunicationRequestApiPath(requestId: string, suffix = '') {
  return `${COMMUNICATION_REQUESTS_API_PATH}/${encodePathSegment(requestId)}${suffix}`;
}

export function buildCommunicationRequestResolveFollowupApiPath(requestId: string) {
  return buildCommunicationRequestApiPath(requestId, '/resolve-followup');
}
