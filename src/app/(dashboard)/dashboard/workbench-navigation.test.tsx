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
    render(<WorkbenchNavigation focusRole="common" />);

    expect(screen.getByText('請求候補').closest('a')?.getAttribute('href')).toBe(
      '/billing/candidates',
    );
    expect(screen.getByText('提案一覧').closest('a')?.getAttribute('href')).toBe(
      '/schedules/proposals',
    );
  });

  it('moves clerk workbench entry points to the head of the cluster', () => {
    render(<WorkbenchNavigation focusRole="clerk" />);

    const cluster = screen.getByTestId('dashboard-workbench-clerk');
    const links = cluster.querySelectorAll('a');

    expect(links).toHaveLength(6);
    expect(links[0]?.getAttribute('href')).toBe('/schedules/proposals');
    expect(links[1]?.getAttribute('href')).toBe('/tasks?assigned=me&status=pending&context=dashboard_home');
    expect(links[2]?.getAttribute('href')).toBe(
      '/my-day?focus=visits&visit_filter=unprepared&context=dashboard_home',
    );
  });

  it('keeps pharmacist workbench focused on personal execution first', () => {
    render(<WorkbenchNavigation focusRole="pharmacist" />);

    const cluster = screen.getByTestId('dashboard-workbench-pharmacist');
    const links = cluster.querySelectorAll('a');

    expect(links).toHaveLength(6);
    expect(links[0]?.getAttribute('href')).toBe(
      '/my-day?focus=visits&visit_filter=unprepared&context=dashboard_home',
    );
    expect(links[1]?.getAttribute('href')).toBe('/tasks?assigned=me&status=pending&context=dashboard_home');
    expect(links[2]?.getAttribute('href')).toBe('/workflow?focus=control_center&context=dashboard_home');
  });
});
