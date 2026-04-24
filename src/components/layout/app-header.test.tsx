// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { AppHeader } from './app-header';

setupDomTestEnv();

let mockPathname = '/dashboard';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

vi.mock('@/lib/stores/ui-store', () => ({
  useUIStore: () => ({
    setSidebarOpen: vi.fn(),
  }),
}));

vi.mock('@/components/features/notifications/notification-bell', () => ({
  NotificationBell: () => <button type="button">通知</button>,
}));

describe('AppHeader', () => {
  it('shows top workflow shortcuts for high-frequency work', () => {
    mockPathname = '/visits/schedule_1/record';
    render(<AppHeader />);

    const nav = screen.getByRole('navigation', { name: 'トップ業務メニュー' });
    const links = within(nav).getAllByRole('link');

    expect(links.map((link) => link.textContent)).toEqual([
      '業務本流',
      'スケジュール',
      '訪問時',
      '報告書',
    ]);
    expect(within(nav).getByRole('link', { name: '訪問時' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('highlights report pages in the top workflow shortcuts', () => {
    mockPathname = '/reports/report_1';
    render(<AppHeader />);

    const nav = screen.getByRole('navigation', { name: 'トップ業務メニュー' });
    expect(within(nav).getByRole('link', { name: '報告書' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});
