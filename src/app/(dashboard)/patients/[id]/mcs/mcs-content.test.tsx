// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { PatientMcsContent } from './mcs-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

// Actual-backed spies so URL/header teeth can prove helper adoption via return-value identity.
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

type MutationOptions = {
  mutationFn?: (input?: unknown) => unknown;
  onSuccess?: (result?: unknown) => unknown;
  onError?: (error: Error) => unknown;
};

type QueryOptions = {
  queryKey: unknown;
  queryFn?: () => unknown;
};

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';

describe('PatientMcsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encodes direct MCS mutation fetch path segments while keeping patient identity raw', async () => {
    const patientId = '../settings?x=1#frag';
    const encodedPatientId = encodeURIComponent(patientId);
    const sentinelGetHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    const sentinelJsonHeaders = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelGetHeaders);
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinelJsonHeaders);
    const mutationOptions: MutationOptions[] = [];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: {
          patient: { id: patientId, name: '田中 一郎' },
          importedCount: 0,
          latestMessageAt: null,
          link: null,
          profile: null,
          summary: null,
          messages: [],
          checkLogs: [],
        },
      }),
    });
    let queryKey: unknown;
    let queryFn: (() => unknown) | undefined;

    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockImplementation((options: MutationOptions) => {
      mutationOptions.push(options);
      return { isPending: false, mutate: vi.fn() };
    });
    useQueryMock.mockImplementation(
      ({ queryKey: nextQueryKey, queryFn: nextQueryFn }: QueryOptions) => {
        queryKey = nextQueryKey;
        queryFn = nextQueryFn;
        return {
          data: {
            link: null,
            profile: null,
            summary: null,
            messages: [],
            checkLogs: [],
          },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        };
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientMcsContent patientId={patientId} />);

      expect(queryKey).toEqual(['patient-mcs', patientId, 'org_1', 30]);
      await queryFn?.();
      expect(mutationOptions).toHaveLength(3);

      await mutationOptions[0].mutationFn?.('https://www.medical-care.net/patients/2463520');
      await mutationOptions[1].mutationFn?.({
        contentType: 'report',
        summary: 'MCS投稿を確認',
        nextAction: '次回訪問で確認',
      });
      await mutationOptions[2].mutationFn?.({
        linkedStatus: 'linked',
        participationStatus: 'joined',
        pharmacyParticipants: ['薬剤師 佐藤'],
        counterpartRoles: ['visiting_nurse'],
        lastCheckedAt: null,
        note: null,
      });

      expect(fetchMock.mock.calls[0][0]).toBe(`/api/patients/${encodedPatientId}/mcs?limit=30`);
      expect(fetchMock.mock.calls[1][0]).toBe(`/api/patients/${encodedPatientId}/mcs-sync`);
      expect(fetchMock.mock.calls[2][0]).toBe(`/api/patients/${encodedPatientId}/mcs/logs`);
      expect(fetchMock.mock.calls[3][0]).toBe(`/api/patients/${encodedPatientId}/mcs`);
      for (const [url] of fetchMock.mock.calls) {
        expect(String(url)).not.toContain(patientId);
        expect(String(url)).not.toContain('%25'); // single-encode, never double-encode
      }
      // helper-return identity (toBe): GET adopts buildOrgHeaders, the 3 mutations adopt buildOrgJsonHeaders
      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toBe(sentinelGetHeaders);
      expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toBe(sentinelJsonHeaders);
      expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toBe(sentinelJsonHeaders);
      expect((fetchMock.mock.calls[3][1] as RequestInit).headers).toBe(sentinelJsonHeaders);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
        source_url: 'https://www.medical-care.net/patients/2463520',
      });
      expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({
        content_type: 'report',
        summary: 'MCS投稿を確認',
        next_action: '次回訪問で確認',
      });
      expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({
        linked_status: 'linked',
        participation_status: 'joined',
        pharmacy_participants: ['薬剤師 佐藤'],
        counterpart_roles: ['visiting_nurse'],
        last_checked_at: null,
        note: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('routes MCS query and mutation fetches through the shared patient API path helper', async () => {
    const patientId = 'patient_1';
    vi.mocked(buildPatientApiPath)
      .mockImplementationOnce((id, suffix = '') => `/api/patients/__helper_${id}__${suffix}`)
      .mockImplementationOnce((id, suffix = '') => `/api/patients/__helper_${id}__${suffix}`)
      .mockImplementationOnce((id, suffix = '') => `/api/patients/__helper_${id}__${suffix}`)
      .mockImplementationOnce((id, suffix = '') => `/api/patients/__helper_${id}__${suffix}`);
    const mutationOptions: MutationOptions[] = [];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        data: {
          patient: { id: patientId, name: '田中 一郎' },
          importedCount: 0,
          latestMessageAt: null,
          link: null,
          profile: null,
          summary: null,
          messages: [],
          checkLogs: [],
        },
      }),
    });
    let queryFn: (() => unknown) | undefined;

    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockImplementation((options: MutationOptions) => {
      mutationOptions.push(options);
      return { isPending: false, mutate: vi.fn() };
    });
    useQueryMock.mockImplementation(({ queryFn: nextQueryFn }: QueryOptions) => {
      queryFn = nextQueryFn;
      return {
        data: {
          link: null,
          profile: null,
          summary: null,
          messages: [],
          checkLogs: [],
        },
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientMcsContent patientId={patientId} />);

      await queryFn?.();
      await mutationOptions[0].mutationFn?.('https://www.medical-care.net/patients/2463520');
      await mutationOptions[1].mutationFn?.({
        contentType: 'report',
        summary: 'MCS投稿を確認',
        nextAction: '次回訪問で確認',
      });
      await mutationOptions[2].mutationFn?.({
        linkedStatus: 'linked',
        participationStatus: 'joined',
        pharmacyParticipants: ['薬剤師 佐藤'],
        counterpartRoles: ['visiting_nurse'],
        lastCheckedAt: null,
        note: null,
      });

      expect(buildPatientApiPath).toHaveBeenNthCalledWith(1, patientId, '/mcs');
      expect(buildPatientApiPath).toHaveBeenNthCalledWith(2, patientId, '/mcs-sync');
      expect(buildPatientApiPath).toHaveBeenNthCalledWith(3, patientId, '/mcs/logs');
      expect(buildPatientApiPath).toHaveBeenNthCalledWith(4, patientId, '/mcs');
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        '/api/patients/__helper_patient_1__/mcs?limit=30',
        '/api/patients/__helper_patient_1__/mcs-sync',
        '/api/patients/__helper_patient_1__/mcs/logs',
        '/api/patients/__helper_patient_1__/mcs',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['.', '..'])(
    'rejects the exact dot patient id %p with a RangeError before any MCS fetch',
    async (hostileId) => {
      const mutationOptions: MutationOptions[] = [];
      const fetchMock = vi.fn();
      let queryFn: (() => unknown) | undefined;

      useOrgIdMock.mockReturnValue('org_1');
      useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
      useMutationMock.mockImplementation((options: MutationOptions) => {
        mutationOptions.push(options);
        return { isPending: false, mutate: vi.fn() };
      });
      useQueryMock.mockImplementation(({ queryFn: nextQueryFn }: QueryOptions) => {
        queryFn = nextQueryFn;
        return {
          data: { link: null, profile: null, summary: null, messages: [], checkLogs: [] },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientMcsContent patientId={hostileId} />);

        await expect(queryFn?.()).rejects.toBeInstanceOf(RangeError);
        await expect(
          mutationOptions[0].mutationFn?.('https://www.medical-care.net/patients/1'),
        ).rejects.toBeInstanceOf(RangeError);
        await expect(
          mutationOptions[1].mutationFn?.({
            contentType: 'report',
            summary: 's',
            nextAction: '',
          }),
        ).rejects.toBeInstanceOf(RangeError);
        await expect(
          mutationOptions[2].mutationFn?.({
            linkedStatus: 'linked',
            participationStatus: 'joined',
            pharmacyParticipants: [],
            counterpartRoles: [],
            lastCheckedAt: null,
            note: null,
          }),
        ).rejects.toBeInstanceOf(RangeError);

        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('invalidates the raw patient query-key prefix from mutation callbacks', async () => {
    const patientId = 'pt/1?x=y#z';
    const mutationOptions: MutationOptions[] = [];
    const invalidateQueries = vi.fn();

    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries });
    useMutationMock.mockImplementation((options: MutationOptions) => {
      mutationOptions.push(options);
      return { isPending: false, mutate: vi.fn() };
    });
    useQueryMock.mockReturnValue({
      data: { link: null, profile: null, summary: null, messages: [], checkLogs: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId={patientId} />);
    expect(mutationOptions).toHaveLength(3);
    const [sync, checkLog, profile] = mutationOptions;
    const rawPrefix = { queryKey: ['patient-mcs', patientId, 'org_1'] };

    // sync success + error both invalidate; checkLog + profile success invalidate. All use the RAW patient id.
    await sync.onSuccess?.({ importedCount: 0, projectTitle: null, summary: null });
    await sync.onError?.(new Error('sync failed'));
    await checkLog.onSuccess?.();
    await profile.onSuccess?.();

    expect(invalidateQueries).toHaveBeenCalledTimes(4);
    for (const call of invalidateQueries.mock.calls) {
      expect(call[0]).toEqual(rawPrefix);
    }
  });

  it('keeps server messages and falls back for MCS mutation error toasts', async () => {
    const patientId = 'patient_1';
    const mutationOptions: MutationOptions[] = [];

    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockImplementation((options: MutationOptions) => {
      mutationOptions.push(options);
      return { isPending: false, mutate: vi.fn() };
    });
    useQueryMock.mockReturnValue({
      data: { link: null, profile: null, summary: null, messages: [], checkLogs: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId={patientId} />);

    expect(mutationOptions).toHaveLength(3);
    const [sync, checkLog, profile] = mutationOptions;

    await sync.onError?.(new Error('MCS同期APIからの詳細エラー'));
    expect(toast.error).toHaveBeenLastCalledWith('MCS同期APIからの詳細エラー');
    await sync.onError?.(new Error(''));
    expect(toast.error).toHaveBeenLastCalledWith('MCS 連携の同期に失敗しました');

    checkLog.onError?.(new Error('確認ログAPIからの詳細エラー'));
    expect(toast.error).toHaveBeenLastCalledWith('確認ログAPIからの詳細エラー');
    checkLog.onError?.(new Error(''));
    expect(toast.error).toHaveBeenLastCalledWith('MCS 確認ログの登録に失敗しました');

    profile.onError?.(new Error('参加情報APIからの詳細エラー'));
    expect(toast.error).toHaveBeenLastCalledWith('参加情報APIからの詳細エラー');
    profile.onError?.(new Error(''));
    expect(toast.error).toHaveBeenLastCalledWith('MCS 参加情報の保存に失敗しました');
  });

  it('shows an inline validation error and keeps actions disabled for invalid draft urls', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    useQueryMock.mockReturnValue({
      data: {
        link: {
          sourceUrl: null,
          projectTitle: null,
          projectMemo: null,
          memberCount: null,
          lastSyncAttemptAt: null,
          lastSyncedAt: null,
          lastSyncError: null,
        },
        profile: null,
        summary: null,
        messages: [],
        checkLogs: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId="patient_1" />);

    expect(screen.getByRole('heading', { level: 2, name: 'MCS 連携状況' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 2, name: 'MCS要点サマリー' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 2, name: 'MCS 確認ログ' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 2, name: '取り込み済みメッセージ' }).tagName).toBe(
      'H2',
    );

    fireEvent.change(screen.getByLabelText('MCS 連携元 URL'), {
      target: { value: 'invalid-url' },
    });

    await waitFor(() => {
      expect(
        screen.getByText('MCS の患者 URL または医療・介護側タイムライン URL を入力してください'),
      ).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: '今すぐ同期' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'MCS で開く' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '患者ページ' }).hasAttribute('disabled')).toBe(true);
  });

  it('creates an MCS check log and shows saved logs', async () => {
    const syncMutate = vi.fn();
    const checkLogMutate = vi.fn();
    const profileMutate = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock
      .mockReturnValueOnce({
        isPending: false,
        mutate: syncMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: checkLogMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: profileMutate,
      });
    useQueryMock.mockReturnValue({
      data: {
        link: {
          sourceUrl: 'https://www.medical-care.net/patients/2463520',
          patientUrl: 'https://www.medical-care.net/patients/2463520',
          projectUrl: 'https://www.medical-care.net/projects/medical/57886227',
          projectTitle: '田中一郎 在宅チーム',
          projectMemo: null,
          memberCount: 8,
          lastSyncAttemptAt: '2026-06-01T00:00:00.000Z',
          lastSyncedAt: '2026-06-01T00:00:00.000Z',
          lastSyncError: null,
        },
        profile: {
          linkedStatus: 'linked',
          participationStatus: 'joined',
          pharmacyParticipants: ['薬剤師 佐藤'],
          counterpartRoles: ['visiting_nurse'],
          lastCheckedAt: '2026-06-16T00:00:00.000Z',
          note: '毎朝確認',
          updatedAt: '2026-06-16T00:05:00.000Z',
        },
        summary: null,
        messages: [],
        checkLogs: [
          {
            id: 'mcs_log_1',
            subject: 'MCS 報告確認',
            content: '食欲低下の共有を確認',
            counterpartName: '田中一郎 在宅チーム',
            occurredAt: '2026-06-16T00:00:00.000Z',
            createdAt: '2026-06-16T00:01:00.000Z',
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId="patient_1" />);

    expect(screen.getByText('食欲低下の共有を確認')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('要約'), {
      target: { value: '訪看からの転倒リスク共有を確認' },
    });
    fireEvent.change(screen.getByLabelText('次アクション'), {
      target: { value: '次回訪問でふらつきを確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: '確認ログを登録' }));

    expect(checkLogMutate).toHaveBeenCalledWith({
      contentType: 'report',
      summary: '訪看からの転倒リスク共有を確認',
      nextAction: '次回訪問でふらつきを確認',
    });
    expect(syncMutate).not.toHaveBeenCalled();
    expect(profileMutate).not.toHaveBeenCalled();
  });

  it('updates the MCS participation profile from the profile panel', async () => {
    const syncMutate = vi.fn();
    const checkLogMutate = vi.fn();
    const profileMutate = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock
      .mockReturnValueOnce({
        isPending: false,
        mutate: syncMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: checkLogMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: profileMutate,
      });
    useQueryMock.mockReturnValue({
      data: {
        link: {
          sourceUrl: 'https://www.medical-care.net/patients/2463520',
          patientUrl: 'https://www.medical-care.net/patients/2463520',
          projectUrl: 'https://www.medical-care.net/projects/medical/57886227',
          projectTitle: '田中一郎 在宅チーム',
          projectMemo: null,
          memberCount: 8,
          lastSyncAttemptAt: '2026-06-01T00:00:00.000Z',
          lastSyncedAt: '2026-06-01T00:00:00.000Z',
          lastSyncError: null,
        },
        profile: null,
        summary: null,
        messages: [],
        checkLogs: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('MCS連携'), {
      target: { value: 'linked' },
    });
    fireEvent.change(screen.getByLabelText('参加状況'), {
      target: { value: 'joined' },
    });
    fireEvent.change(screen.getByLabelText('薬局側参加者'), {
      target: { value: '薬剤師 佐藤\n事務 鈴木' },
    });
    fireEvent.click(screen.getByLabelText('訪問看護'));
    fireEvent.click(screen.getByLabelText('ケアマネ'));
    fireEvent.change(screen.getByLabelText('最終確認日時'), {
      target: { value: '2026-06-16T09:00' },
    });
    fireEvent.change(screen.getByLabelText('備考'), {
      target: { value: '訪問看護投稿を毎朝確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: '参加情報を保存' }));

    expect(profileMutate).toHaveBeenCalledWith({
      linkedStatus: 'linked',
      participationStatus: 'joined',
      pharmacyParticipants: ['薬剤師 佐藤', '事務 鈴木'],
      counterpartRoles: ['visiting_nurse', 'care_manager'],
      lastCheckedAt: expect.stringMatching(/^2026-06-16T/),
      note: '訪問看護投稿を毎朝確認',
    });
    expect(syncMutate).not.toHaveBeenCalled();
    expect(checkLogMutate).not.toHaveBeenCalled();
  });

  it('copies the MCS URL and supports one-click last-check updates', async () => {
    const syncMutate = vi.fn();
    const checkLogMutate = vi.fn();
    const profileMutate = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock
      .mockReturnValueOnce({
        isPending: false,
        mutate: syncMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: checkLogMutate,
      })
      .mockReturnValueOnce({
        isPending: false,
        mutate: profileMutate,
      });
    useQueryMock.mockReturnValue({
      data: {
        link: {
          sourceUrl: 'https://www.medical-care.net/patients/2463520',
          patientUrl: 'https://www.medical-care.net/patients/2463520',
          projectUrl: 'https://www.medical-care.net/projects/medical/57886227',
          projectTitle: '田中一郎 在宅チーム',
          projectMemo: null,
          memberCount: 8,
          lastSyncAttemptAt: '2026-06-01T00:00:00.000Z',
          lastSyncedAt: '2026-06-01T00:00:00.000Z',
          lastSyncError: null,
        },
        profile: {
          linkedStatus: 'linked',
          participationStatus: 'joined',
          pharmacyParticipants: ['薬剤師 佐藤'],
          counterpartRoles: ['visiting_nurse'],
          lastCheckedAt: null,
          note: null,
          updatedAt: null,
        },
        summary: null,
        messages: [],
        checkLogs: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId="patient_1" />);

    fireEvent.click(screen.getByRole('button', { name: 'URLをコピー' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'https://www.medical-care.net/projects/medical/57886227',
      );
    });

    writeText.mockRejectedValueOnce(new Error('クリップボードAPIからの詳細エラー'));
    fireEvent.click(screen.getByRole('button', { name: 'URLをコピー' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenLastCalledWith('クリップボードAPIからの詳細エラー'),
    );

    writeText.mockRejectedValueOnce(new Error(''));
    fireEvent.click(screen.getByRole('button', { name: 'URLをコピー' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenLastCalledWith('MCS URLのコピーに失敗しました'),
    );

    fireEvent.click(screen.getByRole('button', { name: '最終確認を今に更新' }));

    expect(profileMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedStatus: 'linked',
        participationStatus: 'joined',
        pharmacyParticipants: ['薬剤師 佐藤'],
        counterpartRoles: ['visiting_nurse'],
        lastCheckedAt: expect.any(String),
      }),
    );
    expect(syncMutate).not.toHaveBeenCalled();
    expect(checkLogMutate).not.toHaveBeenCalled();
  });
});
