import { fetchAllCursorPages } from '@/lib/api/cursor-pagination-client';

export const VISIT_SCHEDULE_PAGE_LIMIT = 100;

export async function fetchVisitSchedulesWindow<T>(args: {
  orgId: string;
  dateFrom: string;
  dateTo: string;
  statusScope?: 'active';
  fetchImpl?: typeof fetch;
  limit?: number;
  maxPages?: number;
}) {
  const payload = await fetchAllCursorPages<T>({
    path: '/api/visit-schedules',
    params: new URLSearchParams({
      date_from: args.dateFrom,
      date_to: args.dateTo,
      ...(args.statusScope ? { status_scope: args.statusScope } : {}),
    }),
    init: {
      headers: { 'x-org-id': args.orgId },
    },
    fetchImpl: args.fetchImpl,
    limit: args.limit ?? VISIT_SCHEDULE_PAGE_LIMIT,
    maxPages: args.maxPages,
    errorMessage: 'スケジュールの取得に失敗しました',
  });

  return payload.data;
}
