// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import PatientVisitRecordsPrintPage from './page';

setupDomTestEnv();

const useParamsMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn(() => new URLSearchParams()));
const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useParams: useParamsMock,
  useSearchParams: useSearchParamsMock,
}));

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

// Render the toolbar's backHref as a verifiable anchor so the nav teeth can be asserted.
vi.mock('@/components/features/workflow/print-page-toolbar', () => ({
  PrintPageToolbar: ({ backHref, backLabel }: { backHref: string; backLabel: string }) => (
    <a href={backHref}>{backLabel}</a>
  ),
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

// Actual-backed spy: real encode/guard output for hostile id + return-value delegation teeth.
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

const patientSnapshot = {
  id: 'patient_1',
  name: '佐藤 花子',
  name_kana: 'サトウ ハナコ',
  birth_date: '1940-01-01',
};

function mockReady(patientId = 'patient_1') {
  useParamsMock.mockReturnValue({ id: patientId });
  useOrgIdMock.mockReturnValue('org_1');
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'me-org') {
      return { data: { name: '青葉薬局' }, isLoading: false, error: null };
    }
    if (queryKey[0] === 'visit-record-print-patient') {
      return { data: patientSnapshot, isLoading: false, error: null };
    }
    return { data: { data: [] }, isLoading: false, error: null };
  });
}

describe('PatientVisitRecordsPrintPage', () => {
  it('shows a visit-record print skeleton instead of a generic spinner while loading', () => {
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, error: null });

    render(<PatientVisitRecordsPrintPage />);

    expect(
      screen.getByRole('status', { name: '訪問記録一覧の印刷データを読み込み中' }),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText(patientSnapshot.name)).toBeNull();
    expect(screen.queryByRole('link', { name: '患者詳細へ戻る' })).toBeNull();
  });

  it('builds the patient fetch URL with an encoded hostile patientId and org header', async () => {
    const hostileId = 'pt/1?x=y#z';
    useParamsMock.mockReturnValue({ id: hostileId });
    useOrgIdMock.mockReturnValue('org_1');

    let capturedConfig: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        if (config.queryKey[0] === 'visit-record-print-patient') {
          capturedConfig = config;
          return { data: patientSnapshot, isLoading: false, error: null };
        }
        if (config.queryKey[0] === 'me-org') {
          return { data: { name: '青葉薬局' }, isLoading: false, error: null };
        }
        return { data: { data: [] }, isLoading: false, error: null };
      },
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(patientSnapshot),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientVisitRecordsPrintPage />);

      // raw patientId is preserved in the cache key (not encoded)
      expect(capturedConfig?.queryKey).toEqual(['visit-record-print-patient', hostileId, 'org_1']);

      await capturedConfig?.queryFn();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(buildPatientApiPath).toHaveBeenCalledWith(hostileId);
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect((init.headers as Record<string, string>)['x-org-id']).toBe('org_1');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('keeps the org header and no-store cache on the me-org and visit-records fetches', async () => {
    const hostileId = 'pt/1?x=y#z';
    useParamsMock.mockReturnValue({ id: hostileId });
    useOrgIdMock.mockReturnValue('org_1');
    useSearchParamsMock.mockReturnValue(new URLSearchParams({ dateFrom: '2026-04-01' }));

    const captured = new Map<string, { queryFn: () => Promise<unknown> }>();
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured.set(String(config.queryKey[0]), config);
        if (config.queryKey[0] === 'me-org') {
          return { data: { name: '青葉薬局' }, isLoading: false, error: null };
        }
        if (config.queryKey[0] === 'visit-record-print-patient') {
          return { data: patientSnapshot, isLoading: false, error: null };
        }
        return { data: { data: [] }, isLoading: false, error: null };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { name: '青葉薬局' } }),
      } as unknown as Response)
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientVisitRecordsPrintPage />);

      await captured.get('me-org')?.queryFn();
      const [orgUrl, orgInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(orgUrl).toBe('/api/me/org');
      expect((orgInit.headers as Record<string, string>)['x-org-id']).toBe('org_1');
      expect(orgInit.cache).toBe('no-store');

      fetchMock.mockClear();
      await captured.get('visit-record-print')?.queryFn();
      const [recUrl, recInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(recUrl.startsWith('/api/visit-records?')).toBe(true);
      expect((recInit.headers as Record<string, string>)['x-org-id']).toBe('org_1');
      expect(recInit.cache).toBe('no-store');
      // patient_id stays a raw query value (URLSearchParams-encoded), not path-encoded.
      const recParams = new URLSearchParams(recUrl.split('?')[1]);
      expect(recParams.get('patient_id')).toBe(hostileId);
    } finally {
      vi.unstubAllGlobals();
      useSearchParamsMock.mockReturnValue(new URLSearchParams());
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p',
    async (dotId) => {
      useParamsMock.mockReturnValue({ id: dotId });
      useOrgIdMock.mockReturnValue('org_1');

      let capturedConfig: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
      useQueryMock.mockImplementation(
        (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
          if (config.queryKey[0] === 'visit-record-print-patient') {
            capturedConfig = config;
          }
          return { data: undefined, isLoading: true, error: null };
        },
      );

      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientVisitRecordsPrintPage />);
        await expect(capturedConfig?.queryFn()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  it('routes the patient fetch through the shared patient API path helper return value', async () => {
    const patientId = 'patient_1';
    useParamsMock.mockReturnValue({ id: patientId });
    useOrgIdMock.mockReturnValue('org_1');

    let capturedConfig: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        if (config.queryKey[0] === 'visit-record-print-patient') {
          capturedConfig = config;
        }
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(patientSnapshot),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_patient__');

    try {
      render(<PatientVisitRecordsPrintPage />);

      await capturedConfig?.queryFn();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/patients/__helper_patient__');
      expect(fetchMock).not.toHaveBeenCalledWith(`/api/patients/${patientId}`, expect.anything());
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('routes the error fallback link and toolbar backHref through buildPatientHref', () => {
    const hostileId = 'pt/1?x=y#z';
    useParamsMock.mockReturnValue({ id: hostileId });
    useOrgIdMock.mockReturnValue('org_1');
    // error branch: org/patient resolve to null with an error flagged
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'me-org') {
        return { data: null, isLoading: false, error: new Error('failed') };
      }
      if (queryKey[0] === 'visit-record-print-patient') {
        return { data: null, isLoading: false, error: null };
      }
      return { data: undefined, isLoading: false, error: null };
    });

    render(<PatientVisitRecordsPrintPage />);

    const backLink = screen.getByRole('link', { name: '戻る' });
    const href = backLink.getAttribute('href') ?? '';
    expect(href).toBe(`/patients/${encodeURIComponent(hostileId)}`);
    expect(href).not.toContain(hostileId);
    expect(href).not.toContain('?x=y');
    expect(href).not.toContain('#z');
    expect(href).not.toContain('%25');
    expect(vi.mocked(buildPatientHref).mock.calls).toContainEqual([hostileId]);
  });

  it('consumes the buildPatientHref return value for the error fallback link', () => {
    useParamsMock.mockReturnValue({ id: 'patient_1' });
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'me-org') {
        return { data: null, isLoading: false, error: new Error('failed') };
      }
      if (queryKey[0] === 'visit-record-print-patient') {
        return { data: null, isLoading: false, error: null };
      }
      return { data: undefined, isLoading: false, error: null };
    });

    const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockImplementation(
      (id: string, suffix = '') => `/p__${id}__${suffix}`,
    );
    vi.mocked(buildPatientHref).mockClear();
    try {
      render(<PatientVisitRecordsPrintPage />);

      expect(screen.getByRole('link', { name: '戻る' }).getAttribute('href')).toBe(
        '/p__patient_1__',
      );
      expect(vi.mocked(buildPatientHref).mock.calls).toContainEqual(['patient_1']);
    } finally {
      if (realImpl) vi.mocked(buildPatientHref).mockImplementation(realImpl);
      vi.clearAllMocks();
    }
  });

  it('consumes the buildPatientHref return value for the toolbar backHref on the ready page', () => {
    mockReady('patient_1');

    const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockImplementation(
      (id: string, suffix = '') => `/p__${id}__${suffix}`,
    );
    vi.mocked(buildPatientHref).mockClear();
    try {
      render(<PatientVisitRecordsPrintPage />);

      expect(screen.getByRole('link', { name: '患者詳細へ戻る' }).getAttribute('href')).toBe(
        '/p__patient_1__',
      );
      expect(vi.mocked(buildPatientHref).mock.calls).toContainEqual(['patient_1']);
    } finally {
      if (realImpl) vi.mocked(buildPatientHref).mockImplementation(realImpl);
      vi.clearAllMocks();
    }
  });
});
