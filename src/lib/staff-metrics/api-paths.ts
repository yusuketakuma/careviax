export const ADMIN_STAFF_METRICS_API_PATH = '/api/admin/staff-metrics';

export function buildAdminStaffMetricsApiPath(params?: URLSearchParams) {
  const query = params?.toString() ?? '';
  return query ? `${ADMIN_STAFF_METRICS_API_PATH}?${query}` : ADMIN_STAFF_METRICS_API_PATH;
}
