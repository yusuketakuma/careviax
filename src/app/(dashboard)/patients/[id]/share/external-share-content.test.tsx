// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { PrimaryQueryError } from '@/lib/api/primary-query-json';
import {
  buildCommunicationRequestApiPath,
  buildCommunicationRequestsApiPath,
} from '@/lib/communications/api-paths';
import {
  PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
  PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
  type PatientArchiveSummary,
} from '@/lib/patient/archive-summary';
import { buildTasksApiPath } from '@/lib/tasks/api-paths';

const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());
const useAuthStoreMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/stores/auth-store', () => ({
  useAuthStore: useAuthStoreMock,
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

vi.mock('@/lib/communications/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/communications/api-paths')>();
  return {
    ...actual,
    buildCommunicationRequestApiPath: vi.fn(actual.buildCommunicationRequestApiPath),
    buildCommunicationRequestsApiPath: vi.fn(actual.buildCommunicationRequestsApiPath),
  };
});

vi.mock('@/lib/tasks/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/tasks/api-paths')>();
  return { ...actual, buildTasksApiPath: vi.fn(actual.buildTasksApiPath) };
});

import { ExternalShareContent } from './external-share-content';

setupDomTestEnv();

type QueryConfig = {
  queryKey?: unknown[];
  queryFn?: () => Promise<unknown>;
  enabled?: boolean;
};

type MutationConfig = {
  mutationFn?: () => Promise<unknown>;
  onSuccess?: (data: unknown) => Promise<void> | void;
  onError?: (error: unknown) => Promise<void> | void;
};

const ACTIVE_PATIENT_ARCHIVE = {
  status: 'active',
  archived: false,
  archived_at: null,
} as const;

const ARCHIVED_PATIENT_ARCHIVE = {
  status: 'archived',
  archived: true,
  archived_at: '2026-06-30T09:00:00.000Z',
} as const;

const FULL_PATIENT_SHARE_PERMISSIONS = {
  can_create_external_share: true,
  can_create_reply_request: true,
  can_create_followup_task: true,
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

beforeEach(() => {
  useAuthStoreMock.mockImplementation(
    (selector: (state: { currentUser: { id: string; role: string } }) => unknown) =>
      selector({ currentUser: { id: 'user_1', role: 'pharmacist' } }),
  );
});

describe('ExternalShareContent', () => {
  it('does not enable PHI queries before the authorization fingerprint is hydrated', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useAuthStoreMock.mockImplementation(
      (selector: (state: { currentUser: { id: null; role: null } }) => unknown) =>
        selector({ currentUser: { id: null, role: null } }),
    );
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    render(<ExternalShareContent patientId="patient_1" />);

    const overviewQuery = useQueryMock.mock.calls.find(
      ([config]) => (config as QueryConfig).queryKey?.[0] === 'external-share-overview',
    )?.[0] as QueryConfig | undefined;
    expect(overviewQuery?.enabled).toBe(false);
    expect(screen.getByRole('status', { name: '患者共有ワークスペースを読み込み中' })).toBeTruthy();
  });

  it('shows a share workspace skeleton instead of a generic spinner while loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.getByRole('status', { name: '患者共有ワークスペースを読み込み中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: '共有設定' })).toBeNull();
    expect(screen.queryByText('田中ケアマネジャー')).toBeNull();
  });

  it('renders share setup and history with semantic section headings', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: {
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [
          {
            id: 'share_1',
            granted_to_name: '田中ケアマネジャー',
            expires_at: '2026-06-03T00:00:00.000Z',
            accessed_at: null,
          },
        ],
        self_reports: [
          {
            id: 'report_1',
            subject: '疼痛の相談',
            created_at: '2026-06-01T00:00:00.000Z',
            status: 'open',
          },
        ],
      },
      isLoading: false,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.getByRole('heading', { level: 2, name: '共有設定' }).tagName).toBe('H2');
    expect(
      screen.getByRole('heading', { level: 2, name: '共有済みリンクと連絡文脈' }).tagName,
    ).toBe('H2');
    expect(screen.getByRole('button', { name: /共有リンクを発行/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /他職種受信サマリー/ })).toBeTruthy();
    expect(screen.getByText('田中ケアマネジャー')).toBeTruthy();
    expect(screen.getByText('疼痛の相談')).toBeTruthy();
  });

  it('pins exact patient identity before share actions without truncating the identifiers', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: {
        id: 'patient_1',
        display_id: 'PT-0001042',
        name: '共有対象患者 長い氏名でも省略しない',
        name_kana: 'キョウユウタイショウカンジャ ナガイシメイデモショウリャクシナイ',
        birth_date: '1948-02-03T00:00:00.000Z',
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [],
        self_reports: [],
        current_medications: [],
        visit_schedules: [],
        care_reports: [],
      },
      isLoading: false,
      isError: false,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    const patientContext = screen.getByRole('region', { name: '患者情報' });
    expect(patientContext.textContent).toContain('共有対象患者 長い氏名でも省略しない');
    expect(patientContext.textContent).toContain(
      'キョウユウタイショウカンジャ ナガイシメイデモショウリャクシナイ',
    );
    expect(patientContext.textContent).toContain('1948/02/03');
    expect(patientContext.textContent).toContain('患者ID');
    expect(patientContext.textContent).toContain('PT-0001042');
    expect(patientContext.getAttribute('data-sticky')).toBe('true');
    expect(patientContext.querySelector('.truncate')).toBeNull();
    expect(
      patientContext.compareDocumentPosition(
        screen.getByRole('button', { name: /共有リンクを発行/ }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps share setup validation errors visible inline', () => {
    const mutate = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate, isPending: false });
    useQueryMock.mockReturnValue({
      data: {
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [],
        self_reports: [],
      },
      isLoading: false,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    const submitButton = screen.getByRole('button', { name: /共有リンクを発行/ });
    const nameInput = screen.getByLabelText('共有先氏名');

    fireEvent.click(submitButton);

    expect(screen.getByRole('alert').textContent).toBe('共有先氏名は必須です');
    expect(nameInput.getAttribute('aria-invalid')).toBe('true');
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.change(nameInput, { target: { value: '田中ケアマネジャー' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /服薬情報/ }));
    fireEvent.click(submitButton);

    expect(screen.getByRole('alert').textContent).toBe('共有する情報を1つ以上選択してください');
    expect(
      screen.getByRole('group', { name: '共有する情報' }).getAttribute('aria-describedby'),
    ).toBe('share-scope-error');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('encodes hostile patient and reply request ids in API paths while keeping query/body identities raw', async () => {
    const patientId = 'patient/1?tab=x#frag';
    const requestId = 'request/1?x=y#frag';
    const queryConfigs: QueryConfig[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/care-team')) {
        return new Response(
          JSON.stringify({
            data: [],
            meta: { patient_id: patientId, case_id: null, cases: [] },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/contacts')) {
        return new Response(
          JSON.stringify({
            data: [],
            meta: {
              patient_id: patientId,
              expected_updated_at: '2026-06-01T00:00:00.000Z',
              version_basis: 'patient_updated_at',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/patients/')) {
        return new Response(
          JSON.stringify({
            data: {
              id: patientId,
              display_id: 'PT-0001042',
              name: '佐藤 花子',
              name_kana: 'サトウ ハナコ',
              birth_date: '1948-02-03T00:00:00.000Z',
              archived_at: null,
              patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
              external_shares: [],
              self_reports: [],
              current_medications: [],
              visit_schedules: [],
              care_reports: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/communication-requests?')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: requestId,
                patient_id: patientId,
                request_type: 'patient_share_reply_request',
                recipient_role: 'care_manager',
                recipient_name: '田中ケアマネ',
                related_entity_type: 'patient',
                related_entity_id: patientId,
                status: 'responded',
                subject: '共有確認',
                requested_at: '2026-06-01T00:00:00.000Z',
                responses: [
                  {
                    id: 'response_1',
                    responder_name: '田中ケアマネ',
                    responded_at: '2026-06-02T00:00:00.000Z',
                  },
                ],
              },
            ],
            meta: { limit: 50, has_more: false, next_cursor: null },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/communication-requests/')) {
        return new Response(
          JSON.stringify({
            data: {
              id: requestId,
              patient_id: patientId,
              request_type: 'patient_share_reply_request',
              related_entity_type: 'patient',
              related_entity_id: patientId,
              responses: [
                {
                  id: 'response_1',
                  responder_name: '田中ケアマネ',
                  content: '確認しました',
                  responded_at: '2026-06-02T00:00:00.000Z',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      queryConfigs.push(config);
      const scope = config.queryKey?.[0];
      if (scope === 'communication-requests') {
        return {
          data: {
            data: [
              {
                id: requestId,
                recipient_role: 'care_manager',
                recipient_name: '田中ケアマネ',
                status: 'responded',
                subject: '共有確認',
                requested_at: '2026-06-01T00:00:00.000Z',
                responses: [{ id: 'response_1', responded_at: '2026-06-02T00:00:00.000Z' }],
              },
            ],
          },
          isLoading: false,
        };
      }
      return {
        data: {
          name: '佐藤 花子',
          archive: ACTIVE_PATIENT_ARCHIVE,
          patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
          external_shares: [],
          self_reports: [],
          current_medications: [],
          visit_schedules: [],
          care_reports: [],
        },
        isLoading: false,
      };
    });

    render(<ExternalShareContent patientId={patientId} />);

    for (const scope of [
      'external-share-overview',
      'patient-care-team',
      'patient-contacts',
      'communication-requests',
      'communication-request',
    ]) {
      const query = queryConfigs.find((config) => config.queryKey?.[0] === scope);
      expect(query).toBeTruthy();
      await query?.queryFn?.();
    }

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toContain(`/api/patients/${encodeURIComponent(patientId)}`);
    expect(urls).toContain(`/api/patients/${encodeURIComponent(patientId)}/care-team`);
    expect(urls).toContain(`/api/patients/${encodeURIComponent(patientId)}/contacts`);
    expect(urls).toContain(`/api/communication-requests/${encodeURIComponent(requestId)}`);

    for (const url of urls.filter(
      (value) =>
        value.startsWith('/api/patients/') || value.startsWith('/api/communication-requests/'),
    )) {
      expect(url).not.toContain('patient/1');
      expect(url).not.toContain('request/1');
      expect(url).not.toContain('?tab=');
      expect(url).not.toContain('?x=');
      expect(url).not.toContain('#frag');
      expect(url).not.toContain('%25');
    }

    const requestListUrl = urls.find((url) => url.startsWith('/api/communication-requests?'));
    expect(requestListUrl).toBeTruthy();
    const params = new URLSearchParams(requestListUrl?.split('?')[1]);
    expect(params.get('request_type')).toBe('patient_share_reply_request');
    expect(params.get('related_entity_id')).toBe(patientId);
    expect(requestListUrl).toContain('request_type=patient_share_reply_request');
    expect(requestListUrl).toContain(`related_entity_id=${encodeURIComponent(patientId)}`);
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
    expect(vi.mocked(buildCommunicationRequestsApiPath)).toHaveBeenCalledWith({
      requestType: 'patient_share_reply_request',
      relatedEntityType: 'patient',
      relatedEntityId: patientId,
    });
    expect(vi.mocked(buildCommunicationRequestApiPath)).toHaveBeenCalledWith(requestId);
  });

  it('patient share request query follows a second cursor page before declaring the list complete', async () => {
    const queryConfigs: QueryConfig[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      expect(init?.headers).toEqual({ 'x-org-id': 'org_1' });
      const cursor = url.searchParams.get('cursor');
      const row = {
        id: cursor ? 'request_1' : 'request_2',
        patient_id: 'patient_1',
        request_type: 'patient_share_reply_request',
        recipient_name: '田中',
        recipient_role: 'care_manager',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        status: 'sent',
        subject: '共有確認',
        requested_at: cursor ? '2026-07-11T00:00:00.000Z' : '2026-07-12T00:00:00.000Z',
        responses: [],
      };
      return new Response(
        JSON.stringify({
          data: [row],
          meta: {
            limit: 100,
            has_more: !cursor,
            next_cursor: cursor ? null : 'cursor_1',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      queryConfigs.push(config);
      return {
        data: config.queryKey?.[0] === 'communication-requests' ? { data: [] } : {},
        isLoading: false,
        isError: false,
      };
    });

    render(<ExternalShareContent patientId="patient_1" />);
    const requestQuery = queryConfigs.find(
      (config) => config.queryKey?.[0] === 'communication-requests',
    );
    const result = (await requestQuery?.queryFn?.()) as { data: Array<{ id: string }> };

    expect(result.data.map((item) => item.id)).toEqual(['request_2', 'request_1']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('cursor=cursor_1');
  });

  it('keeps the primary patient query error generic while surfacing supporting-query messages', async () => {
    const patientId = 'patient_1';
    const requestId = 'request_1';
    const queryConfigs: QueryConfig[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === `/api/patients/${patientId}`) {
        return new Response(JSON.stringify({ message: '共有状況の閲覧権限がありません' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === `/api/patients/${patientId}/care-team`) {
        return new Response(JSON.stringify({ message: 'ケアチームの閲覧権限がありません' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === `/api/patients/${patientId}/contacts`) {
        return new Response(JSON.stringify({ message: '連絡先の閲覧権限がありません' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/api/communication-requests?')) {
        return new Response(JSON.stringify({ message: '返信状況の閲覧権限がありません' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === `/api/communication-requests/${requestId}`) {
        return new Response(JSON.stringify({ message: '返信内容の閲覧権限がありません' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      queryConfigs.push(config);
      const scope = config.queryKey?.[0];
      if (scope === 'communication-requests') {
        return {
          data: {
            data: [
              {
                id: requestId,
                recipient_role: 'care_manager',
                recipient_name: '田中ケアマネ',
                status: 'responded',
                subject: '共有確認',
                requested_at: '2026-06-01T00:00:00.000Z',
                responses: [{ id: 'response_1', responded_at: '2026-06-02T00:00:00.000Z' }],
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      return {
        data: {
          name: '佐藤 花子',
          archive: ACTIVE_PATIENT_ARCHIVE,
          patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
          external_shares: [],
          self_reports: [],
          current_medications: [],
          visit_schedules: [],
          care_reports: [],
        },
        isLoading: false,
        isError: false,
      };
    });

    render(<ExternalShareContent patientId={patientId} />);

    const overviewQuery = queryConfigs.find(
      (config) => config.queryKey?.[0] === 'external-share-overview',
    );
    const careTeamQuery = queryConfigs.find(
      (config) => config.queryKey?.[0] === 'patient-care-team',
    );
    const contactsQuery = queryConfigs.find(
      (config) => config.queryKey?.[0] === 'patient-contacts',
    );
    const requestsQuery = queryConfigs.find(
      (config) => config.queryKey?.[0] === 'communication-requests',
    );
    const replyDetailQuery = queryConfigs.find(
      (config) => config.queryKey?.[0] === 'communication-request',
    );

    await expect(overviewQuery?.queryFn?.()).rejects.toThrow('共有状況を取得できませんでした');
    await expect(careTeamQuery?.queryFn?.()).rejects.toThrow('ケアチームの閲覧権限がありません');
    await expect(contactsQuery?.queryFn?.()).rejects.toThrow('連絡先の閲覧権限がありません');
    await expect(requestsQuery?.queryFn?.()).rejects.toThrow('返信状況の取得に失敗しました');
    await expect(replyDetailQuery?.queryFn?.()).rejects.toThrow('返信内容の閲覧権限がありません');
  });

  it('accepts the provider SMS grant shape without exposing or rendering an OTP', async () => {
    const mutationConfigs: MutationConfig[] = [];
    const token = `${'a'.repeat(24)}.${'b'.repeat(24)}.${'c'.repeat(24)}`;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('/api/external-access');
      expect(init?.method).toBe('POST');
      const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(requestBody.patient_id).toBe('patient_1');
      expect(requestBody).not.toHaveProperty('display_id');
      expect(requestBody).not.toHaveProperty('name');
      expect(requestBody).not.toHaveProperty('name_kana');
      expect(requestBody).not.toHaveProperty('birth_date');
      return new Response(
        JSON.stringify({
          data: {
            token,
            expires_at: '2026-07-20T00:00:00.000Z',
            otp_delivery: 'sms',
            otp_delivery_destination: '090****5678',
            token_hash: 'must-be-stripped',
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    useQueryMock.mockReturnValue({
      data: {
        display_id: 'PT-0001042',
        name: '佐藤 花子',
        name_kana: 'サトウ ハナコ',
        birth_date: '1948-02-03T00:00:00.000Z',
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [],
        self_reports: [],
        current_medications: [],
        visit_schedules: [],
        care_reports: [],
      },
      isLoading: false,
      isError: false,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    const result = await mutationConfigs[0]?.mutationFn?.();
    expect(result).toEqual({
      data: {
        shareUrl: `${window.location.origin}/shared/${token}`,
        otp: null,
        expiresAt: '2026-07-20T00:00:00.000Z',
        otpDelivery: 'sms',
        otpDeliveryDestination: '090****5678',
      },
    });

    await act(async () => {
      await mutationConfigs[0]?.onSuccess?.(result);
    });
    expect(screen.queryByLabelText('OTP')).toBeNull();
    expect(screen.getByText(/OTPは画面には表示されません/)).toBeTruthy();
  });

  it('patient、organization、またはactor切替時に旧共有URL・OTP・宛先stateを同期的に破棄する', async () => {
    const mutationConfigs: MutationConfig[] = [];
    let authState = { currentUser: { id: 'user_1', role: 'pharmacist' } };
    useAuthStoreMock.mockImplementation((selector: (state: typeof authState) => unknown) =>
      selector(authState),
    );
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    useQueryMock.mockReturnValue({
      data: {
        name: '佐藤 花子',
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [],
        self_reports: [],
        current_medications: [],
        visit_schedules: [],
        care_reports: [],
      },
      isLoading: false,
      isError: false,
    });

    const view = render(<ExternalShareContent patientId="patient_1" />);
    fireEvent.change(screen.getByLabelText('共有先氏名'), { target: { value: '田中 太郎' } });
    fireEvent.change(screen.getByLabelText('共有先連絡先（任意）'), {
      target: { value: '090-0000-0000' },
    });
    await act(async () => {
      await mutationConfigs[0]?.onSuccess?.({
        data: {
          shareUrl: 'https://example.test/shared/patient-1-token',
          otp: '123456',
          expiresAt: '2026-07-20T00:00:00.000Z',
          otpDelivery: 'manual',
          otpDeliveryDestination: null,
        },
      });
    });
    expect((screen.getByLabelText('共有URL') as HTMLInputElement).value).toContain(
      'patient-1-token',
    );
    expect((screen.getByLabelText('OTP') as HTMLInputElement).value).toBe('123456');

    view.rerender(<ExternalShareContent patientId="patient_2" />);
    expect(screen.queryByLabelText('共有URL')).toBeNull();
    expect(screen.queryByLabelText('OTP')).toBeNull();
    expect((screen.getByLabelText('共有先氏名') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('共有先連絡先（任意）') as HTMLInputElement).value).toBe('');

    fireEvent.change(screen.getByLabelText('共有先氏名'), { target: { value: '別組織の宛先' } });
    useOrgIdMock.mockReturnValue('org_2');
    view.rerender(<ExternalShareContent patientId="patient_2" />);
    expect((screen.getByLabelText('共有先氏名') as HTMLInputElement).value).toBe('');

    fireEvent.change(screen.getByLabelText('共有先氏名'), { target: { value: '旧担当者の宛先' } });
    authState = { currentUser: { id: 'user_2', role: 'admin' } };
    view.rerender(<ExternalShareContent patientId="patient_2" />);
    expect((screen.getByLabelText('共有先氏名') as HTMLInputElement).value).toBe('');
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['external-share-overview', 'patient_2', 'org_2', 'user_2', 'admin'],
      }),
    );
  });

  it('archived patients remain readable but block every new share write until restored', async () => {
    let archive: PatientArchiveSummary = ARCHIVED_PATIENT_ARCHIVE;
    const mutationConfigs: MutationConfig[] = [];
    const mutationCalls = [vi.fn(), vi.fn(), vi.fn()];
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      const index = mutationConfigs.length % 3;
      mutationConfigs.push(config);
      return { mutate: mutationCalls[index], isPending: false };
    });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      const scope = config.queryKey?.[0];
      if (scope === 'patient-care-team') {
        return {
          data: {
            data: [
              {
                role: 'care_manager',
                name: '田中ケアマネ',
                organization_name: '北区ケアプラン',
                is_primary: true,
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      if (scope === 'patient-contacts') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (scope === 'communication-requests') {
        return {
          data: {
            data: [
              {
                id: 'request_1',
                recipient_role: 'care_manager',
                recipient_name: '田中ケアマネ',
                status: 'responded',
                subject: '共有確認',
                requested_at: '2026-06-01T00:00:00.000Z',
                responses: [{ id: 'response_1', responded_at: '2026-06-02T00:00:00.000Z' }],
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      if (scope === 'communication-request') {
        return {
          data: {
            data: {
              id: 'request_1',
              responses: [
                {
                  id: 'response_1',
                  responder_name: '田中ケアマネ',
                  content: '既存の返信内容',
                  responded_at: '2026-06-02T00:00:00.000Z',
                },
              ],
            },
          },
          isLoading: false,
          isError: false,
        };
      }
      return {
        data: {
          name: '佐藤 花子',
          archive,
          patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
          external_shares: [
            {
              id: 'share_1',
              granted_to_name: '既存共有先',
              expires_at: '2026-07-20T00:00:00.000Z',
              accessed_at: null,
            },
          ],
          self_reports: [
            {
              id: 'report_1',
              subject: '既存の自己報告',
              created_at: '2026-06-01T00:00:00.000Z',
              status: 'open',
            },
          ],
          current_medications: [],
          visit_schedules: [],
          care_reports: [],
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    });

    const view = render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      'アーカイブ中',
    );
    expect((screen.getByLabelText('共有先氏名') as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: /共有リンクを発行/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByTestId('share-create-request-button') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId('share-next-task-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('既存共有先')).toBeTruthy();
    expect(screen.getByText('既存の自己報告')).toBeTruthy();
    expect(screen.getByText('既存の返信内容')).toBeTruthy();
    expect(screen.getByTestId('share-open-request-link')).toBeTruthy();

    for (const config of mutationConfigs.slice(0, 3)) {
      await expect(config.mutationFn?.()).rejects.toThrow(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mutationCalls.every((mutate) => mutate.mock.calls.length === 0)).toBe(true);

    archive = ACTIVE_PATIENT_ARCHIVE;
    view.rerender(<ExternalShareContent patientId="patient_1" />);

    expect(screen.queryByTestId('patient-write-availability-notice')).toBeNull();
    expect((screen.getByLabelText('共有先氏名') as HTMLInputElement).disabled).toBe(false);
    expect(
      (screen.getByRole('button', { name: /共有リンクを発行/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
    // The existing responded request remains a separate deduplication gate after restore.
    expect((screen.getByTestId('share-create-request-button') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByTestId('share-create-request-button').textContent).toContain(
      '返信依頼起票済み',
    );
    expect((screen.getByTestId('share-next-task-button') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('fails closed when patient archive state is unavailable', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: {
        name: '佐藤 花子',
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [],
        self_reports: [],
        current_medications: [],
        visit_schedules: [],
        care_reports: [],
      },
      isLoading: false,
      isError: false,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      '状態未確認',
    );
    expect(
      (screen.getByRole('button', { name: /共有リンクを発行/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('uses provider action permissions to disable external share issuance', async () => {
    const mutationConfigs: MutationConfig[] = [];
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    useQueryMock.mockReturnValue({
      data: {
        name: '佐藤 花子',
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: {
          ...FULL_PATIENT_SHARE_PERMISSIONS,
          can_create_external_share: false,
        },
        external_shares: [],
        self_reports: [],
        current_medications: [],
        visit_schedules: [],
        care_reports: [],
      },
      isLoading: false,
      isError: false,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.queryByTestId('patient-write-availability-notice')).toBeNull();
    expect(
      screen.getByText('外部共有リンクの発行権限がないため、共有設定は閲覧のみです。'),
    ).toBeTruthy();
    expect((screen.getByLabelText('共有先氏名') as HTMLInputElement).disabled).toBe(true);
    expect(
      screen.getByRole('button', { name: /共有リンクを発行/ }).getAttribute('aria-describedby'),
    ).toBe('external-share-permission-description');
    await expect(mutationConfigs[0]?.mutationFn?.()).rejects.toThrow(
      '外部共有リンクの発行権限がありません',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks reply-request creation at the CTA and mutation boundary without permission', async () => {
    const mutationConfigs: MutationConfig[] = [];
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      const scope = config.queryKey?.[0];
      if (scope === 'patient-care-team') {
        return {
          data: {
            data: [
              {
                role: 'care_manager',
                name: '田中ケアマネ',
                organization_name: '北区ケアプラン',
                is_primary: true,
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      if (scope === 'patient-contacts' || scope === 'communication-requests') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      return {
        data: {
          name: '佐藤 花子',
          archive: ACTIVE_PATIENT_ARCHIVE,
          patient_share_permissions: {
            ...FULL_PATIENT_SHARE_PERMISSIONS,
            can_create_reply_request: false,
          },
          external_shares: [],
          self_reports: [],
          current_medications: [],
          visit_schedules: [],
          care_reports: [],
        },
        isLoading: false,
        isError: false,
      };
    });

    render(<ExternalShareContent patientId="patient_1" />);

    const button = screen.getByTestId('share-create-request-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe('reply-request-permission-description');
    expect(
      screen.getByText('返信依頼の起票権限がないため、既存の依頼と返信は閲覧のみできます。'),
    ).toBeTruthy();
    await expect(mutationConfigs[2]?.mutationFn?.()).rejects.toThrow(
      '返信依頼の起票権限がありません',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks follow-up task creation at the CTA and mutation boundary without permission', async () => {
    const mutationConfigs: MutationConfig[] = [];
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      const scope = config.queryKey?.[0];
      if (scope === 'communication-requests') {
        return {
          data: {
            data: [
              {
                id: 'request_1',
                recipient_role: 'care_manager',
                recipient_name: '田中ケアマネ',
                status: 'responded',
                subject: '共有確認',
                requested_at: '2026-06-01T00:00:00.000Z',
                responses: [{ id: 'response_1', responded_at: '2026-06-02T00:00:00.000Z' }],
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      if (scope === 'communication-request') {
        return {
          data: {
            data: {
              id: 'request_1',
              responses: [
                {
                  id: 'response_1',
                  responder_name: '田中ケアマネ',
                  content: '次回確認をお願いします',
                  responded_at: '2026-06-02T00:00:00.000Z',
                },
              ],
            },
          },
          isLoading: false,
          isError: false,
        };
      }
      return {
        data: {
          name: '佐藤 花子',
          archive: ACTIVE_PATIENT_ARCHIVE,
          patient_share_permissions: {
            ...FULL_PATIENT_SHARE_PERMISSIONS,
            can_create_followup_task: false,
          },
          external_shares: [],
          self_reports: [],
          current_medications: [],
          visit_schedules: [],
          care_reports: [],
        },
        isLoading: false,
        isError: false,
      };
    });

    render(<ExternalShareContent patientId="patient_1" />);

    const button = screen.getByTestId('share-next-task-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe('followup-task-description');
    expect(
      screen.getByText(
        '担当範囲外のため、返信内容は閲覧のみできます。患者の担当者が次回タスクを作成してください。',
      ),
    ).toBeTruthy();
    await expect(mutationConfigs[1]?.mutationFn?.()).rejects.toThrow(
      '運用タスクの作成権限がありません',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('locks every write and refreshes task eligibility after an authoritative task rejection', async () => {
    const mutationConfigs: MutationConfig[] = [];
    let canCreateFollowupTask = true;
    let resolveRefetch!: (value: { isSuccess: true }) => void;
    const refetchPromise = new Promise<{ isSuccess: true }>((resolve) => {
      resolveRefetch = resolve;
    });
    const refetchOverview = vi.fn(() => refetchPromise);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'assignment scope changed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      const scope = config.queryKey?.[0];
      if (scope === 'patient-care-team') {
        return {
          data: {
            data: [
              {
                role: 'care_manager',
                name: '田中ケアマネ',
                organization_name: '北区ケアプラン',
                is_primary: true,
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      if (scope === 'patient-contacts') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (scope === 'communication-requests') {
        return {
          data: {
            data: [
              {
                id: 'request_1',
                recipient_role: 'care_manager',
                recipient_name: '田中ケアマネ',
                status: 'closed',
                subject: '共有確認',
                requested_at: '2026-06-01T00:00:00.000Z',
                responses: [{ id: 'response_1', responded_at: '2026-06-02T00:00:00.000Z' }],
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      if (scope === 'communication-request') {
        return {
          data: {
            data: {
              id: 'request_1',
              responses: [
                {
                  id: 'response_1',
                  responder_name: '田中ケアマネ',
                  content: '次回確認をお願いします',
                  responded_at: '2026-06-02T00:00:00.000Z',
                },
              ],
            },
          },
          isLoading: false,
          isError: false,
        };
      }
      return {
        data: {
          name: '佐藤 花子',
          archive: ACTIVE_PATIENT_ARCHIVE,
          patient_share_permissions: {
            ...FULL_PATIENT_SHARE_PERMISSIONS,
            can_create_followup_task: canCreateFollowupTask,
          },
          external_shares: [],
          self_reports: [],
          current_medications: [],
          visit_schedules: [],
          care_reports: [],
        },
        isLoading: false,
        isError: false,
        isRefetchError: false,
        isRefetching: false,
        refetch: refetchOverview,
      };
    });

    render(<ExternalShareContent patientId="patient_1" />);

    const shareButton = screen.getByRole('button', {
      name: /共有リンクを発行/,
    }) as HTMLButtonElement;
    const requestButton = screen.getByTestId('share-create-request-button') as HTMLButtonElement;
    const taskButton = screen.getByTestId('share-next-task-button') as HTMLButtonElement;
    expect(shareButton.disabled).toBe(false);
    expect(requestButton.disabled).toBe(false);
    expect(taskButton.disabled).toBe(false);

    let taskError: unknown;
    try {
      await mutationConfigs[1]?.mutationFn?.();
    } catch (error) {
      taskError = error;
    }
    let reconciliation: Promise<void> | void = undefined;
    act(() => {
      reconciliation = mutationConfigs[1]?.onError?.(taskError);
    });

    expect(refetchOverview).toHaveBeenCalledTimes(1);
    expect(shareButton.disabled).toBe(true);
    expect(requestButton.disabled).toBe(true);
    expect(taskButton.disabled).toBe(true);
    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      '状態未確認',
    );

    canCreateFollowupTask = false;
    await act(async () => {
      resolveRefetch({ isSuccess: true });
      await reconciliation;
    });

    expect(shareButton.disabled).toBe(false);
    expect(requestButton.disabled).toBe(false);
    expect(taskButton.disabled).toBe(true);
    expect(
      screen.getByText(
        '担当範囲外のため、返信内容は閲覧のみできます。患者の担当者が次回タスクを作成してください。',
      ),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) => String(input) === '/api/tasks' && init?.method === 'POST',
      ),
    ).toHaveLength(1);
  });

  it('maps only the canonical archived-patient 409 to reviewed recovery copy', async () => {
    const mutationConfigs: MutationConfig[] = [];
    const refetchOverview = vi.fn().mockResolvedValue({
      data: { archive: ACTIVE_PATIENT_ARCHIVE },
      isSuccess: true,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
            message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'unreviewed-provider-detail' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    useQueryMock.mockReturnValue({
      data: {
        name: '佐藤 花子',
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [],
        self_reports: [],
        current_medications: [],
        visit_schedules: [],
        care_reports: [],
      },
      isLoading: false,
      isError: false,
      refetch: refetchOverview,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    let archivedError: unknown;
    try {
      await mutationConfigs[0]?.mutationFn?.();
    } catch (error) {
      archivedError = error;
    }
    await act(async () => {
      await mutationConfigs[0]?.onError?.(archivedError);
    });
    expect(toast.error).toHaveBeenLastCalledWith(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE);
    expect(refetchOverview).toHaveBeenCalledTimes(1);

    let unreviewedError: unknown;
    try {
      await mutationConfigs[0]?.mutationFn?.();
    } catch (error) {
      unreviewedError = error;
    }
    await act(async () => {
      await mutationConfigs[0]?.onError?.(unreviewedError);
    });
    expect(toast.error).toHaveBeenLastCalledWith('共有リンクの生成に失敗しました');
    expect(toast.error).not.toHaveBeenCalledWith('unreviewed-provider-detail');
    expect(refetchOverview).toHaveBeenCalledTimes(1);
  });

  it('locks the whole share workspace while an archive conflict is being reconciled', async () => {
    const mutationConfigs: MutationConfig[] = [];
    let resolveRefetch!: (value: {
      data: { archive: PatientArchiveSummary };
      isSuccess: true;
    }) => void;
    const refetchPromise = new Promise<{
      data: { archive: PatientArchiveSummary };
      isSuccess: true;
    }>((resolve) => {
      resolveRefetch = resolve;
    });
    const refetchOverview = vi.fn(() => refetchPromise);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
          message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    useQueryMock.mockReturnValue({
      data: {
        name: '佐藤 花子',
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [],
        self_reports: [],
        current_medications: [],
        visit_schedules: [],
        care_reports: [],
      },
      isLoading: false,
      isError: false,
      refetch: refetchOverview,
    });

    render(<ExternalShareContent patientId="patient_1" />);
    const generateButton = screen.getByRole('button', {
      name: /共有リンクを発行/,
    }) as HTMLButtonElement;
    expect(generateButton.disabled).toBe(false);

    let archivedError: unknown;
    try {
      await mutationConfigs[0]?.mutationFn?.();
    } catch (error) {
      archivedError = error;
    }
    let reconciliation: Promise<void> | void = undefined;
    act(() => {
      reconciliation = mutationConfigs[0]?.onError?.(archivedError);
    });

    expect(generateButton.disabled).toBe(true);
    expect((screen.getByLabelText('共有先氏名') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      '状態未確認',
    );

    await act(async () => {
      resolveRefetch({ data: { archive: ACTIVE_PATIENT_ARCHIVE }, isSuccess: true });
      await reconciliation;
    });
    expect(generateButton.disabled).toBe(false);
    expect(screen.queryByTestId('patient-write-availability-notice')).toBeNull();
  });

  it('keeps cached history visible and writes locked when archive reconciliation fails', async () => {
    const mutationConfigs: MutationConfig[] = [];
    const refetchOverview = vi.fn().mockResolvedValue({
      data: { archive: ACTIVE_PATIENT_ARCHIVE },
      isSuccess: false,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
          message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    useQueryMock.mockReturnValue({
      data: {
        name: '佐藤 花子',
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [
          {
            id: 'share_cached',
            granted_to_name: '既存共有先',
            expires_at: '2026-07-20T00:00:00.000Z',
            accessed_at: null,
          },
        ],
        self_reports: [],
        current_medications: [],
        visit_schedules: [],
        care_reports: [],
      },
      isLoading: false,
      isError: false,
      isRefetchError: false,
      isRefetching: false,
      refetch: refetchOverview,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    let archivedError: unknown;
    try {
      await mutationConfigs[0]?.mutationFn?.();
    } catch (error) {
      archivedError = error;
    }
    await act(async () => {
      await mutationConfigs[0]?.onError?.(archivedError);
    });

    expect(refetchOverview).toHaveBeenCalledTimes(1);
    expect(screen.getByText('既存共有先')).toBeTruthy();
    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      '状態未確認',
    );
    expect(
      (screen.getByRole('button', { name: /共有リンクを発行/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('button', { name: '患者状態を再取得' })).toBeTruthy();
  });

  it('hides cached patient PHI when a refetch confirms access is no longer allowed', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: {
        name: '佐藤 花子',
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [
          {
            id: 'share_cached',
            granted_to_name: '既存共有先',
            expires_at: '2026-07-20T00:00:00.000Z',
            accessed_at: null,
          },
        ],
        self_reports: [],
        current_medications: [],
        visit_schedules: [],
        care_reports: [],
      },
      dataUpdatedAt: Date.UTC(2026, 6, 13, 1, 30),
      error: new PrimaryQueryError('共有状況を取得できませんでした', 403, false),
      isLoading: false,
      isError: true,
      isRefetchError: true,
      isRefetching: false,
      refetch: vi.fn(),
    });

    render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.getByText('共有状況を表示できません')).toBeTruthy();
    expect(screen.queryByText('佐藤 花子')).toBeNull();
    expect(screen.queryByText('既存共有先')).toBeNull();
    expect(screen.queryByTestId('patient-write-availability-notice')).toBeNull();
  });

  it('labels retryable cached patient data as stale while keeping writes locked', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: {
        name: '佐藤 花子',
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [
          {
            id: 'share_cached',
            granted_to_name: '既存共有先',
            expires_at: '2026-07-20T00:00:00.000Z',
            accessed_at: null,
          },
        ],
        self_reports: [],
        current_medications: [],
        visit_schedules: [],
        care_reports: [],
      },
      dataUpdatedAt: Date.UTC(2026, 6, 13, 1, 30),
      error: new PrimaryQueryError('共有状況を取得できませんでした', 503, true),
      isLoading: false,
      isError: true,
      isRefetchError: true,
      isRefetching: false,
      refetch: vi.fn(),
    });

    render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.getByText('既存共有先')).toBeTruthy();
    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      '前回取得データを表示中です',
    );
    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      '最終更新:',
    );
    expect(
      (screen.getByRole('button', { name: /共有リンクを発行/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('creates a patient-scoped reply request for the selected audience', async () => {
    const mutationConfigs: MutationConfig[] = [];
    const createReplyMutate = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === '/api/communication-requests' && init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { id: 'request_new', status: 'sent' } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return {
        mutate: mutationConfigs.length === 3 ? createReplyMutate : vi.fn(),
        isPending: false,
      };
    });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      const scope = config.queryKey?.[0];
      if (scope === 'patient-care-team') {
        return {
          data: {
            data: [
              {
                role: 'care_manager',
                name: '田中ケアマネ',
                organization_name: '北区ケアプラン',
                is_primary: true,
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      if (scope === 'patient-contacts') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (scope === 'communication-requests') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      return {
        data: {
          name: '佐藤 花子',
          archive: ACTIVE_PATIENT_ARCHIVE,
          patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
          external_shares: [],
          self_reports: [],
          current_medications: [
            { drug_name: 'アムロジピン錠5mg', dose: '1錠', frequency: '朝食後' },
          ],
          visit_schedules: [
            { scheduled_date: '2026-06-20T09:00:00.000Z', schedule_status: 'planned' },
          ],
          care_reports: [
            {
              report_type: 'care_manager_report',
              created_at: '2026-06-10T08:00:00.000Z',
              status: 'sent',
              has_pdf: true,
            },
          ],
        },
        isLoading: false,
        isError: false,
      };
    });

    render(<ExternalShareContent patientId="patient_1" />);

    const button = screen.getByTestId('share-create-request-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(createReplyMutate).toHaveBeenCalledTimes(1);

    const createResult = await mutationConfigs[2]?.mutationFn?.();
    const requestCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/communication-requests' && init?.method === 'POST',
    );
    expect(requestCall?.[1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    expect(vi.mocked(buildCommunicationRequestsApiPath)).toHaveBeenCalledWith();
    const body = JSON.parse(String(requestCall?.[1]?.body)) as {
      patient_id: string;
      request_type: string;
      template_key: string;
      recipient_name: string;
      recipient_role: string;
      related_entity_type: string;
      related_entity_id: string;
      status: string;
      subject: string;
      content: string;
      context_snapshot: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      patient_id: 'patient_1',
      request_type: 'patient_share_reply_request',
      template_key: 'patient_share_reply_request',
      recipient_name: '田中ケアマネ',
      recipient_role: 'care_manager',
      related_entity_type: 'patient',
      related_entity_id: 'patient_1',
      status: 'sent',
      subject: '返信依頼: ケアマネ向け患者共有(佐藤 花子 様)',
      context_snapshot: {
        source: 'patient_external_share',
        patient_id: 'patient_1',
        audience: 'care_manager',
        recipient_organization_name: '北区ケアプラン',
      },
    });
    expect(body.content).toContain('ケアマネ向けに共有する患者情報です');

    await act(async () => {
      await mutationConfigs[2]?.onSuccess?.(createResult);
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communication-requests', 'patient', 'patient_1', 'org_1', 'user_1', 'pharmacist'],
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(mutationConfigs[2]?.mutationFn?.()).rejects.toThrow(
      '返信依頼の起票に失敗しました',
    );
  });

  it('creates a patient-scoped follow-up task through shared task path and header helpers', async () => {
    const mutationConfigs: MutationConfig[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === '/api/tasks' && init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { id: 'task_1' } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      const scope = config.queryKey?.[0];
      if (scope === 'communication-requests') {
        return {
          data: {
            data: [
              {
                id: 'request_1',
                recipient_role: 'care_manager',
                recipient_name: '田中ケアマネ',
                status: 'responded',
                subject: '共有確認',
                requested_at: '2026-06-01T00:00:00.000Z',
                responses: [{ id: 'response_1', responded_at: '2026-06-02T00:00:00.000Z' }],
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      if (scope === 'communication-request') {
        return {
          data: {
            data: {
              id: 'request_1',
              responses: [
                {
                  id: 'response_1',
                  responder_name: '田中ケアマネ',
                  content: '次回確認をお願いします',
                  responded_at: '2026-06-02T00:00:00.000Z',
                },
              ],
            },
          },
          isLoading: false,
          isError: false,
        };
      }
      return {
        data: {
          name: '佐藤 花子',
          archive: ACTIVE_PATIENT_ARCHIVE,
          patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
          external_shares: [],
          self_reports: [],
          current_medications: [],
          visit_schedules: [],
          care_reports: [],
        },
        isLoading: false,
        isError: false,
      };
    });

    render(<ExternalShareContent patientId="patient_1" />);

    await mutationConfigs[1]?.mutationFn?.();
    const taskCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/tasks' && init?.method === 'POST',
    );
    expect(taskCall?.[1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });
    expect(vi.mocked(buildTasksApiPath)).toHaveBeenCalledWith();
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    const body = JSON.parse(String(taskCall?.[1]?.body)) as {
      related_entity_type: string;
      related_entity_id: string;
      metadata: {
        report_id: string;
        communication_request_id: string;
      };
    };
    expect(body.related_entity_type).toBe('patient');
    expect(body.related_entity_id).toBe('patient_1');
    expect(body.metadata).toMatchObject({
      report_id: 'patient_1',
      communication_request_id: 'request_1',
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: '次回タスクを作成しました' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(mutationConfigs[1]?.mutationFn?.()).rejects.toThrow(
      '次回タスクの作成に失敗しました',
    );
  });

  it('uses safe recovery copy for patient-share mutation toasts', () => {
    const mutationConfigs: MutationConfig[] = [];
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false };
    });
    useQueryMock.mockReturnValue({
      data: {
        name: '佐藤 花子',
        archive: ACTIVE_PATIENT_ARCHIVE,
        patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
        external_shares: [],
        self_reports: [],
        current_medications: [],
        visit_schedules: [],
        care_reports: [],
      },
      isLoading: false,
      isError: false,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    const rawTaskErrorMessage = '次回タスクは既に起票済みです';
    mutationConfigs[1]?.onError?.(new Error(rawTaskErrorMessage));
    mutationConfigs[2]?.onError?.('reply-request-failure');

    expect(toast.error).toHaveBeenCalledWith('次回タスクの作成に失敗しました');
    expect(toast.error).not.toHaveBeenCalledWith(rawTaskErrorMessage);
    expect(toast.error).toHaveBeenCalledWith('返信依頼の起票に失敗しました');
  });

  it('links an active patient-share reply request back to the exact communication request', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      const scope = config.queryKey?.[0];
      if (scope === 'patient-care-team') {
        return {
          data: {
            data: [
              {
                role: 'care_manager',
                name: '田中ケアマネ',
                organization_name: '北区ケアプラン',
                is_primary: true,
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      if (scope === 'patient-contacts') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (scope === 'communication-requests') {
        return {
          data: {
            data: [
              {
                id: 'request_1',
                recipient_role: 'care_manager',
                recipient_name: '田中ケアマネ',
                status: 'sent',
                subject: '共有確認',
                requested_at: '2026-06-01T00:00:00.000Z',
                responses: [],
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      if (scope === 'communication-request') {
        return { data: undefined, isLoading: false, isError: false };
      }
      return {
        data: {
          name: '佐藤 花子',
          archive: ACTIVE_PATIENT_ARCHIVE,
          patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
          external_shares: [],
          self_reports: [],
          current_medications: [],
          visit_schedules: [],
          care_reports: [],
        },
        isLoading: false,
        isError: false,
      };
    });

    render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.getByTestId('share-open-request-link').getAttribute('href')).toBe(
      '/communications/requests?status=sent&request_type=patient_share_reply_request&patient_id=patient_1&request_id=request_1&related_entity_type=patient&related_entity_id=patient_1',
    );
  });

  it('does not create a reply request when the selected audience has no registered recipient', () => {
    const createReplyMutate = vi.fn();
    let mutationCount = 0;
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockImplementation(() => {
      mutationCount += 1;
      return {
        mutate: mutationCount === 3 ? createReplyMutate : vi.fn(),
        isPending: false,
      };
    });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      const scope = config.queryKey?.[0];
      if (scope === 'patient-care-team' || scope === 'patient-contacts') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (scope === 'communication-requests') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      return {
        data: {
          name: '佐藤 花子',
          archive: ACTIVE_PATIENT_ARCHIVE,
          patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
          external_shares: [],
          self_reports: [],
          current_medications: [],
          visit_schedules: [],
          care_reports: [],
        },
        isLoading: false,
        isError: false,
      };
    });

    render(<ExternalShareContent patientId="patient_1" />);

    const button = screen.getByTestId('share-create-request-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByText('ケアチームまたは連絡先に共有相手を登録すると、返信依頼を起票できます。'),
    ).toBeTruthy();
    fireEvent.click(button);
    expect(createReplyMutate).not.toHaveBeenCalled();
  });

  it('shows a retryable warning when supporting share data partially fails', () => {
    const refetchCareTeam = vi.fn();
    const refetchContacts = vi.fn();
    const refetchRequests = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      const scope = config.queryKey?.[0];
      if (scope === 'patient-care-team') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          refetch: refetchCareTeam,
        };
      }
      if (scope === 'patient-contacts') {
        return { data: { data: [] }, isLoading: false, isError: false, refetch: refetchContacts };
      }
      if (scope === 'communication-requests') {
        return { data: { data: [] }, isLoading: false, isError: false, refetch: refetchRequests };
      }
      return {
        data: {
          name: '佐藤 花子',
          archive: ACTIVE_PATIENT_ARCHIVE,
          patient_share_permissions: FULL_PATIENT_SHARE_PERMISSIONS,
          external_shares: [],
          self_reports: [],
          current_medications: [],
          visit_schedules: [],
          care_reports: [],
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    });

    render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.getByTestId('share-supporting-data-warning')).toBeTruthy();
    expect(screen.getByText('一部の共有情報を取得できませんでした')).toBeTruthy();
    expect(screen.getByText(/ケアチームを取得できないため/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再取得' }));

    expect(refetchCareTeam).toHaveBeenCalledTimes(1);
    expect(refetchContacts).toHaveBeenCalledTimes(1);
    expect(refetchRequests).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable error instead of a false-empty overview when the fetch fails', () => {
    const refetch = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('共有状況を取得できませんでした'),
      refetch,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    // 取得失敗を「共有実績ゼロ」に化けさせず、エラー＋再試行を提示する。
    expect(screen.getByText('共有状況を表示できません')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: '共有設定' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('fails closed and offers recovery when a completed overview has no patient data', () => {
    const refetch = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.getByText('患者情報を表示できません')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: '共有設定' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
