// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { encodePathSegment } from '@/lib/http/path-segment';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { jsonResponse } from '@/test/fetch-test-utils';
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

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

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

const NOT_APPLICABLE_RESPONSE = {
  data: {
    applicable: false,
    overall_status: 'not_started',
    completed_count: 0,
    total_count: 0,
    current_case: null,
    items: [],
  },
} as const;

const ACTION_REQUIRED_RESPONSE = {
  data: {
    applicable: true,
    overall_status: 'action_required',
    completed_count: 0,
    total_count: 1,
    current_case: { id: 'case_1', status: 'active' },
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
} as const;

describe('PatientReadinessCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildPatientApiPath).mockReset();
    vi.mocked(buildPatientApiPath).mockImplementation(
      (patientId, suffix = '') => `/api/patients/${encodePathSegment(patientId)}${suffix}`,
    );
  });

  it('renders a PH-OS skeleton while readiness data loads', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<PatientReadinessCard patientId="patient_1" />);

    expect(
      screen.getByRole('status', { name: '患者情報・訪問開始 readiness を読み込み中' }),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('対象ケースがありません')).toBeNull();
    expect(screen.queryByText('オンボーディング状況の取得に失敗しました')).toBeNull();
  });

  it('renders readiness summary with a semantic section heading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        applicable: true,
        overall_status: 'action_required',
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
      .mockResolvedValue(jsonResponse(NOT_APPLICABLE_RESPONSE));
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

  it('routes readiness fetches through the shared patient API path helper', async () => {
    const patientId = 'patient_1';
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_patient_1__/readiness',
    );
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
      .mockResolvedValue(jsonResponse(NOT_APPLICABLE_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientReadinessCard patientId={patientId} />);

      await captured?.queryFn();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId, '/readiness');
      expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_patient_1__/readiness', {
        headers: { 'x-org-id': 'org_1' },
      });
      expect(fetchMock).not.toHaveBeenCalledWith(`/api/patients/${patientId}/readiness`, {
        headers: { 'x-org-id': 'org_1' },
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('keeps API messages from failed readiness fetches', async () => {
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
      .mockResolvedValue(jsonResponse({ message: 'readiness APIからの詳細エラー' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientReadinessCard patientId="patient_1" />);

      await expect(captured?.queryFn()).rejects.toThrow('readiness APIからの詳細エラー');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each([
    {
      name: 'legacy status',
      payload: {
        data: { ...ACTION_REQUIRED_RESPONSE.data, overall_status: 'blocked' },
      },
    },
    {
      name: 'count mismatch',
      payload: {
        data: { ...ACTION_REQUIRED_RESPONSE.data, completed_count: 1 },
      },
    },
    {
      name: 'unsafe action href',
      payload: {
        data: {
          ...ACTION_REQUIRED_RESPONSE.data,
          items: [
            {
              ...ACTION_REQUIRED_RESPONSE.data.items[0],
              action_href: 'javascript:alert(1)',
            },
          ],
        },
      },
    },
    {
      name: 'unknown data key',
      payload: {
        data: { ...NOT_APPLICABLE_RESPONSE.data, patient_name: '伊藤 キヨ' },
      },
    },
    {
      name: 'mixed legacy root',
      payload: { ...NOT_APPLICABLE_RESPONSE, applicable: false },
    },
  ])('rejects malformed successful readiness payloads: $name', async ({ payload }) => {
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation((config: { queryFn: () => Promise<unknown> }) => {
      captured = config;
      return { data: undefined, isLoading: true, error: null };
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientReadinessCard patientId="patient_1" />);

      await expect(captured?.queryFn()).rejects.toThrow('オンボーディング状況の取得に失敗しました');
    } finally {
      vi.unstubAllGlobals();
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
