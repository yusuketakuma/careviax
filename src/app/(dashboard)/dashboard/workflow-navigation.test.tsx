// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { WorkflowNavigation } from './workflow-navigation';

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

describe('WorkflowNavigation', () => {
  it('shows the main workflow in the requested fixed order', () => {
    render(<WorkflowNavigation />);

    expect(screen.getByText('固定順のメイン導線')).toBeTruthy();
    expect(
      screen.getByText('処方登録から報告書まで、主業務フローを固定の 8 ステップで並べています。'),
    ).toBeTruthy();

    const routeRail = screen.getByTestId('dashboard-main-workflow-route');
    const routeLinks = routeRail.querySelectorAll('a');
    expect(routeLinks).toHaveLength(8);
    expect(routeLinks[0]?.getAttribute('href')).toBe('/prescriptions');
    expect(routeLinks[1]?.getAttribute('href')).toBe('/dispensing');
    expect(routeLinks[2]?.getAttribute('href')).toBe('/auditing');
    expect(routeLinks[3]?.getAttribute('href')).toBe('/medication-sets');
    expect(routeLinks[4]?.getAttribute('href')).toBe('/medication-sets');
    expect(routeLinks[5]?.getAttribute('href')).toBe('/schedules');
    expect(routeLinks[6]?.getAttribute('href')).toBe('/visits');
    expect(routeLinks[7]?.getAttribute('href')).toBe('/reports');

    expect(screen.getByRole('link', { name: /処方受付/ }).getAttribute('href')).toBe(
      '/prescriptions',
    );
    expect(screen.getByRole('link', { name: /調剤監査/ }).getAttribute('href')).toBe('/auditing');
    expect(screen.getByRole('link', { name: /セット監査/ }).getAttribute('href')).toBe(
      '/medication-sets',
    );
    expect(screen.getByRole('link', { name: /訪問スケジュール/ }).getAttribute('href')).toBe(
      '/schedules',
    );
    expect(screen.getByRole('link', { name: /報告書一覧/ }).getAttribute('href')).toBe('/reports');
  });
});
