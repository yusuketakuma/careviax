// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { Sidebar } from './sidebar';

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
    sidebarOpen: true,
    sidebarPinned: true,
    toggleSidebar: vi.fn(),
    toggleSidebarPinned: vi.fn(),
  }),
}));

describe('Sidebar', () => {
  it('treats prescription list, form, and QR drafts as the same nav group', () => {
    for (const pathname of ['/prescriptions', '/prescriptions/new', '/prescriptions/qr-drafts']) {
      mockPathname = pathname;
      const { unmount } = render(<Sidebar />);

      const prescriptionsLink = screen.getByRole('link', { name: '処方受付' });
      expect(prescriptionsLink.getAttribute('href')).toEqual('/prescriptions');
      expect(prescriptionsLink.getAttribute('aria-current')).toEqual('page');

      unmount();
    }
  });

  it('keeps handoff detail routes in the handoff nav group instead of visits', () => {
    mockPathname = '/visits/handoffs/visit-record-1';
    render(<Sidebar />);

    expect(
      screen.getByRole('link', { name: '申し送り' }).getAttribute('aria-current')
    ).toEqual('page');
    expect(screen.getByRole('link', { name: '訪問' }).getAttribute('aria-current')).toBeNull();
  });

  it('surfaces and activates the admin dashboard entry inside the admin group', () => {
    mockPathname = '/admin';
    render(<Sidebar />);

    const workbenchAdminLink = screen.getByRole('link', { name: '管理' });
    expect(workbenchAdminLink.getAttribute('href')).toEqual('/admin');
    expect(workbenchAdminLink.getAttribute('aria-current')).toEqual('page');

    const adminDashboardLink = screen
      .getAllByRole('link', { name: '管理ダッシュボード' })
      .find((link) => link.getAttribute('href') === '/admin' && link.getAttribute('aria-current') === 'page');

    expect(adminDashboardLink).toBeDefined();
    if (!adminDashboardLink) {
      throw new Error('管理ダッシュボードリンクが見つかりません');
    }
    expect(adminDashboardLink.getAttribute('href')).toEqual('/admin');
    expect(adminDashboardLink.getAttribute('aria-current')).toEqual('page');
  });
});
