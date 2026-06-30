import { encodePathSegment } from '@/lib/http/path-segment';

export function buildVisitHref(visitId: string, suffix = '') {
  if (visitId === '.' || visitId === '..') {
    throw new RangeError('Visit id cannot be a dot segment');
  }

  return `/visits/${encodeURIComponent(visitId)}${suffix}`;
}

export function buildVisitRecordHref(scheduleId: string) {
  return buildVisitHref(scheduleId, '/record');
}

export function buildVisitFacilityPacketHref(scheduleId: string) {
  return buildVisitHref(scheduleId, '/facility-packet');
}

export function buildVisitRecordPdfHref(visitRecordId: string) {
  return `/api/visit-records/${encodePathSegment(visitRecordId)}/pdf`;
}
