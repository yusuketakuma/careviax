import { encodePathSegment } from '@/lib/http/path-segment';

export function buildVisitRecordApiPath(visitRecordId: string) {
  return `/api/visit-records/${encodePathSegment(visitRecordId)}`;
}

export function buildVisitScheduleApiPath(visitScheduleId: string) {
  return `/api/visit-schedules/${encodePathSegment(visitScheduleId)}`;
}

export function buildVisitMedicationStockObservationsApiPath(visitRecordId: string) {
  return `/api/visit-records/${encodePathSegment(visitRecordId)}/medication-stock-observations`;
}

export function buildVisitReflectedFieldsApiPath(visitRecordId: string) {
  return `/api/visit-records/${encodePathSegment(visitRecordId)}/reflected-fields`;
}
