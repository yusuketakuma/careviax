// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

import { PreviousStageSummary } from './previous-stage-summary';
import { StageTimeline } from './stage-timeline';

setupDomTestEnv();

describe('workflow history widgets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
  });

  it('renders the latest transition summary and subscribes to workflow invalidations', () => {
    useRealtimeQueryMock.mockReturnValue({
      data: [
        {
          id: 'log_1',
          from_status: 'dispensed',
          to_status: 'audit_pending',
          actor_name: '薬剤師A',
          note: null,
          created_at: '2026-04-01T10:00:00.000Z',
        },
      ],
    });

    render(<PreviousStageSummary cycleId="cycle_1" />);

    expect(screen.getByText('調剤済')).toBeTruthy();
    expect(screen.getByText('鑑査待ち')).toBeTruthy();
    expect(screen.getByText('薬剤師A')).toBeTruthy();
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['cycle-transition-logs', 'cycle_1', 'org_1'],
        invalidateOn: ['cycle_transition', 'workflow_refresh'],
      }),
    );
  });

  it('renders an empty state when no timeline entries exist', () => {
    useRealtimeQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
    });

    render(<StageTimeline cycleId="cycle_1" />);

    expect(screen.getByText('ステータス遷移履歴がありません')).toBeTruthy();
  });

  it('renders timeline entries with notes', () => {
    useRealtimeQueryMock.mockReturnValue({
      data: [
        {
          id: 'log_1',
          from_status: 'audit_pending',
          to_status: 'audited',
          actor_name: '薬剤師B',
          note: '監査メモ',
          created_at: '2026-04-01T11:00:00.000Z',
        },
      ],
      isLoading: false,
    });

    render(<StageTimeline cycleId="cycle_1" />);

    expect(screen.getByText('鑑査待ち')).toBeTruthy();
    expect(screen.getByText('鑑査済')).toBeTruthy();
    expect(screen.getByText('監査メモ')).toBeTruthy();
  });
});
