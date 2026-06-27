import { encodePathSegment } from '@/lib/http/path-segment';

export function buildPartnerVisitRecordHref(recordId: string) {
  return `/partner-visit-records/${encodePathSegment(recordId)}`;
}

export function buildPartnerVisitRecordApiPath(recordId: string, suffix = '') {
  return `/api/partner-visit-records/${encodePathSegment(recordId)}${suffix}`;
}
