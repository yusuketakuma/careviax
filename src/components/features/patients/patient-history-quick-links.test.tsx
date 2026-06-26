// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientHref } from '@/lib/patient/navigation';
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

// Actual-backed spy: real encode/guard output for the existing + hostile tests,
// plus return-value delegation teeth for the three history links.
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

describe('PatientHistoryQuickLinks', () => {
  it('renders patient prescription, visit, and timeline history links as a panel', () => {
    render(<PatientHistoryQuickLinks patientId="patient_1" patientName="山田太郎" />);

    expect(screen.getByRole('heading', { name: '患者の過去歴' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /処方歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1/prescriptions',
    );
    expect(screen.getByRole('link', { name: /訪問歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1#card-recent-activities',
    );
    expect(screen.getByRole('link', { name: /統合履歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1#card-recent-activities',
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
    expect(screen.getByRole('link', { name: '処方歴' }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('link', { name: '処方歴' }).className).not.toContain('sm:min-h-7');
    expect(screen.getByRole('link', { name: '訪問歴' }).getAttribute('href')).toBe(
      '/patients/patient_1#card-recent-activities',
    );
    expect(screen.queryByRole('link', { name: '統合履歴' })).toBeNull();
  });

  describe('shared href helper convergence (F-042)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('all three history links consume the shared buildPatientHref return value (panel)', () => {
      const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
      vi.mocked(buildPatientHref).mockImplementation(
        (id: string, suffix = '') => `/patients/__sentinel_${id}__${suffix}`,
      );
      try {
        render(<PatientHistoryQuickLinks patientId="patient_1" patientName="山田太郎" />);

        expect(screen.getByRole('link', { name: /処方歴/ }).getAttribute('href')).toBe(
          '/patients/__sentinel_patient_1__/prescriptions',
        );
        expect(screen.getByRole('link', { name: /訪問歴/ }).getAttribute('href')).toBe(
          '/patients/__sentinel_patient_1__#card-recent-activities',
        );
        expect(screen.getByRole('link', { name: /統合履歴/ }).getAttribute('href')).toBe(
          '/patients/__sentinel_patient_1__#card-recent-activities',
        );
        // both visits + timeline must go through the helper (not a shared local raw href)
        expect(vi.mocked(buildPatientHref).mock.calls).toEqual([
          ['patient_1', '/prescriptions'],
          ['patient_1', '#card-recent-activities'],
          ['patient_1', '#card-recent-activities'],
        ]);
      } finally {
        if (realImpl) {
          vi.mocked(buildPatientHref).mockImplementation(realImpl);
        }
      }
    });

    it('encodes a hostile patient id as a single path segment in all history links', () => {
      const hostilePatientId = 'pt/1?tab=x#frag';
      render(<PatientHistoryQuickLinks patientId={hostilePatientId} patientName="山田太郎" />);

      const encoded = encodeURIComponent(hostilePatientId);
      expect(screen.getByRole('link', { name: /処方歴/ }).getAttribute('href')).toBe(
        `/patients/${encoded}/prescriptions`,
      );
      expect(screen.getByRole('link', { name: /訪問歴/ }).getAttribute('href')).toBe(
        `/patients/${encoded}#card-recent-activities`,
      );
      expect(screen.getByRole('link', { name: /統合履歴/ }).getAttribute('href')).toBe(
        `/patients/${encoded}#card-recent-activities`,
      );
      for (const name of [/処方歴/, /訪問歴/, /統合履歴/]) {
        const href = screen.getByRole('link', { name }).getAttribute('href') ?? '';
        expect(href).not.toContain('pt/1');
        expect(href).not.toContain('?tab=');
      }
    });

    it('inline without timeline delegates only the two non-timeline links', () => {
      render(
        <PatientHistoryQuickLinks
          patientId="patient_1"
          patientName="山田太郎"
          variant="inline"
          showTimeline={false}
        />,
      );
      expect(vi.mocked(buildPatientHref).mock.calls).toEqual([
        ['patient_1', '/prescriptions'],
        ['patient_1', '#card-recent-activities'],
      ]);
    });
  });
});
