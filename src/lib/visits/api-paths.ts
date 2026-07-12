import { encodePathSegment } from '@/lib/http/path-segment';

export function buildVisitMedicationStockObservationsApiPath(visitRecordId: string) {
  return `/api/visit-records/${encodePathSegment(visitRecordId)}/medication-stock-observations`;
}

export function buildVisitReflectedFieldsApiPath(visitRecordId: string) {
  return `/api/visit-records/${encodePathSegment(visitRecordId)}/reflected-fields`;
}
