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

describe('DashboardContent', () => {
  it('describes the primary workflow area as a focused first-step section', () => {
    render(<DashboardContent />);

    expect(screen.getByText('主要フロー入口')).toBeTruthy();
    expect(
      screen.getByText(
        '最初に始める入口を3つに絞って上段へ置き、その後の処理フローは一段下で続けてたどれるようにしています。'
      )
    ).toBeTruthy();
    expect(screen.getByTestId('dashboard-priority-actions')).toBeTruthy();
  });
});
