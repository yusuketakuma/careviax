// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { Sidebar } from './sidebar';

setupDomTestEnv();

let mockPathname = '/dashboard';
let mockSidebarPinned = false;
const mockSetSidebarOpen = vi.fn();

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
    sidebarPinned: mockSidebarPinned,
    setSidebarOpen: mockSetSidebarOpen,
    toggleSidebar: vi.fn(),
    toggleSidebarPinned: vi.fn(),
  }),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    mockPathname = '/dashboard';
    mockSidebarPinned = false;
    mockSetSidebarOpen.mockClear();
  });

  it('closes the compact sidebar sheet after a navigation click', () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('link', { name: '患者' }));

    expect(mockSetSidebarOpen).toHaveBeenCalledWith(false);
  });

  it('keeps the pinned desktop sidebar open after a navigation click by default', () => {
    mockSidebarPinned = true;
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('link', { name: '患者' }));

    expect(mockSetSidebarOpen).not.toHaveBeenCalled();
  });

  it('closes the overlay sidebar after navigation even when the desktop sidebar is pinned', () => {
    mockSidebarPinned = true;
    render(<Sidebar closeOnNavigate />);

    fireEvent.click(screen.getByRole('link', { name: '患者' }));

    expect(mockSetSidebarOpen).toHaveBeenCalledWith(false);
  });

  it('treats prescription list, form, and QR drafts as the same nav group', () => {
    for (const pathname of ['/prescriptions', '/prescriptions/new', '/prescriptions/qr-drafts']) {
      mockPathname = pathname;
      const { unmount } = render(<Sidebar />);

      const prescriptionsLink = screen.getByRole('link', { name: '処方登録' });
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
    expect(screen.getByRole('link', { name: '訪問時' }).getAttribute('aria-current')).toBeNull();
  });

  it('shows the main business route before support links in fixed order', () => {
    mockPathname = '/dashboard';
    render(<Sidebar />);

    expect(screen.getByText('主業務ルート')).toBeTruthy();
    expect(screen.getByText('補助導線')).toBeTruthy();

    const routeLabels = [
      '処方登録',
      '調剤',
      '調剤監査',
      'セット',
      'セット監査',
      'スケジュール',
      '訪問時',
      '報告書',
    ];
    const links = routeLabels.map((label) => screen.getByRole('link', { name: label }));

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/prescriptions',
      '/dispensing',
      '/auditing',
      '/medication-sets',
      '/medication-sets',
      '/schedules',
      '/visits',
      '/reports',
    ]);
  });

  it('separates set management and set audit active states', () => {
    mockPathname = '/medication-sets/audit/plan_1';
    render(<Sidebar />);

    expect(screen.getByRole('link', { name: 'セット監査' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'セット' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps communication requests in the support navigation group', () => {
    mockPathname = '/communications/requests';
    render(<Sidebar />);

    const communicationLink = screen.getByRole('link', { name: '依頼・照会' });
    expect(communicationLink.getAttribute('href')).toBe('/communications/requests');
    expect(communicationLink.getAttribute('aria-current')).toBe('page');
  });

  it('keeps workflow as a primary navigation entry', () => {
    mockPathname = '/workflow';
    render(<Sidebar />);

    const workflowLink = screen.getByRole('link', { name: 'ワークフロー' });
    expect(workflowLink.getAttribute('href')).toBe('/workflow');
    expect(workflowLink.getAttribute('aria-current')).toBe('page');
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
