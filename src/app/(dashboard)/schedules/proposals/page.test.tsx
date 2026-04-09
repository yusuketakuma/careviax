// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import ScheduleProposalsPage from './page';

setupDomTestEnv();

const dashboardMock = vi.hoisted(() => vi.fn(() => <div>dashboard-workspace</div>));
const optimizerMock = vi.hoisted(() => vi.fn(() => <div>optimizer-workspace</div>));

vi.mock('./schedule-proposals-content', () => ({
  ScheduleProposalsContent: dashboardMock,
}));

vi.mock('./schedule-weekly-optimizer', () => ({
  ScheduleWeeklyOptimizer: optimizerMock,
}));

vi.mock('./schedule-proposal-workspace-tabs', () => ({
  ScheduleProposalWorkspaceTabs: () => <div>workspace-tabs</div>,
}));

vi.mock('@/components/features/workflow/workflow-page-intro', () => ({
  WorkflowPageIntro: () => <div>intro</div>,
}));

vi.mock('@/components/features/workflow/workflow-phase-panel', () => ({
  WorkflowPhasePanel: () => <div>phase-panel</div>,
}));

vi.mock('@/components/layout/page-scaffold', () => ({
  PageScaffold: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('ScheduleProposalsPage', () => {
  it('renders the dashboard workspace when workspace is omitted', async () => {
    render(
      await ScheduleProposalsPage({
        searchParams: Promise.resolve({
          case_id: 'case_1',
          date_from: '2026-04-09',
        }),
      })
    );

    expect(screen.getByText('dashboard-workspace')).toBeTruthy();
    expect(dashboardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialCaseId: 'case_1',
        initialDateFrom: '2026-04-09',
      }),
      undefined
    );
  });

  it('renders the optimizer workspace when requested by search params', async () => {
    render(
      await ScheduleProposalsPage({
        searchParams: Promise.resolve({
          workspace: 'optimizer',
          week: '2026-04-14',
          optimizer_case_id: 'case_2',
          optimizer_visit_type: 'emergency',
          optimizer_priority: 'urgent',
          optimizer_travel_mode: 'WALK',
          optimizer_time_from: '10:00',
          optimizer_time_to: '15:00',
          optimizer_pharmacist_id: 'pharmacist_3',
          optimizer_date: '2026-04-16',
        }),
      })
    );

    expect(screen.getByText('optimizer-workspace')).toBeTruthy();
    expect(optimizerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialDate: '2026-04-14',
        initialCaseId: 'case_2',
        initialVisitType: 'emergency',
        initialPriority: 'urgent',
        initialTravelMode: 'WALK',
        initialPreferredTimeFrom: '10:00',
        initialPreferredTimeTo: '15:00',
        initialRoutePharmacistId: 'pharmacist_3',
        initialRouteDate: '2026-04-16',
      }),
      undefined
    );
  });
});
