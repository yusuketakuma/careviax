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
  it('shows clerk-oriented launch points in the primary rail', () => {
    render(<WorkflowNavigation focusRole="clerk" />);

    expect(screen.queryByText('薬剤師が最初に開く導線')).toBeNull();
    expect(screen.getByText('事務スタッフが最初に開く導線')).toBeTruthy();
    expect(screen.getByText('続きの受付・連携フロー')).toBeTruthy();
    expect(screen.getByRole('link', { name: /紹介受付/ }).getAttribute('href')).toBe(
      '/referrals/new',
    );
    expect(screen.getByRole('link', { name: /QR下書き/ }).getAttribute('href')).toBe(
      '/prescriptions/qr-drafts',
    );
    expect(screen.getByRole('link', { name: /訪問スケジュール設定/ }).getAttribute('href')).toBe(
      '/schedules',
    );
    expect(screen.getByRole('link', { name: /報告書作成/ }).getAttribute('href')).toBe(
      '/reports?focus=delivery&delivery_status=response_waiting&context=dashboard_home',
    );
    expect(screen.getByRole('link', { name: /他職種連携/ }).getAttribute('href')).toBe(
      '/conferences?focus=notes&context=dashboard_home',
    );

    const primaryRail = screen.getByTestId('dashboard-workflow-primary-clerk');
    const primaryLinks = primaryRail.querySelectorAll('a');
    expect(primaryLinks).toHaveLength(4);
    expect(primaryLinks[0]?.getAttribute('href')).toBe('/referrals/new');
    expect(primaryLinks[1]?.getAttribute('href')).toBe('/prescriptions');
    expect(primaryLinks[2]?.getAttribute('href')).toBe('/prescriptions/qr-drafts');
    expect(primaryLinks[3]?.getAttribute('href')).toBe('/schedules');
  });

  it('moves pharmacist launch points to the head of the rail', () => {
    render(<WorkflowNavigation focusRole="pharmacist" />);

    expect(screen.getByText('薬剤師が最初に開く導線')).toBeTruthy();
    expect(screen.getByText('続きの工程と支援フロー')).toBeTruthy();

    const primaryRail = screen.getByTestId('dashboard-workflow-primary-pharmacist');
    const primaryLinks = primaryRail.querySelectorAll('a');
    expect(primaryLinks).toHaveLength(4);
    expect(primaryLinks[0]?.getAttribute('href')).toBe('/dispensing');
    expect(primaryLinks[1]?.getAttribute('href')).toBe('/auditing');
    expect(primaryLinks[2]?.getAttribute('href')).toBe('/visits');
    expect(primaryLinks[3]?.getAttribute('href')).toBe(
      '/reports?focus=delivery&delivery_status=response_waiting&context=dashboard_home',
    );
  });
});
