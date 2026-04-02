// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { WorkbenchNavigation } from './workbench-navigation';

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

describe('WorkbenchNavigation', () => {
  it('shows direct links to billing candidates and schedule proposals', () => {
    render(<WorkbenchNavigation />);

    expect(screen.getByText('請求候補').closest('a')?.getAttribute('href')).toBe(
      '/billing/candidates',
    );
    expect(screen.getByText('提案一覧').closest('a')?.getAttribute('href')).toBe(
      '/schedules/proposals',
    );
  });
});
