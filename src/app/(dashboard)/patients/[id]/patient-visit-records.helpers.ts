import { fetchAllCursorPages } from '@/lib/api/cursor-pagination-client';
import { buildOrgHeaders } from '@/lib/api/org-headers';

export const VISIT_RECORD_PAGE_LIMIT = 100;

export async function fetchPatientVisitRecordsWindow<T>(args: {
  orgId: string;
  patientId: string;
  dateFrom?: string;
  dateTo?: string;
  fetchImpl?: typeof fetch;
  limit?: number;
  maxPages?: number;
}) {
  const query = new URLSearchParams({
    patient_id: args.patientId,
  });
  if (args.dateFrom) query.set('date_from', args.dateFrom);
  if (args.dateTo) query.set('date_to', args.dateTo);

  const payload = await fetchAllCursorPages<T>({
    path: '/api/visit-records',
    params: query,
    init: {
      headers: buildOrgHeaders(args.orgId),
      cache: 'no-store',
    },
    fetchImpl: args.fetchImpl,
    limit: args.limit ?? VISIT_RECORD_PAGE_LIMIT,
    maxPages: args.maxPages,
    errorMessage: '訪問記録を取得できませんでした',
  });

  return payload.data;
}
