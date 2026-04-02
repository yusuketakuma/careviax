// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { AdminNavigation } from './admin-navigation';

setupDomTestEnv();

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

describe('AdminNavigation', () => {
  it('exposes admin dashboard entry points from the home screen', () => {
    render(<AdminNavigation />);

    expect(screen.getByText('管理ダッシュボード').closest('a')?.getAttribute('href')).toBe('/admin');
    expect(screen.getByText('データ探索').closest('a')?.getAttribute('href')).toBe(
      '/admin/data-explorer',
    );
  });
});
