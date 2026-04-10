// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DashboardRoleGuide } from './dashboard-role-guide';

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

describe('DashboardRoleGuide', () => {
  it('surfaces role-based launch points for pharmacists and clerks', () => {
    render(<DashboardRoleGuide focusRole="clerk" />);

    expect(screen.getByText('薬剤師')).toBeTruthy();
    expect(screen.getByText('事務スタッフ')).toBeTruthy();
    expect(screen.getByText('全員共通')).toBeTruthy();
    expect(screen.getByText('現在の担当')).toBeTruthy();
    expect(screen.getByTestId('dashboard-role-guide-active-clerk')).toBeTruthy();

    expect(screen.getAllByRole('link', { name: /My Day/ })[0]?.getAttribute('href')).toBe(
      '/my-day?focus=visits&visit_filter=unprepared&context=dashboard_home',
    );
    expect(screen.getByRole('link', { name: /^調剤$/ }).getAttribute('href')).toBe('/dispensing');
    expect(screen.getByRole('link', { name: /^紹介受付$/ }).getAttribute('href')).toBe(
      '/referrals/new',
    );
    expect(
      screen.getByRole('link', { name: /^依頼・照会$/ }).getAttribute('href'),
    ).toMatch(/^\/communications\/requests/);
  });
});
