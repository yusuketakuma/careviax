// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('./pharmacy-cooperation-setup-content', () => ({
  PharmacyCooperationSetupContent: () => <section data-testid="pharmacy-cooperation-setup" />,
}));

import PharmacyCooperationSetupPage from './page';

setupDomTestEnv();

describe('PharmacyCooperationSetupPage', () => {
  it('uses the shared admin header while preserving setup context and related links', () => {
    render(<PharmacyCooperationSetupPage />);

    expect(screen.getByRole('heading', { level: 1, name: '薬局間協力設定' })).toBeTruthy();
    expect(screen.getByText('設定順序')).toBeTruthy();
    expect(
      screen.getByText('協力薬局を登録し、基準薬局との連携を有効化してから契約を作成します。'),
    ).toBeTruthy();

    expect(screen.getByRole('link', { name: /マスターへ戻る/ }).getAttribute('href')).toBe(
      '/admin',
    );
    expect(screen.getByRole('link', { name: '協力ワークフロー' }).getAttribute('href')).toBe(
      '/workflow/pharmacy-cooperation',
    );
    expect(screen.getByRole('link', { name: '月次請求' }).getAttribute('href')).toBe(
      '/billing/partner-cooperation',
    );
    expect(screen.getByRole('link', { name: '薬局情報' }).getAttribute('href')).toBe(
      '/admin/pharmacy-sites',
    );
    expect(screen.getByTestId('pharmacy-cooperation-setup')).toBeTruthy();
  });
});
