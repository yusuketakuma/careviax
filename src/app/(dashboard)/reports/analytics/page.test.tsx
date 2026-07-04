// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const reportDeliveryDashboardMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('../report-delivery-dashboard', () => ({
  ReportDeliveryDashboard: () => {
    if (reportDeliveryDashboardMockState.suspend) {
      throw reportDeliveryDashboardMockState.promise;
    }
    return <section data-testid="report-delivery-dashboard" />;
  },
}));

import ReportsAnalyticsPage from './page';

setupDomTestEnv();

describe('ReportsAnalyticsPage', () => {
  beforeEach(() => {
    reportDeliveryDashboardMockState.suspend = false;
  });

  it('renders the report delivery analytics shell', () => {
    render(<ReportsAnalyticsPage />);

    expect(screen.getByRole('heading', { name: '報告書送達分析' })).toBeTruthy();
    expect(screen.getByTestId('report-delivery-dashboard')).toBeTruthy();
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    reportDeliveryDashboardMockState.suspend = true;

    render(<ReportsAnalyticsPage />);

    expect(screen.getByRole('heading', { name: '報告書送達分析' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '報告書送達分析を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('report-delivery-dashboard')).toBeNull();
  });
});
