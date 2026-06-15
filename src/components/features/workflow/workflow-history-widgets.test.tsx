// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { useOrgIdMock, useRealtimeQueryMock } = vi.hoisted(() => ({
  useOrgIdMock: vi.fn(),
  useRealtimeQueryMock: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@/components/ui/loading', () => ({
  Loading: () => <div>loading...</div>,
}));

import { PreviousStageSummary } from './previous-stage-summary';
import { StageTimeline } from './stage-timeline';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('workflow history widgets', () => {
  it('renders the latest transition summary', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: [
        {
          id: 'log_1',
          from_status: 'dispensed',
          to_status: 'audit_pending',
          actor_name: '山田薬剤師',
          note: null,
          created_at: '2026-04-01T10:00:00.000Z',
        },
        {
          id: 'log_2',
          from_status: 'audit_pending',
          to_status: 'audited',
          actor_name: '佐藤薬剤師',
          note: null,
          created_at: '2026-04-01T11:00:00.000Z',
        },
      ],
      isLoading: false,
    });

    render(<PreviousStageSummary cycleId="cycle_1" />);

    expect(screen.getByText('監査待ち')).toBeTruthy();
    expect(screen.getByText('監査済')).toBeTruthy();
    expect(screen.getByText('佐藤薬剤師')).toBeTruthy();
  });

  it('renders the timeline entries and notes', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: [
        {
          id: 'log_1',
          from_status: 'ready_to_dispense',
          to_status: 'dispensing',
          actor_name: '山田薬剤師',
          note: '一包化を確認',
          created_at: '2026-04-01T09:30:00.000Z',
        },
      ],
      isLoading: false,
    });

    render(<StageTimeline cycleId="cycle_1" />);

    expect(screen.getByText('調剤準備完了')).toBeTruthy();
    expect(screen.getByText('調剤中')).toBeTruthy();
    expect(screen.getByText(/山田薬剤師/)).toBeTruthy();
    expect(screen.getByText('一包化を確認')).toBeTruthy();
  });

  it('shows the empty state when no history exists', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
    });

    render(<StageTimeline cycleId="cycle_1" />);

    expect(screen.getByText('ステータス遷移履歴がありません')).toBeTruthy();
  });
});
