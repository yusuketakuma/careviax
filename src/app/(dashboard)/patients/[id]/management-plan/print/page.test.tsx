// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import ManagementPlanPrintPage from './page';

setupDomTestEnv();

const printMock = vi.hoisted(() => vi.fn());
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

vi.mock('@/components/features/reports/print-layout', () => ({
  PrintLayout: ({ children }: { children: React.ReactNode }) => (
    <main data-testid="print-layout">{children}</main>
  ),
}));

vi.mock('@/components/features/workflow/print-page-toolbar', () => ({
  PrintPageToolbar: ({ backHref, backLabel }: { backHref: string; backLabel: string }) => (
    <a href={backHref}>{backLabel}</a>
  ),
}));

vi.mock('@/components/features/workflow/page-shortcut-presets', () => ({
  getManagementPlanPrintShortcutLinks: vi.fn(() => []),
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

// Actual-backed spy: keep real encode/guard output and add return-value delegation teeth.
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

type QueryConfig = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
};

const patientSnapshot = {
  id: 'patient_1',
  name: '佐藤 花子',
};

const planSnapshot = {
  data: {
    id: 'plan_1',
    case_id: 'case_1',
    title: '訪問薬剤管理指導計画書',
    summary: '療養上の留意点',
    content: { goal: '服薬継続' },
    version: 2,
    status: 'approved',
    effective_from: '2026-06-01',
    next_review_date: '2026-07-01',
    approved_at: '2026-06-02',
    updated_at: '2026-06-03T00:00:00.000Z',
  },
};

function caseSnapshot(patientId = 'patient_1') {
  return {
    data: {
      id: 'case_1',
      patient: {
        id: patientId,
        name: '佐藤 花子',
      },
    },
  };
}

function okJson(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as Response;
}

function setRoute(patientId = 'patient_1', planId = 'plan_1') {
  useParamsMock.mockReturnValue({ id: patientId });
  useSearchParamsMock.mockReturnValue(new URLSearchParams({ planId }));
  useOrgIdMock.mockReturnValue('org_1');
}

function mockReady(patientId = 'patient_1') {
  setRoute(patientId);
  useQueryMock.mockImplementation(({ queryKey }: QueryConfig) => {
    if (queryKey[0] === 'management-plan-print-patient') {
      return { data: { ...patientSnapshot, id: patientId }, isLoading: false, error: null };
    }
    if (queryKey[0] === 'management-plan-print') {
      return { data: planSnapshot, isLoading: false, error: null };
    }
    return { data: caseSnapshot(patientId), isLoading: false, error: null };
  });
}

describe('ManagementPlanPrintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    useSearchParamsMock.mockReturnValue(new URLSearchParams({ planId: 'plan_1' }));
    Object.defineProperty(window, 'print', { configurable: true, value: printMock });
  });

  it('shows a management-plan print skeleton instead of a generic spinner while loading', () => {
    setRoute('patient_1', 'plan_1');
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, error: null });

    render(<ManagementPlanPrintPage />);

    expect(screen.getByRole('status', { name: '管理計画書の印刷データを読み込み中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByTestId('print-layout')).toBeNull();
    expect(screen.queryByText(patientSnapshot.name)).toBeNull();
    expect(screen.queryByText(planSnapshot.data.title)).toBeNull();
  });

  it('builds patient, plan, and case fetch URLs with encoded path ids and org headers', async () => {
    const hostilePatientId = 'patient/1?x=y#z';
    const hostilePlanId = 'plan/1?x=y#z';
    const hostileCaseId = 'case/1?x=y#z';
    setRoute(hostilePatientId, hostilePlanId);

    const captured = new Map<string, QueryConfig>();
    useQueryMock.mockImplementation((config: QueryConfig) => {
      captured.set(String(config.queryKey[0]), config);
      if (config.queryKey[0] === 'management-plan-print') {
        return {
          data: { data: { ...planSnapshot.data, id: hostilePlanId, case_id: hostileCaseId } },
          isLoading: false,
          error: null,
        };
      }
      return { data: undefined, isLoading: true, error: null };
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okJson({}));
    vi.stubGlobal('fetch', fetchMock);

    render(<ManagementPlanPrintPage />);

    expect(captured.get('management-plan-print-patient')?.queryKey).toEqual([
      'management-plan-print-patient',
      hostilePatientId,
      'org_1',
    ]);
    expect(captured.get('management-plan-print')?.queryKey).toEqual([
      'management-plan-print',
      hostilePlanId,
      'org_1',
    ]);
    expect(captured.get('management-plan-print-case')?.queryKey).toEqual([
      'management-plan-print-case',
      hostileCaseId,
      'org_1',
    ]);

    await captured.get('management-plan-print-patient')?.queryFn();
    let [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(buildPatientApiPath).toHaveBeenCalledWith(hostilePatientId);
    expect(url).toBe(`/api/patients/${encodeURIComponent(hostilePatientId)}`);
    expect(url).not.toContain('?x=y');
    expect(url).not.toContain('#z');
    expect(url).not.toContain('%25');
    expect((init.headers as Record<string, string>)['x-org-id']).toBe('org_1');
    expect(init.cache).toBe('no-store');

    fetchMock.mockClear();
    await captured.get('management-plan-print')?.queryFn();
    [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/management-plans/${encodeURIComponent(hostilePlanId)}`);
    expect(url).not.toContain('?x=y');
    expect(url).not.toContain('#z');
    expect(url).not.toContain('%25');
    expect((init.headers as Record<string, string>)['x-org-id']).toBe('org_1');
    expect(init.cache).toBe('no-store');

    fetchMock.mockClear();
    await captured.get('management-plan-print-case')?.queryFn();
    [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/cases/${encodeURIComponent(hostileCaseId)}`);
    expect(url).not.toContain('?x=y');
    expect(url).not.toContain('#z');
    expect(url).not.toContain('%25');
    expect((init.headers as Record<string, string>)['x-org-id']).toBe('org_1');
    expect(init.cache).toBe('no-store');
  });

  it.each([
    ['patient', 'management-plan-print-patient', '.', 'plan_1', 'case_1'],
    ['patient', 'management-plan-print-patient', '..', 'plan_1', 'case_1'],
    ['plan', 'management-plan-print', 'patient_1', '.', 'case_1'],
    ['plan', 'management-plan-print', 'patient_1', '..', 'case_1'],
    ['case', 'management-plan-print-case', 'patient_1', 'plan_1', '.'],
    ['case', 'management-plan-print-case', 'patient_1', 'plan_1', '..'],
  ])(
    'fails closed before fetch for exact dot-segment %s id %s',
    async (_kind, queryName, patientId, planId, caseId) => {
      setRoute(patientId, planId);
      const captured = new Map<string, QueryConfig>();
      useQueryMock.mockImplementation((config: QueryConfig) => {
        captured.set(String(config.queryKey[0]), config);
        if (config.queryKey[0] === 'management-plan-print') {
          return {
            data: { data: { ...planSnapshot.data, id: planId, case_id: caseId } },
            isLoading: false,
            error: null,
          };
        }
        return { data: undefined, isLoading: true, error: null };
      });
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      render(<ManagementPlanPrintPage />);

      await expect(captured.get(queryName)?.queryFn()).rejects.toThrow(RangeError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('routes the patient fetch through the shared patient API path helper return value', async () => {
    const patientId = 'patient_1';
    setRoute(patientId, 'plan_1');

    let capturedConfig: QueryConfig | undefined;
    useQueryMock.mockImplementation((config: QueryConfig) => {
      if (config.queryKey[0] === 'management-plan-print-patient') {
        capturedConfig = config;
      }
      return { data: undefined, isLoading: true, error: null };
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okJson(patientSnapshot));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_patient__');

    try {
      render(<ManagementPlanPrintPage />);

      await capturedConfig?.queryFn();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/patients/__helper_patient__');
      expect(fetchMock).not.toHaveBeenCalledWith(`/api/patients/${patientId}`, expect.anything());
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('renders an error and suppresses print when the plan case belongs to another patient', () => {
    vi.useFakeTimers();
    setRoute('patient_route', 'plan_1');
    useQueryMock.mockImplementation(({ queryKey }: QueryConfig) => {
      if (queryKey[0] === 'management-plan-print-patient') {
        return { data: { ...patientSnapshot, id: 'patient_route' }, isLoading: false, error: null };
      }
      if (queryKey[0] === 'management-plan-print') {
        return { data: planSnapshot, isLoading: false, error: null };
      }
      return { data: caseSnapshot('patient_other'), isLoading: false, error: null };
    });

    try {
      render(<ManagementPlanPrintPage />);
      expect(screen.getByText('印刷データを取得できませんでした。')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(printMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('prints the management plan only when the plan case belongs to the route patient', () => {
    vi.useFakeTimers();
    mockReady('patient_1');

    try {
      render(<ManagementPlanPrintPage />);
      expect(
        screen.getByRole('heading', { level: 1, name: '訪問薬剤管理指導計画書' }),
      ).toBeTruthy();
      expect(screen.getByText('佐藤 花子')).toBeTruthy();
      expect(screen.getByRole('link', { name: '患者詳細へ戻る' }).getAttribute('href')).toBe(
        '/patients/patient_1',
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(printMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes the error fallback and toolbar backHref through buildPatientHref return values', () => {
    setRoute('patient_1', 'plan_1');
    useQueryMock.mockImplementation(({ queryKey }: QueryConfig) => {
      if (queryKey[0] === 'management-plan-print-patient') {
        return { data: null, isLoading: false, error: new Error('failed') };
      }
      return { data: undefined, isLoading: false, error: null };
    });

    const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockImplementation(
      (id: string, suffix = '') => `/p__${id}__${suffix}`,
    );
    vi.mocked(buildPatientHref).mockClear();
    try {
      render(<ManagementPlanPrintPage />);
      expect(screen.getByRole('link', { name: '戻る' }).getAttribute('href')).toBe(
        '/p__patient_1__',
      );
      expect(vi.mocked(buildPatientHref).mock.calls).toContainEqual(['patient_1']);
    } finally {
      if (realImpl) vi.mocked(buildPatientHref).mockImplementation(realImpl);
    }

    vi.clearAllMocks();
    mockReady('patient_1');
    vi.mocked(buildPatientHref).mockImplementation(
      (id: string, suffix = '') => `/p__${id}__${suffix}`,
    );
    try {
      render(<ManagementPlanPrintPage />);
      expect(screen.getByRole('link', { name: '患者詳細へ戻る' }).getAttribute('href')).toBe(
        '/p__patient_1__',
      );
      expect(vi.mocked(buildPatientHref).mock.calls).toContainEqual(['patient_1']);
    } finally {
      if (realImpl) vi.mocked(buildPatientHref).mockImplementation(realImpl);
    }
  });
});
