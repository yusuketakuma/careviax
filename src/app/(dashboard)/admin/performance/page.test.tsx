// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@/components/features/admin/admin-page-header', () => ({
  AdminPageHeader: () => <header data-testid="admin-page-header" />,
}));

vi.mock('@/components/features/admin/admin-page-shortcut-presets', () => ({
  getAdminPerformanceShortcutLinks: () => [],
}));

vi.mock('@/app/(dashboard)/admin/staff/staff-kpi-panel', () => ({
  StaffKpiPanel: () => <section data-testid="staff-kpi-panel" />,
}));

import PerformancePage from './page';

setupDomTestEnv();

describe('PerformancePage polling policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
  });

  it('uses realtime invalidation for workflow metrics and slows runtime polling', () => {
    render(<PerformancePage />);

    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin-performance-workflow', 'org_1'],
        invalidateOn: ['workflow_refresh', 'cycle_transition'],
        fallbackRefetchInterval: 60_000,
      }),
    );
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['admin-performance-schedules', 'org_1']),
        invalidateOn: ['workflow_refresh'],
        fallbackRefetchInterval: 60_000,
      }),
    );
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['admin-performance-proposals', 'org_1']),
        invalidateOn: ['workflow_refresh'],
        fallbackRefetchInterval: 60_000,
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin-performance-runtime', 'org_1'],
        refetchInterval: 60_000,
      }),
    );
  });
});
