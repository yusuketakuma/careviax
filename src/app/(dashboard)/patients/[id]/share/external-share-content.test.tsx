// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());

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

import { ExternalShareContent } from './external-share-content';

setupDomTestEnv();

type QueryConfig = {
  queryKey?: unknown[];
  queryFn?: () => Promise<unknown>;
  enabled?: boolean;
};

type MutationConfig = {
  mutationFn?: () => Promise<unknown>;
  onSuccess?: () => Promise<void> | void;
  onError?: (error: Error) => void;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ExternalShareContent', () => {
  it('renders share setup and history with semantic section headings', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: {
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
    expect(screen.getByText('田中ケアマネジャー')).toBeTruthy();
    expect(screen.getByText('疼痛の相談')).toBeTruthy();
  });

  it('keeps share setup validation errors visible inline', () => {
    const mutate = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate, isPending: false });
    useQueryMock.mockReturnValue({
      data: {
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
      if (url.startsWith('/api/patients/')) {
        return new Response(
          JSON.stringify({
            name: '佐藤 花子',
            external_shares: [],
            self_reports: [],
            current_medications: [],
            visit_schedules: [],
            care_reports: [],
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
                recipient_role: 'care_manager',
                recipient_name: '田中ケアマネ',
                status: 'responded',
                subject: '共有確認',
                requested_at: '2026-06-01T00:00:00.000Z',
                responses: [{ id: 'response_1', responded_at: '2026-06-02T00:00:00.000Z' }],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/communication-requests/')) {
        return new Response(
          JSON.stringify({
            data: {
              id: requestId,
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
    expect(params.get('related_entity_id')).toBe(patientId);
    expect(requestListUrl).toContain(`related_entity_id=${encodeURIComponent(patientId)}`);
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

    await mutationConfigs[2]?.mutationFn?.();
    const requestCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/communication-requests' && init?.method === 'POST',
    );
    expect(requestCall?.[1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });
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

    await mutationConfigs[2]?.onSuccess?.();
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communication-requests', 'patient', 'patient_1', 'org_1'],
    });
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
      '/communications/requests?status=sent&patient_id=patient_1&request_id=request_1&related_entity_type=patient&related_entity_id=patient_1',
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
});
