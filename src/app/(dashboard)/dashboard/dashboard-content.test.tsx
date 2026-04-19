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

vi.mock('./dashboard-role-guide', () => ({
  DashboardRoleGuide: () => <div>dashboard-role-guide</div>,
}));

vi.mock('./patient-grid-section', () => ({
  PatientGridSection: () => <div>patient-grid-section</div>,
}));

vi.mock('./billing-kpi-section', () => ({
  BillingKpiSection: () => <div>billing-kpi-section</div>,
}));

describe('DashboardContent', () => {
  it('groups the dashboard into daily operations, role guidance, workflow navigation, and patient monitoring', () => {
    render(<DashboardContent />);

    expect(screen.getByText('今日の運用')).toBeTruthy();
    expect(screen.getByText('業務導線')).toBeTruthy();
    expect(screen.getByText('患者確認')).toBeTruthy();
    expect(screen.getByText('職種ごとの初動')).toBeTruthy();
    expect(screen.getByText('主要フロー入口')).toBeTruthy();
    expect(
      screen.getByText(
        '薬剤師、事務スタッフ、全員共通の入口を分け、誰が最初に何を確認するかを揃えて判断できるようにしています。',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('dashboard-priority-actions')).toBeTruthy();
  });
});
