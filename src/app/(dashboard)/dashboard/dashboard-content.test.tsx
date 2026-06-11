// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DashboardContent } from './dashboard-content';

setupDomTestEnv();

vi.mock('./dashboard-cockpit', () => ({
  DashboardCockpit: () => <div data-testid="dashboard-cockpit">dashboard-cockpit</div>,
}));

vi.mock('./today-tasks-section', () => ({
  TodayTasksSection: () => <div>today-tasks</div>,
}));

vi.mock('./workflow-navigation', () => ({
  WorkflowNavigation: () => <div>workflow-navigation</div>,
}));

vi.mock('./workbench-navigation', () => ({
  WorkbenchNavigation: () => <div>workbench-navigation</div>,
}));

vi.mock('./coordination-navigation', () => ({
  CoordinationNavigation: () => <div>coordination-navigation</div>,
}));

vi.mock('./admin-navigation', () => ({
  AdminNavigation: () => <div>admin-navigation</div>,
}));

vi.mock('./schedule-section', () => ({
  ScheduleSection: () => <div>schedule-section</div>,
}));

vi.mock('./dashboard-role-guide', () => ({
  DashboardRoleGuide: () => <div>dashboard-role-guide</div>,
}));

vi.mock('./patient-grid-section', () => ({
  PatientGridSection: () => <div>patient-grid-section</div>,
}));

vi.mock('./billing-kpi-section', () => ({
  BillingKpiSection: () => <div>billing-kpi-section</div>,
}));

vi.mock('./dashboard-summary-badges', () => ({
  DashboardSummaryBadges: () => <div data-testid="dashboard-summary-badges" />,
}));

describe('DashboardContent', () => {
  it('puts the new operations cockpit first and keeps the legacy navigation groups below', () => {
    render(<DashboardContent />);

    const cockpit = screen.getByTestId('dashboard-cockpit');
    expect(cockpit).toBeTruthy();

    // 旧構成(機能温存): 今日の運用 / 業務導線 / 請求状況 はコックピットの下に残る
    const dailyOperations = screen.getByText('今日の運用');
    expect(dailyOperations).toBeTruthy();
    expect(screen.getByText('業務導線')).toBeTruthy();
    expect(screen.getByText('請求状況')).toBeTruthy();
    expect(screen.getByTestId('dashboard-summary-badges')).toBeTruthy();
    expect(screen.getByText('患者カード')).toBeTruthy();
    expect(screen.getByText('職種ごとの初動')).toBeTruthy();
    expect(screen.getByText('主業務フロー')).toBeTruthy();
    expect(screen.getByTestId('dashboard-priority-actions')).toBeTruthy();

    // コックピットがビューポート最上部(旧グループより前)に来る
    expect(
      cockpit.compareDocumentPosition(dailyOperations) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps the help popover behaviour of the legacy sections', () => {
    render(<DashboardContent />);

    expect(
      screen.queryByText(
        '薬剤師、事務スタッフ、全員共通の入口を分け、誰が最初に何を確認するかを揃えて判断できるようにしています。',
      ),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '職種ごとの初動の説明' }));
    expect(
      screen.getByText(
        '薬剤師、事務スタッフ、全員共通の入口を分け、誰が最初に何を確認するかを揃えて判断できるようにしています。',
      ),
    ).toBeTruthy();
  });
});
