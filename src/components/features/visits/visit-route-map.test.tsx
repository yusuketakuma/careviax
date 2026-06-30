// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { VisitRouteMap } from './visit-route-map';

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Map: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Marker: ({ title, onClick }: { title?: string; onClick?: () => void }) => (
    <button type="button" title={title} onClick={onClick}>
      {title}
    </button>
  ),
  Polyline: () => <div />,
  InfoWindow: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
}));

setupDomTestEnv();

describe('VisitRouteMap', () => {
  const originalApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (originalApiKey == null) {
      delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    } else {
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = originalApiKey;
    }
  });

  it('exposes route marker status and priority in text labels', () => {
    render(
      <VisitRouteMap
        points={[
          {
            scheduleId: 'schedule_1',
            patientName: '患者A',
            address: '東京都千代田区1-1-1',
            lat: 35.1,
            lng: 139.1,
            orderLabel: '1',
            status: 'in_progress',
            priority: 'emergency',
            etaLabel: '09:05',
            timeLabel: '09:00 - 10:00',
            pointKind: 'schedule',
          },
        ]}
      />,
    );

    const marker = screen.getByTitle(
      '順路 1 / 患者A / 東京都千代田区1-1-1 / 種別 確定予定 / 状態 訪問中 / 優先度 緊急',
    );
    fireEvent.click(marker);

    expect(screen.getByText('状態 訪問中')).toBeTruthy();
    expect(screen.getByText('優先度 緊急')).toBeTruthy();
    expect(screen.getByText('確定予定')).toBeTruthy();
    expect(screen.getByText('ETA 09:05')).toBeTruthy();
  });

  it('renders route issue notes when no points can be placed on the map', () => {
    render(<VisitRouteMap points={[]} note="座標未設定: 患者A、患者B" />);

    expect(screen.getByText('地図に表示できる訪問先がありません。')).toBeTruthy();
    expect(screen.getByText('座標未設定: 患者A、患者B')).toBeTruthy();
  });
});
