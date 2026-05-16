// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { FacilityVisitRecordSwitcher } from './facility-visit-record-switcher';

setupDomTestEnv();

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} onClick={(event) => event.preventDefault()} {...props}>
      {children}
    </a>
  ),
}));

const context = {
  label: '青空ホーム',
  siteName: '中央薬局',
  placeKind: 'facility' as const,
  commonNotes: '受付で入館証を受け取る',
  patients: [
    {
      scheduleId: 'schedule_1',
      patientId: 'patient_1',
      patientName: '田中太郎',
      patientNameKana: 'タナカタロウ',
      birthDate: '1940-01-02',
      gender: 'male',
      unitName: '201',
      routeOrder: 1,
      visitRecordId: 'record_1',
      preparationBlockersCount: 0,
    },
    {
      scheduleId: 'schedule_2',
      patientId: 'patient_2',
      patientName: '佐藤花子',
      patientNameKana: 'サトウハナコ',
      birthDate: '1945-03-04',
      gender: 'female',
      unitName: '203',
      routeOrder: 2,
      preparationBlockersCount: 1,
    },
    {
      scheduleId: 'schedule_3',
      patientId: 'patient_3',
      patientName: '鈴木一郎',
      patientNameKana: 'スズキイチロウ',
      birthDate: '1939-05-06',
      gender: 'male',
      unitName: null,
      routeOrder: 3,
      preparationBlockersCount: 0,
    },
  ],
};

describe('FacilityVisitRecordSwitcher', () => {
  it('shows previous and next patient links for facility visits', () => {
    render(<FacilityVisitRecordSwitcher currentScheduleId="schedule_2" context={context} />);

    expect(screen.getByText('青空ホーム')).toBeTruthy();
    expect(screen.getByText('記録済み 1/3')).toBeTruthy();
    expect(screen.getAllByText('準備不足 1').length).toBeGreaterThan(0);
    expect(screen.getByText('受付で入館証を受け取る')).toBeTruthy();
    expect(screen.getByText('佐藤花子')).toBeTruthy();
    expect(
      screen.getAllByText('ID patient_2 / かな サトウハナコ / 1945/3/4 / 女性').length,
    ).toBeGreaterThan(0);
    const previousHref = screen.getByRole('link', { name: /前: 田中太郎/ }).getAttribute('href');
    const nextHref = screen.getByRole('link', { name: /次: 鈴木一郎/ }).getAttribute('href');
    expect(previousHref).toBe('/visits/schedule_1/record');
    expect(nextHref).toBe('/visits/schedule_3/record');
    expect(previousHref).not.toContain('facility_visit_context');
    expect(nextHref).not.toContain('facility_visit_context');
  });

  it('supports swipe navigation by triggering the next patient link', () => {
    render(<FacilityVisitRecordSwitcher currentScheduleId="schedule_2" context={context} />);

    const nextLink = screen.getByRole('link', { name: /次: 鈴木一郎/ });
    const clickSpy = vi.spyOn(nextLink, 'click');
    const switcher = screen.getByTestId('facility-visit-record-switcher');

    fireEvent.touchStart(switcher, { changedTouches: [{ clientX: 220, clientY: 80 }] });
    fireEvent.touchEnd(switcher, { changedTouches: [{ clientX: 80, clientY: 86 }] });

    expect(clickSpy).toHaveBeenCalled();
  });

  it('uses a visit-place label for the switcher landmark', () => {
    render(
      <FacilityVisitRecordSwitcher
        currentScheduleId="schedule_2"
        context={{ ...context, placeKind: 'home_group', label: '山田宅' }}
      />,
    );

    expect(screen.getByLabelText('同一個人宅訪問の患者切替')).toBeTruthy();
  });

  it('does not show stale context when the current schedule is not included', () => {
    render(<FacilityVisitRecordSwitcher currentScheduleId="missing_schedule" context={context} />);

    expect(screen.queryByTestId('facility-visit-record-switcher')).toBeNull();
  });
});
