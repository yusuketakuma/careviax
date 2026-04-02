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
  it('shows newly exposed referral and qr draft entry points', () => {
    render(<WorkflowNavigation />);

    expect(screen.getByRole('link', { name: /紹介受付/ }).getAttribute('href')).toBe(
      '/referrals/new',
    );
    expect(screen.getByRole('link', { name: /QR下書き/ }).getAttribute('href')).toBe(
      '/prescriptions/qr-drafts',
    );
  });
});
