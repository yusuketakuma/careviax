import { encodePathSegment } from '@/lib/http/path-segment';

export function buildCommunicationRequestApiPath(requestId: string, suffix = '') {
  return `/api/communication-requests/${encodePathSegment(requestId)}${suffix}`;
}

export function buildCommunicationRequestResolveFollowupApiPath(requestId: string) {
  return buildCommunicationRequestApiPath(requestId, '/resolve-followup');
}
