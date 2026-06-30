// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

vi.mock('./visit-route-map', () => ({
  VisitRouteMap: () => <div data-testid="visit-route-map" />,
}));

import { VisitRoutePreviewPanel } from './visit-route-preview-panel';

setupDomTestEnv();

describe('VisitRoutePreviewPanel', () => {
  it('renders route summary and ordered stops', () => {
    const handleApply = vi.fn();
    const handleMove = vi.fn();

    render(
      <VisitRoutePreviewPanel
        controlId="test-route-preview"
        title="route preview"
        description="desc"
        selectionLabel="薬剤師A / 2026-04-09"
        travelMode="DRIVE"
        plan={{
          status: 'ok',
          note: null,
          travelMode: 'DRIVE',
          origin: { lat: 35, lng: 139, label: '本店' },
          encodedPath: 'encoded',
          orderedScheduleIds: ['schedule_1', 'proposal:proposal_1'],
          totalDistanceMeters: 3200,
          totalDurationSeconds: 1200,
          distanceSource: 'mixed',
          stopSummaries: [
            {
              scheduleId: 'schedule_1',
              optimizedOrder: 1,
              arrivalOffsetSeconds: 300,
              distanceFromPreviousMeters: 1200,
              durationFromPreviousSeconds: 300,
            },
            {
              scheduleId: 'proposal:proposal_1',
              optimizedOrder: 2,
              arrivalOffsetSeconds: 900,
              distanceFromPreviousMeters: 2000,
              durationFromPreviousSeconds: 600,
            },
          ],
        }}
        points={[
          {
            scheduleId: 'schedule_1',
            patientName: '患者A',
            address: '東京都千代田区1-1-1',
            lat: 35.1,
            lng: 139.1,
            orderLabel: '1',
            status: 'planned',
            priority: 'normal',
            pointKind: 'schedule',
            timeLabel: '09:00 - 10:00',
            etaLabel: '09:05',
          },
          {
            scheduleId: 'proposal:proposal_1',
            patientName: '患者B',
            address: '東京都千代田区1-1-2',
            lat: 35.2,
            lng: 139.2,
            orderLabel: '2',
            status: 'planned',
            priority: 'urgent',
            pointKind: 'proposal',
            timeLabel: '10:30 - 11:30',
            etaLabel: '09:15',
          },
        ]}
        site={{ name: '本店', lat: 35, lng: 139 }}
        currentOrderedIds={['proposal:proposal_1', 'schedule_1']}
        orderedIds={['schedule_1', 'proposal:proposal_1']}
        onMoveItem={handleMove}
        actionLabel="最適順を反映"
        onAction={handleApply}
      />,
    );

    expect(screen.getByText('薬剤師A / 2026-04-09')).toBeTruthy();
    expect(screen.getByText('起点 本店')).toBeTruthy();
    expect(screen.getByText(/患者A/)).toBeTruthy();
    expect(screen.getByText(/患者B/)).toBeTruthy();
    expect(screen.getAllByText('確定予定')[0]).toBeTruthy();
    expect(screen.getAllByText('候補')[0]).toBeTruthy();
    expect(screen.getAllByText('現順 2')[0]).toBeTruthy();
    expect(screen.getByText('道路+直線推定').closest('[data-role="confirm"]')).toBeTruthy();
    expect(screen.getByTestId('visit-route-map')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: '後ろへ' })[0]);
    expect(handleMove).toHaveBeenCalledWith('schedule_1', 'down');
    fireEvent.click(screen.getByRole('button', { name: '最適順を反映' }));
    expect(handleApply).toHaveBeenCalledTimes(1);
  });

  it('shows the travel mode label, not the raw enum, in the closed select trigger', () => {
    // bare <SelectValue /> は既定値 'DRIVE' の生 enum を初期表示で漏らす。
    // 明示 children で常に日本語ラベル('車')を表示することを固定する(SSR enum 漏れ封止)。
    render(
      <VisitRoutePreviewPanel
        controlId="test-route-preview"
        title="route preview"
        description="desc"
        travelMode="DRIVE"
        plan={null}
        points={[]}
        onTravelModeChange={vi.fn()}
      />,
    );

    const trigger = screen.getByLabelText('移動手段');
    expect(trigger.textContent).toContain('車');
    expect(trigger.textContent).not.toContain('DRIVE');
  });

  it('announces route calculation loading, empty, and error states', () => {
    const baseProps = {
      controlId: 'test-route-preview',
      title: 'route preview',
      description: 'desc',
      travelMode: 'DRIVE' as const,
      plan: null,
      points: [],
    };

    const { rerender } = render(<VisitRoutePreviewPanel {...baseProps} loading />);
    expect(screen.getByRole('status').textContent).toContain('ルートを計算中');

    rerender(<VisitRoutePreviewPanel {...baseProps} emptyMessage="対象がありません" />);
    expect(screen.getByRole('status').textContent).toContain('対象がありません');

    rerender(<VisitRoutePreviewPanel {...baseProps} errorMessage="ルート計算に失敗しました" />);
    expect(screen.getByRole('alert').textContent).toContain('ルート計算に失敗しました');
  });

  it('keeps route preview issue notes visible when every point is dropped', () => {
    render(
      <VisitRoutePreviewPanel
        controlId="test-route-preview"
        title="route preview"
        description="desc"
        travelMode="DRIVE"
        plan={{
          status: 'ok',
          note: '座標未設定: 患者A、患者B',
          travelMode: 'DRIVE',
          origin: { lat: 35, lng: 139, label: '本店' },
          encodedPath: null,
          orderedScheduleIds: [],
          totalDistanceMeters: null,
          totalDurationSeconds: null,
          stopSummaries: [],
        }}
        points={[]}
        emptyMessage="地図に表示できる訪問先がありません"
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('地図に表示できる訪問先がありません');
    expect(screen.getByRole('status').textContent).toContain('座標未設定: 患者A、患者B');
  });
});
