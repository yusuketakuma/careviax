// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { MobileNav } from './mobile-nav';

setupDomTestEnv();

let mockPathname = '/dashboard';
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
    setSidebarOpen: mockSetSidebarOpen,
    toggleSidebar: vi.fn(),
  }),
}));

describe('MobileNav', () => {
  beforeEach(() => {
    mockSetSidebarOpen.mockClear();
  });

  it('closes the sidebar drawer when a bottom navigation link is used', () => {
    render(<MobileNav />);

    fireEvent.click(screen.getByRole('link', { name: '患者' }));

    expect(mockSetSidebarOpen).toHaveBeenCalledWith(false);
  });

  it('keeps a direct dashboard entry in the bottom navigation', () => {
    render(<MobileNav />);

    expect(screen.getByRole('link', { name: 'ホーム' }).getAttribute('href')).toBe('/dashboard');
  });

  it('does not mark handoff detail routes as the visits tab', () => {
    mockPathname = '/visits/handoffs/visit-record-1';
    render(<MobileNav />);

    expect(screen.getByRole('link', { name: '本日の訪問' }).getAttribute('aria-current')).toBeNull();
  });
});
