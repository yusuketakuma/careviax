// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: () => <div data-testid="reports-table-grid" />,
}));

import { ReportsTable } from './reports-table';

setupDomTestEnv();

describe('ReportsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/reports');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=dashboard_home'));
    useQueryMock.mockReturnValue({
      data: {
        data: [],
        deliverySummary: {
          pending_delivery_count: 1,
          failed_delivery_count: 0,
          by_status: {},
        },
      },
      isLoading: false,
    });
  });

  it('shows the home context banner and seeds delivery status filtering', () => {
    render(
      <ReportsTable
        initialDeliveryStatus="response_waiting"
        initialContext="dashboard_home"
        initialPatientId="patient_1"
        initialVisitRecordId="visit_1"
      />,
    );

    expect(screen.getByTestId('reports-table-context-banner')).toBeTruthy();
    expect(screen.getByTestId('reports-linked-context-banner')).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [
          'care-reports',
          'org_1',
          expect.stringContaining('delivery_status=response_waiting'),
        ],
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['care-reports', 'org_1', expect.stringContaining('patient_id=patient_1')],
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['care-reports', 'org_1', expect.stringContaining('visit_record_id=visit_1')],
      }),
    );
  });
});
