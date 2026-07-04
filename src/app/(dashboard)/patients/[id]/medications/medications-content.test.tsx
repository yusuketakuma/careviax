// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { stubJsonFetch } from '@/test/fetch-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';

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

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/components/features/patients/residual-medication-chart', () => ({
  ResidualMedicationChart: () => <div data-testid="residual-chart" />,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { MedicationsContent } from './medications-content';

setupDomTestEnv();

type MedicationsContentPropsForTest = Parameters<typeof MedicationsContent>[0];

describe('MedicationsContent', () => {
  it('renders medication workflow groups with semantic headings', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'medication-profiles') {
        return {
          data: {
            data: [
              {
                id: 'profile_1',
                patient_id: 'patient_1',
                drug_name: 'アムロジピン錠5mg',
                dose: '1錠',
                frequency: '朝食後',
                start_date: '2026-06-01',
                end_date: null,
                prescriber: '佐藤医師',
                is_current: true,
                source: 'manual',
                created_at: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
          isLoading: false,
        };
      }
      if (queryKey[0] === 'medication-issues') {
        return {
          data: {
            data: [
              {
                id: 'issue_1',
                patient_id: 'patient_1',
                case_id: 'case_1',
                title: 'アムロジピン飲み忘れ',
                description: '夕食後薬を2日続けて飲み忘れています。',
                status: 'open',
                priority: 'high',
                category: 'adherence',
                identified_at: '2026-06-10T09:00:00.000Z',
                resolved_at: null,
              },
            ],
          },
          isLoading: false,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
      };
    });

    render(
      <MedicationsContent
        patientId="patient_1"
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '服薬中薬剤' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 3, name: '見やすい薬剤一覧' }).tagName).toBe('H3');
    expect(screen.getByRole('heading', { level: 2, name: '薬学的課題と照会' }).tagName).toBe('H2');
    const issueEdit = screen.getByRole('button', { name: '薬学的課題1件目を編集' });
    expect(issueEdit.getAttribute('aria-label')).not.toMatch(/山田|アムロジピン|飲み忘れ|夕食後/);
    expect(screen.getByRole('heading', { level: 2, name: 'アレルギー・副作用歴' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByRole('heading', { level: 2, name: '残薬管理と次回提案' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'お薬手帳QR発行' }).tagName).toBe('H2');
    expect(screen.getAllByText('アムロジピン錠5mg').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'QRスキャン' }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: 'QR発行' }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: '薬剤追加' }).className).toContain('min-h-[44px]');

    fireEvent.click(screen.getByRole('button', { name: '薬剤追加' }));
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '登録' })).toBeTruthy();

    fireEvent.click(issueEdit);
    expect(screen.getByRole('dialog', { name: '薬学的課題を更新' })).toBeTruthy();
  }, 15_000);

  it('renders a submit failure as a clean assertive alert, not a raw String(error)', () => {
    // Regression: the add-medication dialog rendered {String(mutation.error)} which leaks the
    // "Error: " prefix and was not a live region. The failure must announce assertively (WCAG
    // 4.1.3) and show only the message — a direct response to the user's 登録 action.
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('登録に失敗しました: 重複した処方です'),
    });
    useQueryMock.mockImplementation(() => ({ data: { data: [] }, isLoading: false }));

    render(
      <MedicationsContent
        patientId="patient_1"
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '薬剤追加' }));

    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toBe('登録に失敗しました: 重複した処方です');
    // a raw String(new Error(msg)) renders "Error: msg" — prove that prefix is gone
    expect(alert.textContent).not.toContain('Error:');
  });
});

describe('MedicationsContent url/header convergence', () => {
  const HOSTILE = 'pt/1?x=y#z';
  const ENCODED = 'pt%2F1%3Fx%3Dy%23z';

  function buildIssue(id: string) {
    return {
      id,
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: '飲み忘れ',
      description: '夕食後薬を飲み忘れ',
      status: 'open',
      priority: 'high',
      category: 'adherence',
      identified_at: '2026-06-10T09:00:00.000Z',
      resolved_at: null,
    };
  }

  function renderMeds({
    patientId = HOSTILE,
    issues = [] as ReturnType<typeof buildIssue>[],
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
      queryConfigs.set(String((cfg.queryKey as unknown[])[0]), cfg);
      if (String((cfg.queryKey as unknown[])[0]) === 'medication-issues') {
        return { data: { data: issues }, isLoading: false };
      }
      return { data: { data: [] }, isLoading: false };
    });
    render(
      <MedicationsContent
        patientId={patientId}
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );
    return { queryConfigs, mutationConfigs, invalidateQueries };
  }

  function stubFetch() {
    return stubJsonFetch({ data: [] });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adopts buildOrgHeaders on every GET; query-filter values stay raw via URLSearchParams, patient path is single-encoded', async () => {
    const sentinel = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinel);
    const { queryConfigs } = renderMeds();
    const fetchMock = stubFetch();

    try {
      // query-filter GETs: patient_id stays semantically raw but the wire bytes are encoded
      for (const key of [
        'medication-profiles',
        'medication-issues',
        'inquiry-records',
        'residual-medications',
      ]) {
        fetchMock.mockClear();
        await queryConfigs.get(key)!.queryFn();
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const parsed = new URL(url, 'http://x');
        expect(parsed.pathname).toBe(`/api/${key}`);
        expect(parsed.searchParams.get('patient_id')).toBe(HOSTILE);
        expect(url).not.toContain('%25');
        expect(init.headers).toBe(sentinel);
        // org-scoped cache key: orgId is part of the key (tenant isolation) and the
        // raw patientId stays its own trailing segment, never encoded/altered
        expect(queryConfigs.get(key)!.queryKey).toEqual([key, 'org_1', HOSTILE]);
      }
      // path-dynamic patient summary GET: single-encoded segment
      fetchMock.mockClear();
      await queryConfigs.get('patient-medication-summary')!.queryFn();
      const [summaryUrl, summaryInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(buildPatientApiPath).toHaveBeenCalledWith(HOSTILE);
      expect(summaryUrl).toBe(`/api/patients/${ENCODED}`);
      expect(summaryUrl).not.toContain('%25');
      expect(summaryInit.headers).toBe(sentinel);
      // summary key is org-scoped too (existing orgId-last shape preserved)
      expect(queryConfigs.get('patient-medication-summary')!.queryKey).toEqual([
        'patient-medication-summary',
        HOSTILE,
        'org_1',
      ]);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['.', '..'])(
    'fails closed before any fetch for the exact dot patient id %p',
    async (dotId) => {
      const fetchMock = stubFetch();
      try {
        expect(() => renderMeds({ patientId: dotId })).toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('patient summary GET consumes the shared patient API path helper return value', async () => {
    const { queryConfigs } = renderMeds({ patientId: 'patient_1' });
    const fetchMock = stubFetch();
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_patient__');

    try {
      await queryConfigs.get('patient-medication-summary')!.queryFn();
      expect(buildPatientApiPath).toHaveBeenCalledWith('patient_1');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/patients/__helper_patient__');
      expect(fetchMock).not.toHaveBeenCalledWith('/api/patients/patient_1', expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('routes the residual adjustment link through the shared patient href helper', () => {
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__helper_residual__');

    renderMeds({ patientId: 'patient_1' });

    expect(buildPatientHref).toHaveBeenCalledWith('patient_1', '/residual-adjustment');
    expect(screen.getByRole('link', { name: '残薬調整を開く' }).getAttribute('href')).toBe(
      '/patients/__helper_residual__',
    );
  });

  it('issue status PATCH single-encodes the path issueId, adopts json helper, keeps id out of body', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs, invalidateQueries } = renderMeds();
    const fetchMock = stubFetch();
    try {
      // issueStatusMutation is the last mutation registered on the main render
      const statusMutation = mutationConfigs.at(-1)!;
      await statusMutation.mutationFn({ issueId: HOSTILE, status: 'resolved' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/medication-issues/${ENCODED}`);
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PATCH');
      expect(init.headers).toBe(sentinel);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      expect(JSON.parse(init.body as string)).toEqual({ status: 'resolved' });
      expect(init.body as string).not.toContain(HOSTILE);
      // org-scoped invalidation on success (tenant-isolated cache key)
      await act(async () => {
        await statusMutation.onSuccess?.();
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['medication-issues', 'org_1', HOSTILE],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['.', '..'])(
    'issue status PATCH fails closed before fetch for the exact dot issueId %p',
    async (dotId) => {
      const { mutationConfigs } = renderMeds();
      const fetchMock = stubFetch();
      try {
        await expect(
          mutationConfigs.at(-1)!.mutationFn({ issueId: dotId, status: 'resolved' }),
        ).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('create-issue POST keeps raw patient_id in the domain body and adopts json helper', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs } = renderMeds();
    const fetchMock = stubFetch();
    try {
      // saveIssueMutation (create branch, no editingIssue) is registered before issueStatus
      await mutationConfigs.at(-2)!.mutationFn({ title: '新規課題', priority: 'high' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/medication-issues');
      expect(init.method).toBe('POST');
      expect(init.headers).toBe(sentinel);
      // raw patient id IS domain payload on create
      expect(JSON.parse(init.body as string)).toEqual({
        patient_id: HOSTILE,
        title: '新規課題',
        priority: 'high',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('update-issue PATCH single-encodes the editing issue id and omits the path id from the body', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs } = renderMeds({ issues: [buildIssue(HOSTILE)] });
    // open the edit dialog so editingIssue is set to the hostile-id issue
    fireEvent.click(screen.getByRole('button', { name: '薬学的課題1件目を編集' }));
    const fetchMock = stubFetch();
    try {
      // after the state change, the latest saveIssueMutation closes over editingIssue
      await mutationConfigs.at(-2)!.mutationFn({ title: '更新', priority: 'low' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/medication-issues/${ENCODED}`);
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PATCH');
      expect(init.headers).toBe(sentinel);
      // update body is the form only; path id not serialized
      expect(JSON.parse(init.body as string)).toEqual({ title: '更新', priority: 'low' });
      expect(init.body as string).not.toContain(HOSTILE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['.', '..'])(
    'update-issue PATCH fails closed before fetch when the editing issue id is the exact dot %p',
    async (dotId) => {
      const { mutationConfigs } = renderMeds({ issues: [buildIssue(dotId)] });
      fireEvent.click(screen.getByRole('button', { name: '薬学的課題1件目を編集' }));
      const fetchMock = stubFetch();
      try {
        await expect(mutationConfigs.at(-2)!.mutationFn({ title: 'x' })).rejects.toThrow(
          RangeError,
        );
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('add-medication POST keeps raw patient_id in the domain body and adopts json helper', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs, invalidateQueries } = renderMeds();
    // open the add dialog so its mutation registers as the latest one
    fireEvent.click(screen.getByRole('button', { name: '薬剤追加' }));
    const fetchMock = stubFetch();
    try {
      const addMutation = mutationConfigs.at(-1)!;
      await addMutation.mutationFn({
        drug_name: 'アムロジピン',
        dose: '1錠',
        frequency: '朝食後',
        prescriber: '佐藤医師',
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/medication-profiles');
      expect(init.method).toBe('POST');
      expect(init.headers).toBe(sentinel);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      // exact domain body: no extra path/id-derived fields leak, no domain field dropped
      expect(JSON.parse(init.body as string)).toEqual({
        patient_id: HOSTILE,
        drug_name: 'アムロジピン',
        dose: '1錠',
        frequency: '朝食後',
        prescriber: '佐藤医師',
        source: 'manual',
      });
      // org-scoped invalidation on success (tenant-isolated cache key)
      await act(async () => {
        await addMutation.onSuccess?.();
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['medication-profiles', 'org_1', HOSTILE],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('MedicationsContent fetch-error surfaces (no false-empty)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderWithErrorKey(errorKey: string, options: { providePatientContext?: boolean } = {}) {
    const refetch = vi.fn();
    const providePatientContext = options.providePatientContext ?? true;
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (String(queryKey[0]) === errorKey) {
        // fetch failure: query throws → data stays undefined, isError flips true
        return { data: undefined, isLoading: false, isError: true, refetch };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });
    const patientContext: Partial<MedicationsContentPropsForTest> = providePatientContext
      ? {
          patientName: '山田花子',
          patientNameKana: 'ヤマダハナコ',
          birthDate: '1950-04-01',
          gender: 'female',
          allergyInfo: [],
        }
      : {};
    render(<MedicationsContent patientId="patient_1" {...patientContext} />);
    return { refetch };
  }

  it('uses a named skeleton while medication profiles are loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (String(queryKey[0]) === 'medication-profiles') {
        return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(
      <MedicationsContent
        patientId="patient_1"
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );

    expect(screen.getByRole('status', { name: '服薬中薬剤を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'div' })).toBeNull();
    expect(screen.queryByText(/服薬中薬剤を読み込めませんでした/)).toBeNull();
    expect(screen.queryByText('服薬中の薬剤がありません')).toBeNull();
  });

  it('uses a named skeleton while medication issues are loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (String(queryKey[0]) === 'medication-issues') {
        return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(
      <MedicationsContent
        patientId="patient_1"
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );

    expect(screen.getByRole('status', { name: '薬学的課題を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('課題を読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText(/薬学的課題を読み込めませんでした/)).toBeNull();
    expect(screen.queryByText(/課題はまだ登録されていません/)).toBeNull();
  });

  it('uses a named skeleton while inquiry records are loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (String(queryKey[0]) === 'inquiry-records') {
        return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(
      <MedicationsContent
        patientId="patient_1"
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );

    expect(screen.getByRole('status', { name: '疑義照会を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('疑義照会を読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText(/疑義照会の記録を読み込めませんでした/)).toBeNull();
    expect(screen.queryByText('疑義照会の記録はありません。')).toBeNull();
  });

  // A failed fetch must surface an error + retry, never collapse into a "0 件 / 記録なし" state
  // that masks unresolved medical issues, pending inquiries, or excess-medication warnings.
  it.each([
    ['medication-profiles', '服薬中薬剤を読み込めませんでした', '服薬中の薬剤がありません'],
    ['medication-issues', '薬学的課題を読み込めませんでした', '課題はまだ登録されていません'],
    ['inquiry-records', '疑義照会の記録を読み込めませんでした', '疑義照会の記録はありません'],
    [
      'residual-medications',
      '残薬提案を読み込めませんでした',
      '7日超の余剰や減数禁止薬の注意はまだありません',
    ],
  ])(
    'surfaces an error with retry instead of a false-empty state when %s fetch fails',
    (errorKey, errorMessage, falseEmptyText) => {
      const { refetch } = renderWithErrorKey(errorKey);

      expect(screen.getByText(new RegExp(errorMessage))).toBeTruthy();
      // the misleading empty-state copy must NOT be shown when the fetch actually failed
      expect(screen.queryByText(new RegExp(falseEmptyText))).toBeNull();

      const retryButtons = screen.getAllByRole('button', { name: '再読み込み' });
      expect(retryButtons.length).toBeGreaterThan(0);
      fireEvent.click(retryButtons[0]);
      expect(refetch).toHaveBeenCalled();
    },
  );

  // A failed source must not leak through OTHER consumers either: the count badges and the
  // side-effect history both derive from medication-issues, so an issuesQuery failure must not
  // render a confirmed 0 count or the "副作用歴はまだ登録されていません" false-empty.
  it('does not leak medication-issues failure as false-zero badges or a false-empty 副作用歴 section', () => {
    const { refetch } = renderWithErrorKey('medication-issues');

    // second consumer (side-effect history) must not collapse into its empty copy
    expect(screen.queryByText(/副作用歴はまだ登録されていません/)).toBeNull();

    // count badges must not present a confirmed 0 when the owning query failed
    expect(document.body.textContent).toContain('未解決課題 —');
    expect(document.body.textContent).toContain('副作用歴 —');
    expect(document.body.textContent).not.toContain('未解決課題 0');
    expect(document.body.textContent).not.toContain('副作用歴 0');

    // both the issue list and the side-effect section expose a retry wired to issuesQuery.refetch
    const retryButtons = screen.getAllByRole('button', { name: '再読み込み' });
    expect(retryButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(retryButtons[retryButtons.length - 1]);
    expect(refetch).toHaveBeenCalled();
  });

  it('does not leak patient summary failure as a false-empty allergy section', () => {
    const { refetch } = renderWithErrorKey('patient-medication-summary', {
      providePatientContext: false,
    });

    expect(screen.getByText(/アレルギー情報を読み込めませんでした/)).toBeTruthy();
    expect(screen.queryByText('登録なし')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps fetched patient summary allergy success rendering unchanged', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      const key = String(queryKey[0]);
      if (key === 'patient-medication-summary') {
        return {
          data: {
            name: '山田花子',
            name_kana: 'ヤマダハナコ',
            birth_date: '1950-04-01',
            gender: 'female',
            allergy_info: ['ペニシリン'],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(<MedicationsContent patientId="patient_1" />);

    expect(screen.getByText('ペニシリン')).toBeTruthy();
    expect(screen.queryByText(/アレルギー情報を読み込めませんでした/)).toBeNull();
    expect(screen.queryByText('登録なし')).toBeNull();
  });

  it('does not leak inquiry-records failure as a false-zero 回答待ち照会 badge', () => {
    renderWithErrorKey('inquiry-records');

    expect(document.body.textContent).toContain('回答待ち照会 —');
    expect(document.body.textContent).not.toContain('回答待ち照会 0');
  });
});
