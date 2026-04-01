// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const visitBriefCacheToArrayMock = vi.hoisted(() => vi.fn(async () => []));
const visitBriefCacheDeleteMock = vi.hoisted(() => vi.fn(async () => {}));
const visitBriefCacheAddMock = vi.hoisted(() => vi.fn(async () => {}));
const visitBriefCacheWhereMock = vi.hoisted(() =>
  vi.fn((field: string) => ({
    equals: vi.fn(() =>
      field === 'scheduledDate'
        ? { toArray: visitBriefCacheToArrayMock }
        : { delete: visitBriefCacheDeleteMock }
    ),
  }))
);

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
}));

vi.mock('@/components/home-care/home-care-feature-board', () => ({
  HomeCareFeatureHighlights: () => <div />,
}));

vi.mock('@/components/visit-brief/visit-brief-card', () => ({
  VisitBriefCard: () => <div />,
}));

vi.mock('@/components/features/visits/visit-card-mobile', () => ({
  VisitCardMobile: () => <div />,
}));

vi.mock('@/components/features/visits/visit-route-map', () => ({
  VisitRouteMap: () => <div />,
}));

vi.mock('./schedule-metric-card', () => ({
  ScheduleMetricCard: () => <div />,
}));

vi.mock('./schedule-day-view.chrome', () => ({
  OnboardingWarningBadges: () => <div />,
  ScheduleBoardSkeleton: () => <div data-testid="schedule-board-skeleton" />,
}));

vi.mock('@/lib/stores/offline-db', () => ({
  offlineDb: {
    visitBriefCache: {
      where: visitBriefCacheWhereMock,
      add: visitBriefCacheAddMock,
      delete: visitBriefCacheDeleteMock,
    },
  },
}));

vi.mock('@/lib/stores/offline-store', () => ({
  useOfflineStore: vi.fn((selector: (state: {
    isOffline: boolean;
    pendingSyncCount: number;
    pendingQueue: never[];
    syncConflicts: never[];
    cacheTtlHours: number;
    lastSyncRefreshAt: null;
    syncOnlineStatus: ReturnType<typeof vi.fn>;
    refreshSyncState: ReturnType<typeof vi.fn>;
  }) => unknown) =>
    selector({
      isOffline: false,
      pendingSyncCount: 0,
      pendingQueue: [],
      syncConflicts: [],
      cacheTtlHours: 24,
      lastSyncRefreshAt: null,
      syncOnlineStatus: vi.fn(),
      refreshSyncState: vi.fn(),
    })),
}));

vi.mock('@/lib/stores/sync-engine', () => ({
  discardSyncQueueItem: vi.fn(),
  overwriteVisitRecordConflict: vi.fn(),
  processSyncQueue: vi.fn(),
  setupAutoSync: vi.fn(() => () => {}),
}));

import { ScheduleDayView } from './day-view';

setupDomTestEnv();

describe('ScheduleDayView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitBriefCacheToArrayMock.mockResolvedValue([]);
    useOrgIdMock.mockReturnValue('');
    useRouterMock.mockReturnValue({ push: vi.fn() });
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useRealtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      connected: false,
    });
  });

  it('renders the schedule board skeleton while org context is bootstrapping', () => {
    render(<ScheduleDayView />);

    expect(screen.getByTestId('schedule-board-skeleton')).toBeTruthy();
  });
});
