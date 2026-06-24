// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientHref } from '@/lib/patient/navigation';
import { PatientMcsLinkCard } from './patient-mcs-link-card';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

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

// Actual-backed spy: real encode/guard output for the hostile id assertion, plus
// return-value delegation teeth for the MCS link.
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

describe('PatientMcsLinkCard', () => {
  it('renders MCS linkage status with a semantic section heading', () => {
    const patientId = '../settings?x=1#frag';
    const encodedPatientId = encodeURIComponent(patientId);

    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        link: null,
        summary: null,
        isRestricted: false,
      },
      isError: false,
    });

    render(<PatientMcsLinkCard patientId={patientId} />);

    expect(screen.getByRole('heading', { level: 2, name: 'MCS 連携' }).tagName).toBe('H2');
    expect(screen.getByText('患者別タイムラインを保存済みデータとして利用')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'MCS 連携ページを開く' });
    const href = link.getAttribute('href') ?? '';
    expect(href).toBe(`/patients/${encodedPatientId}/mcs`);
    expect(href).not.toContain(patientId);
    expect(href).not.toContain('?x=1');
    expect(href).not.toContain('#frag');
    // raw id passed to the helper (not pre-encoded) -> no double-encode.
    expect(href).not.toContain('%25');
  });

  function openLinkData() {
    return { link: null, summary: null, isRestricted: false };
  }

  it('routes the MCS link through buildPatientHref return value', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: openLinkData(), isError: false });

    const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockImplementation(
      (id: string, suffix = '') => `/patients/__s_${id}__${suffix}`,
    );
    vi.mocked(buildPatientHref).mockClear();
    try {
      render(<PatientMcsLinkCard patientId="patient_1" />);

      expect(screen.getByRole('link', { name: 'MCS 連携ページを開く' }).getAttribute('href')).toBe(
        '/patients/__s_patient_1__/mcs',
      );
      expect(vi.mocked(buildPatientHref).mock.calls).toEqual([['patient_1', '/mcs']]);
    } finally {
      if (realImpl) {
        vi.mocked(buildPatientHref).mockImplementation(realImpl);
      }
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed with RangeError for exact dot-segment patientId %p',
    (dotId) => {
      useOrgIdMock.mockReturnValue('org_1');
      useQueryMock.mockReturnValue({ data: openLinkData(), isError: false });
      expect(() => render(<PatientMcsLinkCard patientId={dotId} />)).toThrow(RangeError);
    },
  );
});
