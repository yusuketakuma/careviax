// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientHistoryQuickLinks } from './patient-history-quick-links';

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

describe('PatientHistoryQuickLinks', () => {
  it('renders patient prescription, visit, and timeline history links as a panel', () => {
    render(<PatientHistoryQuickLinks patientId="patient_1" patientName="山田太郎" />);

    expect(screen.getByRole('heading', { name: '患者の過去歴' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /処方歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1/prescriptions',
    );
    expect(screen.getByRole('link', { name: /訪問歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1?tab=visits',
    );
    expect(screen.getByRole('link', { name: /統合履歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1?tab=timeline',
    );
  });

  it('can render compact inline links without timeline', () => {
    render(
      <PatientHistoryQuickLinks
        patientId="patient_1"
        patientName="山田太郎"
        variant="inline"
        showTimeline={false}
      />,
    );

    expect(screen.getByLabelText('山田太郎の過去歴リンク')).toBeTruthy();
    expect(screen.getByRole('link', { name: '処方歴' }).getAttribute('href')).toBe(
      '/patients/patient_1/prescriptions',
    );
    expect(screen.getByRole('link', { name: '訪問歴' }).getAttribute('href')).toBe(
      '/patients/patient_1?tab=visits',
    );
    expect(screen.queryByRole('link', { name: '統合履歴' })).toBeNull();
  });
});
