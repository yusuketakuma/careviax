// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { CoordinationNavigation } from './coordination-navigation';

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

describe('CoordinationNavigation', () => {
  it('prioritizes clerk coordination entry points around communications', () => {
    render(<CoordinationNavigation focusRole="clerk" />);

    const cluster = screen.getByTestId('dashboard-coordination-clerk');
    const links = cluster.querySelectorAll('a');

    expect(links).toHaveLength(4);
    expect(links[0]?.getAttribute('href')).toBe('/communications/requests?status=sent&context=dashboard_home');
    expect(links[1]?.getAttribute('href')).toBe('/notifications?type=urgent&context=dashboard_home');
    expect(links[2]?.getAttribute('href')).toBe('/handoff?filter=unread&context=dashboard_home');
  });

  it('prioritizes pharmacist coordination around handoff and alerts', () => {
    render(<CoordinationNavigation focusRole="pharmacist" />);

    const cluster = screen.getByTestId('dashboard-coordination-pharmacist');
    const links = cluster.querySelectorAll('a');

    expect(links).toHaveLength(4);
    expect(links[0]?.getAttribute('href')).toBe('/handoff?filter=unread&context=dashboard_home');
    expect(links[1]?.getAttribute('href')).toBe('/notifications?type=urgent&context=dashboard_home');
    expect(links[2]?.getAttribute('href')).toBe('/communications/requests?status=sent&context=dashboard_home');
  });
});
