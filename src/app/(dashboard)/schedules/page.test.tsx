// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const scheduleTeamBoardMock = vi.hoisted(() => vi.fn());
const calendarViewMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./schedule-team-board', () => ({
  ScheduleTeamBoard: (props: { initialDate?: string; activeView: string }) => {
    scheduleTeamBoardMock(props);
    return <section data-testid="schedule-team-board" />;
  },
}));

vi.mock('./calendar-view', () => ({
  CalendarView: () => {
    if (calendarViewMockState.suspend) {
      throw calendarViewMockState.promise;
    }
    return <section data-testid="calendar-view" />;
  },
}));

import SchedulesPage from './page';

setupDomTestEnv();

describe('SchedulesPage', () => {
  beforeEach(() => {
    scheduleTeamBoardMock.mockClear();
    calendarViewMockState.suspend = false;
  });

  async function renderPage() {
    const page = await SchedulesPage({
      searchParams: Promise.resolve({ view: 'calendar', date: '2026-07-04' }),
    });
    return render(page);
  }

  it('renders the schedule board and calendar with search params', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { name: '訪問予定' })).toBeTruthy();
    expect(screen.getByTestId('schedule-team-board')).toBeTruthy();
    expect(screen.getByTestId('calendar-view')).toBeTruthy();
    expect(scheduleTeamBoardMock).toHaveBeenCalledWith(
      expect.objectContaining({ activeView: 'calendar', initialDate: '2026-07-04' }),
    );
  });

  it('uses a screen-specific loading status for the calendar fallback', async () => {
    calendarViewMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('heading', { name: '訪問予定' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '訪問カレンダーを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('calendar-view')).toBeNull();
  });
});
