// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { VisitSchedule } from '@/app/(dashboard)/schedules/day-view.shared';
import { HomeScheduleScopeSection } from './home-schedule-board-sections';

setupDomTestEnv();

function buildSchedule(overrides?: Partial<VisitSchedule>): VisitSchedule {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'planned',
    carry_items_status: null,
    scheduled_date: '2026-04-10T00:00:00.000Z',
    time_window_start: '2026-04-10T09:00:00.000Z',
    time_window_end: '2026-04-10T10:00:00.000Z',
    pharmacist_id: 'user_1',
    assignment_mode: 'primary',
    route_order: 1,
    facility_batch_id: null,
    confirmed_at: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1' }],
      },
    },
    site: null,
    preparation: null,
    override_request: null,
    applied_override: null,
    facility_hint: null,
    workload_hint: {
      daily_visit_count: 1,
      urgent_visit_count: 0,
    },
    handoff_hint: null,
    ...overrides,
  };
}

describe('HomeScheduleScopeSection', () => {
  it('renders date controls and pharmacy/mine/user scope switching affordances', () => {
    const onDateChange = vi.fn();
    const onVisitScopeChange = vi.fn();
    const onSelectedUserChange = vi.fn();
    const allSchedules = [
      buildSchedule({ id: 'mine', pharmacist_id: 'user_1' }),
      buildSchedule({ id: 'other', pharmacist_id: 'user_2' }),
    ];

    render(
      <HomeScheduleScopeSection
        currentUserId="user_1"
        selectedDate="2026-04-10"
        currentDate="2026-04-10"
        selectedUserId="user_2"
        staffOptions={[
          { id: 'user_1', name: '薬剤師A', siteName: '本店' },
          { id: 'user_2', name: '薬剤師B', siteName: '支店' },
        ]}
        staffSummaries={[
          {
            id: 'user_1',
            name: '薬剤師A',
            siteName: '本店',
            totalVisits: 1,
            preparationPending: 1,
            timingGaps: 0,
            inProgress: 0,
          },
          {
            id: 'user_2',
            name: '薬剤師B',
            siteName: '支店',
            totalVisits: 1,
            preparationPending: 1,
            timingGaps: 0,
            inProgress: 0,
          },
        ]}
        visitScope="user"
        allSchedules={allSchedules}
        scopedSchedules={[allSchedules[1] as VisitSchedule]}
        onDateChange={onDateChange}
        onVisitScopeChange={onVisitScopeChange}
        onSelectedUserChange={onSelectedUserChange}
        staffLoading={false}
        staffError={false}
      />,
    );

    expect(screen.getByText('4月10日(金)')).toBeTruthy();
    expect(screen.getByText('今日の予定を表示中')).toBeTruthy();
    expect(screen.getByRole('button', { name: /薬局全体/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /自分/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /スタッフ指定/ })).toBeTruthy();
    expect(screen.getByText('4月10日(金) の 薬剤師B 担当 1 件を表示しています。')).toBeTruthy();
    expect(screen.getAllByText('準備 1')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '翌日の予定' }));
    expect(onDateChange).toHaveBeenCalledWith('2026-04-11');

    fireEvent.click(screen.getByRole('button', { name: /自分/ }));
    expect(onVisitScopeChange).toHaveBeenCalledWith('mine');

    fireEvent.change(screen.getByLabelText('表示日'), { target: { value: '2026-04-12' } });
    expect(onDateChange).toHaveBeenCalledWith('2026-04-12');
  });
});
