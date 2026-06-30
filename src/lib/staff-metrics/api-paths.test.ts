import { describe, expect, it } from 'vitest';
import { ADMIN_STAFF_METRICS_API_PATH, buildAdminStaffMetricsApiPath } from './api-paths';

describe('staff metrics API path helpers', () => {
  it('builds the collection API path', () => {
    expect(ADMIN_STAFF_METRICS_API_PATH).toBe('/api/admin/staff-metrics');
    expect(buildAdminStaffMetricsApiPath()).toBe('/api/admin/staff-metrics');
  });

  it('builds collection API paths with query params', () => {
    expect(buildAdminStaffMetricsApiPath(new URLSearchParams({ month: '2026-07' }))).toBe(
      '/api/admin/staff-metrics?month=2026-07',
    );
  });
});
