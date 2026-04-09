// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/features/visits/visit-route-map', () => ({
  VisitRouteMap: () => <div />,
}));

import { ScheduleProposalsContent } from './schedule-proposals-content';

setupDomTestEnv();

function buildProposal(overrides?: Record<string, unknown>) {
  return {
    id: 'proposal_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'proposed',
    patient_contact_status: 'pending',
    proposed_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    proposed_pharmacist_id: 'pharmacist_1',
    proposed_pharmacist: { id: 'pharmacist_1', name: '薬剤師A', name_kana: null },
    assignment_mode: 'primary',
    route_order: 1,
    route_distance_score: 1.4,
    medication_end_date: null,
    visit_deadline_date: '2026-04-11',
    proposal_reason: '移動良好',
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
      },
    },
    site: { id: 'site_1', name: '本店', address: '東京都千代田区2-2-2', lat: 35.0, lng: 139.0 },
    finalized_schedule: null,
    reschedule_source_schedule: null,
    contact_logs: [],
    ...overrides,
  };
}

describe('ScheduleProposalsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/schedules/proposals');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('workspace=dashboard'));
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false });
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: { data: [buildProposal()] },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: undefined,
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });
  });

  it('syncs preset changes into the URL', () => {
    render(<ScheduleProposalsContent initialDateFrom="2026-04-09" />);

    fireEvent.click(screen.getByRole('button', { name: /本日候補/ }));

    expect(useRouterMock().replace).toHaveBeenCalledWith(
      expect.stringContaining('workspace=dashboard'),
      { scroll: false }
    );
    expect(useRouterMock().replace).toHaveBeenCalledWith(
      expect.stringContaining('preset=today'),
      { scroll: false }
    );
  });
});
