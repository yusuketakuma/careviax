// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { PatientMcsOverviewQueryError } from '@/lib/patient-mcs/query';
import { PatientMcsContent } from './mcs-content';
import {
  createJsonResponse,
  createLinkedMcsQueryResult,
  createLoadingMcsQueryResult,
  patientMcsEmptyResponsePayload,
  type MutationOptions,
  type QueryOptions,
} from './mcs-content.test-fixtures';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const clientLogWarnMock = vi.hoisted(() => vi.fn());

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

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('@/lib/utils/client-log', () => ({
  clientLog: { warn: clientLogWarnMock },
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
    useOrgIdMock.mockReset();
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useQueryClientMock.mockReset();
  });

  it('shows an MCS overview skeleton instead of a generic spinner while org context loads', () => {
    useOrgIdMock.mockReturnValue('');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId="patient_1" />);

    expect(screen.getByRole('status', { name: 'MCS 連携情報を読み込み中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'MCS 連携情報を読み込み中...' })).toBeNull();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'MCS 連携状況' })).toBeNull();
    expect(screen.queryByText('MCS 同期に失敗しました')).toBeNull();
  });

  it('shows an MCS message skeleton without rendering message PHI while messages load', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    useQueryMock.mockReturnValue(createLoadingMcsQueryResult());

    render(<PatientMcsContent patientId="patient_1" />);

    expect(screen.getByRole('status', { name: 'MCS メッセージを読み込み中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'MCS メッセージを読み込み中...' })).toBeNull();
    expect(screen.queryByText('MCS メッセージを読み込み中...')).toBeNull();
    expect(screen.queryByText('訪問看護 太郎')).toBeNull();
    expect(screen.queryByText(/血圧と服薬状況/)).toBeNull();
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
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(createJsonResponse(patientMcsEmptyResponsePayload(patientId))),
      );
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
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(createJsonResponse(patientMcsEmptyResponsePayload(patientId))),
      );
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

  it('keeps raw mutation errors out of MCS toasts and logs only static context', async () => {
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
    const syncError = new Error('患者A 090-1234-5678 token=sync-secret の同期に失敗しました');
    const checkLogError = new Error('患者A token=log-secret の確認ログに失敗しました');
    const profileError = new Error('患者A https://mcs.example.test/patient/1 の保存に失敗しました');

    await sync.onError?.(syncError);
    expect(toast.error).toHaveBeenLastCalledWith(
      'MCS 連携の同期に失敗しました。連携元URLと通信状態を確認してからもう一度お試しください。',
    );
    expect(clientLogWarnMock).toHaveBeenLastCalledWith('patient_mcs.sync_failed', syncError, {
      route: '/patients/:id/mcs',
      entityType: 'patient_mcs_sync',
    });

    checkLog.onError?.(checkLogError);
    expect(toast.error).toHaveBeenLastCalledWith(
      'MCS 確認ログの登録に失敗しました。入力内容を確認してからもう一度お試しください。',
    );
    expect(clientLogWarnMock).toHaveBeenLastCalledWith(
      'patient_mcs.check_log_create_failed',
      checkLogError,
      { route: '/patients/:id/mcs', entityType: 'patient_mcs_check_log' },
    );

    profile.onError?.(profileError);
    expect(toast.error).toHaveBeenLastCalledWith(
      'MCS 参加情報の保存に失敗しました。入力内容を確認してからもう一度お試しください。',
    );
    expect(clientLogWarnMock).toHaveBeenLastCalledWith(
      'patient_mcs.profile_save_failed',
      profileError,
      { route: '/patients/:id/mcs', entityType: 'patient_mcs_profile' },
    );
    const rawValues = ['090-1234-5678', 'sync-secret', 'log-secret', 'mcs.example.test'];
    for (const rawValue of rawValues) {
      expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain(rawValue);
      expect(
        JSON.stringify(clientLogWarnMock.mock.calls.map(([, , context]) => context)),
      ).not.toContain(rawValue);
    }
  });

  it('uses HTTP status without server messages for MCS mutation recovery guidance', async () => {
    const patientId = 'patient_1';
    const mutationOptions: MutationOptions[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse(
          { code: 'WORKFLOW_CONFLICT', message: '患者A token=sync-response-secret' },
          409,
        ),
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          { code: 'WORKFLOW_CONFLICT', message: '患者A token=check-response-secret' },
          409,
        ),
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          { code: 'WORKFLOW_CONFLICT', message: '患者A token=profile-response-secret' },
          409,
        ),
      );

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
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientMcsContent patientId={patientId} />);

      expect(mutationOptions).toHaveLength(3);
      const syncError = await mutationOptions[0]
        .mutationFn?.('https://www.medical-care.net/patients/2463520')
        .catch((error: unknown) => error);
      const checkLogError = await mutationOptions[1]
        .mutationFn?.({
          contentType: 'report',
          summary: 'MCS投稿を確認',
          nextAction: '',
        })
        .catch((error: unknown) => error);
      const profileError = await mutationOptions[2]
        .mutationFn?.({
          linkedStatus: 'linked',
          participationStatus: 'joined',
          pharmacyParticipants: ['薬剤師 佐藤'],
          counterpartRoles: ['visiting_nurse'],
          lastCheckedAt: null,
          note: null,
        })
        .catch((error: unknown) => error);

      for (const error of [syncError, checkLogError, profileError]) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain('token=');
      }

      await mutationOptions[0].onError?.(syncError as Error);
      expect(toast.error).toHaveBeenLastCalledWith(
        '連携先と現在の患者情報が一致しないため同期できませんでした。連携元URLを確認してください。',
      );
      expect(clientLogWarnMock).toHaveBeenLastCalledWith('patient_mcs.sync_failed', syncError, {
        route: '/patients/:id/mcs',
        entityType: 'patient_mcs_sync',
        status: 409,
      });

      mutationOptions[1].onError?.(checkLogError as Error);
      expect(toast.error).toHaveBeenLastCalledWith(
        'MCS 確認ログの登録に失敗しました。入力内容を確認してからもう一度お試しください。',
      );
      mutationOptions[2].onError?.(profileError as Error);
      expect(toast.error).toHaveBeenLastCalledWith(
        'MCS 参加情報の保存に失敗しました。入力内容を確認してからもう一度お試しください。',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects mixed-root MCS mutation responses without exposing response details', async () => {
    const patientId = 'patient_1';
    const mutationOptions: MutationOptions[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            importedCount: 0,
            latestMessageAt: null,
            link: null,
            summary: null,
          },
          patient_name: '患者A token=sync-response-secret',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          data: { log: { id: 'mcs_log_1' } },
          message: '患者A token=check-response-secret',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          data: { profile: { linked_status: 'linked' } },
          message: '患者A token=profile-response-secret',
        }),
      );

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
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientMcsContent patientId={patientId} />);

      expect(mutationOptions).toHaveLength(3);
      const mutationCalls: Array<{
        run: () => Promise<unknown> | undefined;
        fallbackMessage: string;
        secret: string;
      }> = [
        {
          run: () =>
            mutationOptions[0].mutationFn?.('https://www.medical-care.net/patients/2463520'),
          fallbackMessage:
            'MCS 連携の同期に失敗しました。連携元URLと通信状態を確認してからもう一度お試しください。',
          secret: 'sync-response-secret',
        },
        {
          run: () =>
            mutationOptions[1].mutationFn?.({
              contentType: 'report',
              summary: 'MCS投稿を確認',
              nextAction: '',
            }),
          fallbackMessage:
            'MCS 確認ログの登録に失敗しました。入力内容を確認してからもう一度お試しください。',
          secret: 'check-response-secret',
        },
        {
          run: () =>
            mutationOptions[2].mutationFn?.({
              linkedStatus: 'linked',
              participationStatus: 'joined',
              pharmacyParticipants: ['薬剤師 佐藤'],
              counterpartRoles: ['visiting_nurse'],
              lastCheckedAt: null,
              note: null,
            }),
          fallbackMessage:
            'MCS 参加情報の保存に失敗しました。入力内容を確認してからもう一度お試しください。',
          secret: 'profile-response-secret',
        },
      ];

      for (const { run, fallbackMessage, secret } of mutationCalls) {
        const error = await run()?.catch((cause: unknown) => cause);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(fallbackMessage);
        expect((error as Error).message).not.toContain(secret);
        expect((error as Error).message).not.toContain('患者A');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    [
      new Error('患者A 090-1234-5678 https://mcs.example.test/patient/1 token=query-secret'),
      {
        cause: 'MCS 連携情報を取得できませんでした。',
        nextAction: '通信状態を確認してから再読み込みしてください。',
      },
    ],
    [
      new PatientMcsOverviewQueryError(
        'forbidden',
        '患者A https://mcs.example.test/patient/1 token=forbidden-secret',
      ),
      {
        cause: 'MCS 連携情報を表示する権限がありません。',
        nextAction: '権限を確認してから再読み込みしてください。',
      },
    ],
  ])('keeps overview error output PHI-safe and retryable', async (error, expected) => {
    const refetch = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error,
      refetch,
    });

    render(<PatientMcsContent patientId="patient_1" />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(expected.cause);
    expect(alert.textContent).toContain(expected.nextAction);
    expect(
      screen.getByRole('heading', { level: 2, name: 'MCS 連携情報を表示できません' }),
    ).toBeTruthy();
    expect(screen.queryByText(error.message)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(clientLogWarnMock).toHaveBeenCalledWith('patient_mcs.overview_fetch_failed', error, {
        route: '/patients/:id/mcs',
        entityType: 'patient_mcs',
      });
    });
    expect(
      JSON.stringify(clientLogWarnMock.mock.calls.map(([, , context]) => context)),
    ).not.toContain('mcs.example.test');
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
    useQueryMock.mockReturnValue(createLinkedMcsQueryResult());

    render(<PatientMcsContent patientId="patient_1" />);

    expect(screen.getByText('食欲低下の共有を確認')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('要約'), {
      target: { value: '訪看からの転倒リスク共有を確認' },
    });
    fireEvent.change(screen.getByLabelText('次アクション'), {
      target: { value: '次回訪問でふらつきを確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: '確認ログを登録' }));

    expect(checkLogMutate).toHaveBeenCalledWith(
      {
        contentType: 'report',
        summary: '訪看からの転倒リスク共有を確認',
        nextAction: '次回訪問でふらつきを確認',
      },
      { onSuccess: expect.any(Function) },
    );
    expect((screen.getByLabelText('要約') as HTMLTextAreaElement).value).toBe(
      '訪看からの転倒リスク共有を確認',
    );
    expect((screen.getByLabelText('次アクション') as HTMLInputElement).value).toBe(
      '次回訪問でふらつきを確認',
    );
    const [, mutationCallbacks] = checkLogMutate.mock.calls[0] ?? [];
    expect(mutationCallbacks).toEqual({ onSuccess: expect.any(Function) });
    act(() => {
      (mutationCallbacks as { onSuccess: () => void }).onSuccess();
    });
    expect((screen.getByLabelText('要約') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText('次アクション') as HTMLInputElement).value).toBe('');
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

    const rawClipboardError = new Error(
      '患者A https://mcs.example.test/project/1 token=clipboard-secret のコピーに失敗しました',
    );
    writeText.mockRejectedValueOnce(rawClipboardError);
    fireEvent.click(screen.getByRole('button', { name: 'URLをコピー' }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenLastCalledWith(
        'MCS URLのコピーに失敗しました。ブラウザの設定を確認してからもう一度お試しください。',
      );
      expect(clientLogWarnMock).toHaveBeenLastCalledWith(
        'patient_mcs.copy_url_failed',
        rawClipboardError,
        { route: '/patients/:id/mcs', entityType: 'patient_mcs' },
      );
    });
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain('clipboard-secret');
    expect(
      JSON.stringify(clientLogWarnMock.mock.calls.map(([, , context]) => context)),
    ).not.toContain('clipboard-secret');

    writeText.mockRejectedValueOnce(new Error(''));
    fireEvent.click(screen.getByRole('button', { name: 'URLをコピー' }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenLastCalledWith(
        'MCS URLのコピーに失敗しました。ブラウザの設定を確認してからもう一度お試しください。',
      );
    });

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
