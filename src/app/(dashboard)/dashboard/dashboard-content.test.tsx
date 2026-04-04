// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DashboardContent } from './dashboard-content';

setupDomTestEnv();

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

vi.mock('./patient-grid-section', () => ({
  PatientGridSection: () => <div>patient-grid-section</div>,
}));

vi.mock('./billing-kpi-section', () => ({
  BillingKpiSection: () => <div>billing-kpi-section</div>,
}));

describe('DashboardContent', () => {
  it('groups the dashboard into daily operations, workflow navigation, and patient monitoring', () => {
    render(<DashboardContent />);

    expect(screen.getByText('今日の運用')).toBeTruthy();
    expect(screen.getByText('業務導線')).toBeTruthy();
    expect(screen.getByText('患者確認')).toBeTruthy();
    expect(screen.getByText('主要フロー入口')).toBeTruthy();
    expect(
      screen.getByText(
        '開始導線と補助メニューを一つの業務メニューとしてまとめ、入口と支援機能の関係が追いやすい構造にしています。',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('dashboard-priority-actions')).toBeTruthy();
  });
});
