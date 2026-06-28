import { encodePathSegment } from '@/lib/http/path-segment';

export const BUSINESS_HOLIDAYS_API_PATH = '/api/business-holidays';

export function buildBusinessHolidaysApiPath(params?: URLSearchParams) {
  return params ? `${BUSINESS_HOLIDAYS_API_PATH}?${params.toString()}` : BUSINESS_HOLIDAYS_API_PATH;
}

export function buildBusinessHolidayApiPath(holidayId: string) {
  return `${BUSINESS_HOLIDAYS_API_PATH}/${encodePathSegment(holidayId)}`;
}
