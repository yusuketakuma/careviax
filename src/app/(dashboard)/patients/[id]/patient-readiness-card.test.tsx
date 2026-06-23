// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientReadinessCard } from './patient-readiness-card';

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

describe('PatientReadinessCard', () => {
  it('renders readiness summary with a semantic section heading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        applicable: true,
        overall_status: 'blocked',
        completed_count: 1,
        total_count: 2,
        current_case: { status: 'active' },
        items: [
          {
            key: 'management_plan',
            label: '管理計画書',
            description: '承認済みの管理計画書が必要です。',
            completed: false,
            severity: 'high',
            action_label: '確認する',
            action_href: '/patients/patient_1/management-plan',
          },
        ],
      },
      isLoading: false,
      error: null,
    });

    render(<PatientReadinessCard patientId="patient_1" />);

    expect(
      screen.getByRole('heading', { level: 2, name: '患者情報・訪問開始 readiness' }).tagName,
    ).toBe('H2');
    expect(screen.getByText('管理計画書')).toBeTruthy();
    // API-generated action_href (server builds it via buildPatientHref) is rendered as-is.
    expect(screen.getByRole('link', { name: '確認する' }).getAttribute('href')).toBe(
      '/patients/patient_1/management-plan',
    );
  });

  it('builds the readiness fetch URL with an encoded hostile patientId and org header', async () => {
    const hostileId = 'pt/1?x=y#z';
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientReadinessCard patientId={hostileId} />);

      // raw patientId stays in the cache key.
      expect(captured?.queryKey).toEqual(['patient-readiness', hostileId, 'org_1']);

      await captured?.queryFn();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/readiness`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect((init.headers as Record<string, string>)['x-org-id']).toBe('org_1');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p',
    async (dotId) => {
      useOrgIdMock.mockReturnValue('org_1');

      let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
      useQueryMock.mockImplementation(
        (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
          captured = config;
          return { data: undefined, isLoading: true, error: null };
        },
      );

      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientReadinessCard patientId={dotId} />);
        await expect(captured?.queryFn()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );
});
