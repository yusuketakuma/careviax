// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { Sidebar } from './sidebar';
import type { NavBadgeCounts } from './use-nav-badges';

setupDomTestEnv();

let mockPathname = '/dashboard';
let mockSidebarPinned = false;
let mockNavBadges: NavBadgeCounts = {};
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

vi.mock('./use-nav-badges', () => ({
  useNavBadges: () => mockNavBadges,
}));

describe('Sidebar', () => {
  beforeEach(() => {
    mockPathname = '/dashboard';
    mockSidebarPinned = false;
    mockNavBadges = {};
    mockSetSidebarOpen.mockClear();
  });

  it('closes the compact sidebar sheet after a navigation click', () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('link', { name: 'スケジュール' }));

    expect(mockSetSidebarOpen).toHaveBeenCalledWith(false);
  });

  it('keeps the pinned desktop sidebar open after a navigation click by default', () => {
    mockSidebarPinned = true;
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('link', { name: 'スケジュール' }));

    expect(mockSetSidebarOpen).not.toHaveBeenCalled();
  });

  it('closes the overlay sidebar after navigation even when the desktop sidebar is pinned', () => {
    mockSidebarPinned = true;
    render(<Sidebar closeOnNavigate />);

    fireEvent.click(screen.getByRole('link', { name: 'スケジュール' }));

    expect(mockSetSidebarOpen).toHaveBeenCalledWith(false);
  });

  it('shows the design/images/new grouped menu with headings in fixed order', () => {
    render(<Sidebar />);

    for (const heading of ['今日', '患者', '工程', '連携', '管理']) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
    // 日本語見出しなので uppercase は適用しない
    expect(screen.getByText('今日').className).not.toContain('uppercase');

    const labels = [
      'ダッシュボード',
      'スケジュール',
      '訪問',
      '患者一覧',
      '処方取込',
      'カード',
      '調剤',
      '監査',
      'セット',
      '報告・共有',
      '算定チェック',
      'ハンドオフ',
      'マスター',
      '設定',
    ];
    const links = labels.map((label) => screen.getByRole('link', { name: label }));

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/dashboard',
      '/schedules',
      '/visits',
      '/patients',
      '/prescriptions/intake',
      '/prescriptions',
      '/dispense',
      '/auditing',
      '/medication-sets',
      '/reports',
      '/billing',
      '/handoff',
      '/admin',
      '/settings',
    ]);
  });

  it('keeps the dashboard item active for workflow and notification pages', () => {
    for (const pathname of ['/workflow', '/notifications']) {
      mockPathname = pathname;
      const { unmount } = render(<Sidebar />);

      expect(
        screen.getByRole('link', { name: 'ダッシュボード' }).getAttribute('aria-current'),
      ).toEqual('page');

      unmount();
    }
  });

  it('activates 患者一覧 on the list page and カード on patient detail pages', () => {
    mockPathname = '/patients';
    const { unmount } = render(<Sidebar />);

    expect(screen.getByRole('link', { name: '患者一覧' }).getAttribute('aria-current')).toEqual(
      'page',
    );
    expect(screen.getByRole('link', { name: 'カード' }).getAttribute('aria-current')).toBeNull();
    unmount();

    mockPathname = '/patients/patient_1';
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: 'カード' }).getAttribute('aria-current')).toEqual(
      'page',
    );
    expect(screen.getByRole('link', { name: '患者一覧' }).getAttribute('aria-current')).toBeNull();
  });

  it('separates prescription intake from the card item', () => {
    mockPathname = '/prescriptions/new';
    const { unmount } = render(<Sidebar />);

    expect(screen.getByRole('link', { name: '処方取込' }).getAttribute('aria-current')).toEqual(
      'page',
    );
    expect(screen.getByRole('link', { name: 'カード' }).getAttribute('aria-current')).toBeNull();
    unmount();

    mockPathname = '/qr-scan';
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: '処方取込' }).getAttribute('aria-current')).toEqual(
      'page',
    );
  });

  it('keeps communication requests inside the handoff nav item', () => {
    mockPathname = '/communications/requests';
    render(<Sidebar />);

    expect(screen.getByRole('link', { name: 'ハンドオフ' }).getAttribute('aria-current')).toEqual(
      'page',
    );
  });

  it('exposes stable nav test ids used by browser smoke tests', () => {
    render(<Sidebar />);

    expect(screen.getByTestId('sidebar-nav-home').getAttribute('href')).toBe('/dashboard');
    expect(screen.getByTestId('sidebar-nav-patients').getAttribute('href')).toBe('/patients');
    expect(screen.getByTestId('sidebar-nav-dispense').getAttribute('href')).toBe('/dispense');
  });

  it('keeps admin analytics pages active under マスター after the report item removal', () => {
    mockPathname = '/admin/analytics';
    render(<Sidebar />);

    expect(screen.queryByRole('link', { name: 'レポート' })).toBeNull();
    expect(screen.getByRole('link', { name: 'マスター' }).getAttribute('aria-current')).toEqual(
      'page',
    );
  });

  it('renders dynamic badges for auditing (red) and handoff (amber)', () => {
    mockNavBadges = { '/auditing': 6, '/handoff': 3 };
    render(<Sidebar />);

    const auditingBadge = screen.getByTestId('sidebar-nav-badge--auditing');
    expect(auditingBadge.textContent).toBe('6');
    expect(auditingBadge.className).toContain('bg-red-500');

    const handoffBadge = screen.getByTestId('sidebar-nav-badge--handoff');
    expect(handoffBadge.textContent).toBe('3');
    expect(handoffBadge.className).toContain('bg-amber-500');
  });

  it('hides the badge on the active item', () => {
    mockNavBadges = { '/auditing': 6, '/handoff': 3 };
    mockPathname = '/auditing';
    render(<Sidebar />);

    expect(screen.queryByTestId('sidebar-nav-badge--auditing')).toBeNull();
    expect(screen.getByTestId('sidebar-nav-badge--handoff')).toBeTruthy();
  });

  it('hides badges entirely when counts are unavailable', () => {
    mockNavBadges = {};
    render(<Sidebar />);

    expect(screen.queryByTestId('sidebar-nav-badge--auditing')).toBeNull();
    expect(screen.queryByTestId('sidebar-nav-badge--handoff')).toBeNull();
  });
});
