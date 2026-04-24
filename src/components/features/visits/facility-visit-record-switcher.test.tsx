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
  patients: [
    { scheduleId: 'schedule_1', patientName: '田中太郎', unitName: '201', routeOrder: 1 },
    { scheduleId: 'schedule_2', patientName: '佐藤花子', unitName: '203', routeOrder: 2 },
    { scheduleId: 'schedule_3', patientName: '鈴木一郎', unitName: null, routeOrder: 3 },
  ],
};

describe('FacilityVisitRecordSwitcher', () => {
  it('shows previous and next patient links for facility visits', () => {
    render(<FacilityVisitRecordSwitcher currentScheduleId="schedule_2" context={context} />);

    expect(screen.getByText('青空ホーム')).toBeTruthy();
    expect(screen.getByText('佐藤花子')).toBeTruthy();
    expect(screen.getByRole('link', { name: /前: 田中太郎/ }).getAttribute('href')).toContain(
      '/visits/schedule_1/record?',
    );
    expect(screen.getByRole('link', { name: /次: 鈴木一郎/ }).getAttribute('href')).toContain(
      '/visits/schedule_3/record?',
    );
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

  it('does not show stale context when the current schedule is not included', () => {
    render(<FacilityVisitRecordSwitcher currentScheduleId="missing_schedule" context={context} />);

    expect(screen.queryByTestId('facility-visit-record-switcher')).toBeNull();
  });
});
