// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useSearchParamsMock = vi.hoisted(() => vi.fn(() => new URLSearchParams('foo=bar')));

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { ScheduleViewToggle } from './schedule-view-toggle';

setupDomTestEnv();

describe('ScheduleViewToggle', () => {
  it('renders dashboard button mode when onChange is provided', () => {
    const onChange = vi.fn();

    render(<ScheduleViewToggle activeView="list" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'カレンダー' }));
    expect(onChange).toHaveBeenCalledWith('calendar');
  });

  it('renders schedules page link mode when onChange is omitted', () => {
    render(<ScheduleViewToggle activeView="calendar" />);

    expect(screen.getByRole('link', { name: 'リスト' }).getAttribute('href')).toBe(
      '/schedules?foo=bar&view=list'
    );
    expect(screen.getByRole('link', { name: 'カレンダー' }).getAttribute('href')).toBe(
      '/schedules?foo=bar&view=calendar'
    );
  });
});
