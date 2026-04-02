// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { MobileNav } from './mobile-nav';

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
    toggleSidebar: vi.fn(),
  }),
}));

describe('MobileNav', () => {
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
