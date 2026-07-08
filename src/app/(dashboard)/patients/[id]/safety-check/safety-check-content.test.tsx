// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse, stubJsonFetch } from '@/test/fetch-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import type { SafetyIssueRecord } from './safety-check.shared';

const useMutationMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

// Actual-backed spies so URL/header teeth prove helper adoption via return-value identity.
vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

// encodePathSegment is intentionally NOT mocked so its real fail-closed dot-segment
// contract (RangeError on '.'/'..') is exercised end-to-end.

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { SafetyCheckContent } from './safety-check-content';

setupDomTestEnv();

type IssueOverrides = Partial<SafetyIssueRecord> & { id: string };

function buildIssue(overrides: IssueOverrides): SafetyIssueRecord & {
  patient_id: string;
  case_id: string | null;
} {
  return {
    id: overrides.id,
    patient_id: 'patient_1',
    case_id: 'case_1',
    title: overrides.title ?? '飲み合わせ注意',
    description: overrides.description ?? 'NSAIDs 併用の確認',
    status: overrides.status ?? 'open',
    priority: overrides.priority ?? 'high',
    category: overrides.category ?? 'interaction',
    identified_at: overrides.identified_at ?? '2026-06-10T09:00:00.000Z',
  };
}

describe('SafetyCheckContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the safety-check workspace heading and concern card', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation((cfg: { queryKey: unknown[] }) => {
      const key = String((cfg.queryKey as unknown[])[0]);
      if (key === 'medication-issues') {
        return {
          data: { data: [buildIssue({ id: 'issue_1' })] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      if (key === 'safety-check-cds') return { data: [], isLoading: false };
      if (key === 'patient-safety-check-summary') {
        return { data: { name: '山田花子' }, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });

    render(<SafetyCheckContent patientId="patient_1" />);

    expect(screen.getByRole('heading', { level: 1, name: '薬の安全チェック' }).tagName).toBe('H1');
    const primaryAction = screen.getByTestId('safety-primary-action');
    const concerns = screen.getByTestId('safety-concerns');
    expect(within(primaryAction).getByText('次にやること')).toBeTruthy();
    expect(within(primaryAction).getByText('飲み合わせ')).toBeTruthy();
    expect(within(primaryAction).getByRole('button', { name: '医師への確認を記録' })).toBeTruthy();
    expect(within(primaryAction).getByRole('button', { name: '問題なしにする' })).toBeTruthy();
    expect(
      Boolean(primaryAction.compareDocumentPosition(concerns) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(screen.getByTestId('safety-concern-interaction')).toBeTruthy();
    expect(screen.getByTestId('safety-steps')).toBeTruthy();
  });

  it('pins the patient identity and allergy/high-risk safety band above the workspace', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation((cfg: { queryKey: unknown[] }) => {
      const key = String((cfg.queryKey as unknown[])[0]);
      if (key === 'medication-issues') {
        return {
          data: { data: [buildIssue({ id: 'issue_1' })] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      if (key === 'safety-check-cds') return { data: [], isLoading: false };
      if (key === 'patient-safety-check-summary') {
        return {
          data: {
            name: '山田花子',
            name_kana: 'ヤマダハナコ',
            birth_date: '1948-03-02',
            workspace: {
              safety: {
                allergy: 'ペニシリン',
                handling_tags: ['narcotic'],
              },
            },
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });

    render(<SafetyCheckContent patientId="patient_1" />);

    const header = screen.getByTestId('patient-header');
    expect(header).toBeTruthy();
    // 安全チェック中もアレルギーが常時可視化される(埋没防止)。
    expect(within(header).getByText('山田花子 様')).toBeTruthy();
    expect(
      within(screen.getByTestId('patient-header-safety')).getByText('ペニシリン'),
    ).toBeTruthy();
  });

  it('surfaces patient summary failure in the pinned safety banner region', () => {
    const refetchPatient = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation((cfg: { queryKey: unknown[] }) => {
      const key = String((cfg.queryKey as unknown[])[0]);
      if (key === 'medication-issues') {
        return {
          data: { data: [buildIssue({ id: 'issue_1' })] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      if (key === 'safety-check-cds') return { data: [], isLoading: false };
      if (key === 'patient-safety-check-summary') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          refetch: refetchPatient,
        };
      }
      return { data: undefined, isLoading: false };
    });

    render(<SafetyCheckContent patientId="patient_1" />);

    expect(screen.getByText(/患者安全情報を読み込めませんでした/)).toBeTruthy();
    expect(screen.queryByTestId('patient-header')).toBeNull();
    expect(screen.getByTestId('safety-primary-action')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchPatient).toHaveBeenCalled();
  });

  it('surfaces a non-blocking degraded banner and suppresses the false-safe empty text when the CDS check fails', () => {
    const refetchCds = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation((cfg: { queryKey: unknown[] }) => {
      const key = String((cfg.queryKey as unknown[])[0]);
      if (key === 'medication-issues') {
        // 課題は空。CDS 補強が失敗している状態では「気になる点はありません」を出してはならない。
        return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      if (key === 'safety-check-cds') {
        return { data: undefined, isLoading: false, isError: true, refetch: refetchCds };
      }
      if (key === 'patient-safety-check-summary') {
        return { data: { name: '山田花子' }, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });

    render(<SafetyCheckContent patientId="patient_1" />);

    const banner = screen.getByTestId('safety-cds-degraded');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(within(banner).getByText(/相互作用チェックを実行できませんでした/)).toBeTruthy();
    // false-safe な「気になる点はありません」はエラー時に出さない。
    expect(screen.queryByText(/気になる点はありません/)).toBeNull();

    fireEvent.click(within(banner).getByRole('button', { name: '再試行' }));
    expect(refetchCds).toHaveBeenCalled();
  });

  it('keeps the clean-state empty text (no degraded banner) when the CDS check succeeds with zero concerns', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation((cfg: { queryKey: unknown[] }) => {
      const key = String((cfg.queryKey as unknown[])[0]);
      if (key === 'medication-issues') {
        return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      if (key === 'safety-check-cds') return { data: [], isLoading: false, isError: false };
      if (key === 'patient-safety-check-summary') {
        return { data: { name: '山田花子' }, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });

    render(<SafetyCheckContent patientId="patient_1" />);

    expect(screen.queryByTestId('safety-cds-degraded')).toBeNull();
    expect(screen.getByText(/気になる点はありません/)).toBeTruthy();
  });
});

describe('SafetyCheckContent url/header convergence', () => {
  const HOSTILE = 'pt/1?x=y#z';
  const ENCODED = encodeURIComponent(HOSTILE);

  // Mutation registration order in SafetyCheckContent: [0] consultation, [1] resolve.
  const CONSULTATION = 0;
  const RESOLVE = 1;

  function renderSafetyCheck({
    patientId = HOSTILE,
    issues = [] as Array<ReturnType<typeof buildIssue>>,
  } = {}) {
    const queryConfigs = new Map<string, { queryKey: unknown[]; queryFn: () => unknown }>();
    const mutationConfigs: Array<{
      mutationFn: (input?: unknown) => unknown;
      onSuccess?: (data?: unknown) => unknown;
    }> = [];
    const invalidateQueries = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries });
    useMutationMock.mockImplementation(
      (cfg: {
        mutationFn: (input?: unknown) => unknown;
        onSuccess?: (data?: unknown) => unknown;
      }) => {
        mutationConfigs.push(cfg);
        return { mutate: vi.fn(), isPending: false };
      },
    );
    useQueryMock.mockImplementation((cfg: { queryKey: unknown[]; queryFn: () => unknown }) => {
      const key = String((cfg.queryKey as unknown[])[0]);
      queryConfigs.set(key, cfg);
      if (key === 'medication-issues') {
        return { data: { data: issues }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      if (key === 'safety-check-cds') return { data: [], isLoading: false };
      if (key === 'patient-safety-check-summary') {
        return { data: { name: '山田花子' }, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });
    render(<SafetyCheckContent patientId={patientId} />);
    return { queryConfigs, mutationConfigs, invalidateQueries };
  }

  function stubFetch() {
    return stubJsonFetch({ data: [] });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('medication-issues GET adopts buildOrgHeaders, keeps patient_id raw via URLSearchParams, org-scoped key', async () => {
    const sentinel = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinel);
    const { queryConfigs } = renderSafetyCheck();
    const fetchMock = stubFetch();

    try {
      await queryConfigs.get('medication-issues')!.queryFn();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url, 'http://x');
      expect(parsed.pathname).toBe('/api/medication-issues');
      expect(parsed.searchParams.get('patient_id')).toBe(HOSTILE);
      expect(url).not.toContain('%25');
      expect(init.headers).toBe(sentinel);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
      expect(queryConfigs.get('medication-issues')!.queryKey).toEqual([
        'medication-issues',
        'org_1',
        HOSTILE,
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('patient summary GET single-encodes the patient path segment and adopts buildOrgHeaders', async () => {
    const sentinel = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinel);
    const { queryConfigs } = renderSafetyCheck();
    const fetchMock = stubFetch();

    try {
      await queryConfigs.get('patient-safety-check-summary')!.queryFn();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(buildPatientApiPath).toHaveBeenCalledWith(HOSTILE);
      expect(url).toBe(`/api/patients/${ENCODED}`);
      expect(url).not.toContain('%25');
      expect(init.headers).toBe(sentinel);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
      // existing orgId-last summary key is preserved (not reordered)
      expect(queryConfigs.get('patient-safety-check-summary')!.queryKey).toEqual([
        'patient-safety-check-summary',
        HOSTILE,
        'org_1',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['.', '..'])(
    'fails closed before any fetch for the exact dot patient id %p (buildPatientHref throws at render)',
    (dotId) => {
      // The WorkflowBackLink href now goes through buildPatientHref, which rejects dot
      // segments. For a dot patient id the component fails closed at render time —
      // strictly before any patient-summary GET (or other) fetch can occur.
      const fetchMock = stubFetch();
      try {
        expect(() => renderSafetyCheck({ patientId: dotId })).toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('patient summary GET consumes the shared patient API path helper return value', async () => {
    const { queryConfigs } = renderSafetyCheck({ patientId: 'patient_1' });
    const fetchMock = stubFetch();
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_patient__');

    try {
      await queryConfigs.get('patient-safety-check-summary')!.queryFn();
      expect(buildPatientApiPath).toHaveBeenCalledWith('patient_1');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/patients/__helper_patient__');
      expect(fetchMock).not.toHaveBeenCalledWith('/api/patients/patient_1', expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('surfaces API messages from the medication issues read query', async () => {
    const { queryConfigs } = renderSafetyCheck();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: 'API側の服薬課題エラー' }, 500)),
    );

    try {
      await expect(queryConfigs.get('medication-issues')!.queryFn()).rejects.toThrow(
        'API側の服薬課題エラー',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('surfaces API messages from the patient summary read query', async () => {
    const { queryConfigs } = renderSafetyCheck({ patientId: 'patient_1' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: 'API側の患者情報エラー' }, 500)),
    );

    try {
      await expect(queryConfigs.get('patient-safety-check-summary')!.queryFn()).rejects.toThrow(
        'API側の患者情報エラー',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cds helper issues the medication-cycles GET then cds/check POST via the shared helpers', async () => {
    const getSentinel = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    const jsonSentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgHeaders).mockReturnValue(getSentinel);
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(jsonSentinel);
    const { queryConfigs } = renderSafetyCheck();

    const fetchMock = vi.fn();
    // first call: medication-cycles GET returns a cycle id; second call: cds/check POST
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'cycle_1' }] }),
    } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { alerts: [] } }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      await queryConfigs.get('safety-check-cds')!.queryFn();

      const [cyclesUrl, cyclesInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsedCycles = new URL(cyclesUrl, 'http://x');
      expect(parsedCycles.pathname).toBe('/api/medication-cycles');
      expect(parsedCycles.searchParams.get('patient_id')).toBe(HOSTILE);
      expect(parsedCycles.searchParams.get('limit')).toBe('1');
      expect(cyclesUrl).not.toContain('%25');
      expect(cyclesInit.headers).toBe(getSentinel);

      const [checkUrl, checkInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(checkUrl).toBe('/api/cds/check');
      expect(checkInit.method).toBe('POST');
      expect(checkInit.headers).toBe(jsonSentinel);
      expect(JSON.parse(checkInit.body as string)).toEqual({
        cycleId: 'cycle_1',
        patientId: HOSTILE,
      });
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cds helper throws (does not swallow to empty) when the medication-cycles GET returns a 5xx server error', async () => {
    const { queryConfigs } = renderSafetyCheck();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      // 5xx を [] に潰すと CDS 障害が「問題なし」に偽装される。throw して isError に乗せる。
      await expect(queryConfigs.get('safety-check-cds')!.queryFn()).rejects.toThrow();
      // cds/check POST までは到達しない(前提取得で失敗)。
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cds helper throws when the cds/check POST returns a 5xx server error', async () => {
    const { queryConfigs } = renderSafetyCheck();
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'cycle_1' }] }),
    } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(queryConfigs.get('safety-check-cds')!.queryFn()).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cds helper returns [] (legitimate empty, no throw) when there are zero medication cycles', async () => {
    const { queryConfigs } = renderSafetyCheck();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(queryConfigs.get('safety-check-cds')!.queryFn()).resolves.toEqual([]);
      // サイクルが無ければ cds/check POST は発火しない。
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cds helper returns [] (legitimate empty, no throw) when the medication-cycles GET is a 4xx permission denial', async () => {
    const { queryConfigs } = renderSafetyCheck();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      // 閲覧権限(canDispense)による空は正当な空。degraded を出さず補強なしで扱う。
      await expect(queryConfigs.get('safety-check-cds')!.queryFn()).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('consultation POST adopts json helper, carries raw issue_id, then single-encodes the PATCH path', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs, invalidateQueries } = renderSafetyCheck({
      issues: [buildIssue({ id: HOSTILE, category: 'interaction', status: 'open' })],
    });
    const fetchMock = stubFetch();

    try {
      const consultation = mutationConfigs[CONSULTATION];
      await consultation.mutationFn('処方医へ電話確認');

      const [postUrl, postInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(postUrl).toBe('/api/interventions');
      expect(postInit.method).toBe('POST');
      expect(postInit.headers).toBe(sentinel);
      expect(JSON.parse(postInit.body as string)).toEqual({
        patient_id: HOSTILE,
        issue_id: HOSTILE,
        type: 'prescriber_consultation',
        description: '処方医へ電話確認',
        performed_at: expect.any(String),
      });

      // open issue → progresses to in_progress via a single-encoded PATCH path
      const [patchUrl, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(patchUrl).toBe(`/api/medication-issues/${ENCODED}`);
      expect(patchUrl).not.toContain('%25');
      expect(patchInit.method).toBe('PATCH');
      expect(patchInit.headers).toBe(sentinel);
      expect(JSON.parse(patchInit.body as string)).toEqual({ status: 'in_progress' });
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');

      await consultation.onSuccess?.();
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['medication-issues', 'org_1', HOSTILE],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('consultation POST omits issue_id when no concern/issue is selected', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs } = renderSafetyCheck({ issues: [] });
    const fetchMock = stubFetch();

    try {
      await mutationConfigs[CONSULTATION].mutationFn('相談メモ');
      // only the interventions POST, no follow-up PATCH without a selected issue
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/interventions');
      expect(init.headers).toBe(sentinel);
      const body = JSON.parse(init.body as string);
      expect(body).not.toHaveProperty('issue_id');
      expect(body).toEqual({
        patient_id: HOSTILE,
        type: 'prescriber_consultation',
        description: '相談メモ',
        performed_at: expect.any(String),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resolve PATCH single-encodes the path issueId, adopts json helper, keeps id out of body', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs, invalidateQueries } = renderSafetyCheck();
    const fetchMock = stubFetch();

    try {
      const resolve = mutationConfigs[RESOLVE];
      await resolve.mutationFn(HOSTILE);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/medication-issues/${ENCODED}`);
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PATCH');
      expect(init.headers).toBe(sentinel);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      expect(JSON.parse(init.body as string)).toEqual({ status: 'resolved' });
      expect(init.body as string).not.toContain(HOSTILE);

      await resolve.onSuccess?.();
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['medication-issues', 'org_1', HOSTILE],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['.', '..'])(
    'resolve PATCH fails closed before fetch for the exact dot issueId %p',
    async (dotId) => {
      const { mutationConfigs } = renderSafetyCheck();
      const fetchMock = stubFetch();
      try {
        await expect(mutationConfigs[RESOLVE].mutationFn(dotId)).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('WorkflowBackLink href adopts buildPatientHref so the back route is single-encoded (no raw ?/# or %25)', () => {
    renderSafetyCheck();
    const backLink = screen.getByRole('link', { name: /患者詳細へ戻る/ });
    const href = backLink.getAttribute('href');
    // buildPatientHref(HOSTILE) === `/patients/${encodeURIComponent(HOSTILE)}`
    expect(href).toBe(`/patients/${ENCODED}`);
    expect(href).not.toContain('?');
    expect(href).not.toContain('#');
    expect(href).not.toContain('%25');
  });

  it.each(['.', '..'])(
    'consultation mutation fails closed before any fetch for an open issue with the exact dot id %p',
    async (dotId) => {
      const { mutationConfigs } = renderSafetyCheck({
        issues: [buildIssue({ id: dotId, category: 'interaction', status: 'open' })],
      });
      const fetchMock = stubFetch();
      try {
        // encodePathSegment(dotId) is precomputed before the interventions POST,
        // so the dot id throws RangeError with no network side effect.
        await expect(mutationConfigs[CONSULTATION].mutationFn('相談メモ')).rejects.toThrow(
          RangeError,
        );
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
