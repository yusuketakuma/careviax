// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { Bell } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DashboardLinkGrid } from './dashboard-link-grid';

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

describe('DashboardLinkGrid', () => {
  it('renders links even when a key has no explicit icon mapping', () => {
    render(
      <DashboardLinkGrid
        links={[
          {
            key: 'known',
            title: '通知',
            description: '通知一覧を開きます。',
            href: '/notifications',
          },
          {
            key: 'unknown',
            title: '提案一覧',
            description: '提案一覧を開きます。',
            href: '/schedules/proposals',
          },
        ]}
        iconMap={{ known: Bell }}
      />,
    );

    expect(screen.getByRole('link', { name: /通知/ }).getAttribute('href')).toBe('/notifications');
    expect(screen.getByRole('link', { name: /提案一覧/ }).getAttribute('href')).toBe(
      '/schedules/proposals',
    );
  });

  it('moves link descriptions into a ? help window', () => {
    render(
      <DashboardLinkGrid
        links={[
          {
            key: 'known',
            title: '通知',
            description: '通知一覧を開きます。',
            href: '/notifications',
          },
        ]}
        iconMap={{ known: Bell }}
      />,
    );

    expect(screen.queryByText('通知一覧を開きます。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '通知の説明' }));
    expect(screen.getByText('通知一覧を開きます。')).toBeTruthy();
  });
});
