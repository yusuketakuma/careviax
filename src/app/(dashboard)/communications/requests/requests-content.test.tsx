// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());
const fetchAllCursorPagesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/cursor-pagination-client', () => ({
  fetchAllCursorPages: fetchAllCursorPagesMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));

import { CommunicationRequestsContent } from './requests-content';

setupDomTestEnv();

describe('CommunicationRequestsContent', () => {
  const resolveFocusedMutateMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/communications/requests');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=dashboard_home'));
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: resolveFocusedMutateMock,
      isPending: false,
    });
    useQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    fetchAllCursorPagesMock.mockResolvedValue({ data: [], hasMore: false });
  });

  it('shows the home context banner for sent communications focus', () => {
    render(<CommunicationRequestsContent initialStatus="sent" initialContext="dashboard_home" />);

    expect(screen.getByTestId('communications-context-banner')).toBeTruthy();
    expect(
      screen.getByText('ホームから返信待ちの依頼・照会にフォーカスして開いています。'),
    ).toBeTruthy();
  });

  it('records the selected reply follow-up through the current workspace action', () => {
    useQueryMock.mockReset();
    useQueryMock.mockImplementation(() => {
      return {
        data: {
          data: [
            {
              id: 'request_1',
              request_type: 'tracing_report',
              subject: '服薬情報提供書の確認',
              status: 'sent',
              requested_at: '2026-05-12T00:00:00.000Z',
              updated_at: '2026-06-18T00:00:00.000Z',
              due_date: '2026-05-13T00:00:00.000Z',
              patient_id: 'patient_1',
              related_entity_type: 'tracing_report',
              related_entity_id: 'tracing_1',
              recipient_name: '在宅主治医',
              recipient_role: 'physician',
              responses: [],
            },
          ],
        },
        isLoading: false,
      };
    });
    render(<CommunicationRequestsContent />);

    expect(screen.getByTestId('reply-followup-list')).toBeTruthy();
    expect(screen.getByText('返信内容と次の対応')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('返信内容'), {
      target: { value: '服薬状況の確認が取れました' },
    });
    fireEvent.change(screen.getByLabelText('次回カードへ残すこと'), {
      target: { value: '夕食後薬の飲み忘れを確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: '対応済みにする' }));

    expect(resolveFocusedMutateMock).toHaveBeenCalledWith({
      item: expect.objectContaining({ id: 'request_1', subject: '服薬情報提供書の確認' }),
      responderName: '',
      content: '服薬状況の確認が取れました',
      followup: '夕食後薬の飲み忘れを確認',
    });
  }, 15_000);

  it('renders the reply follow-up workspace as the single current view', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('status=sent'));
    useQueryMock.mockImplementation(() => {
      return {
        data: {
          data: [
            {
              id: 'request_1',
              request_type: 'tracing_report',
              subject: '服薬情報提供書の確認',
              status: 'sent',
              requested_at: '2026-05-12T00:00:00.000Z',
              updated_at: '2026-06-18T00:00:00.000Z',
              due_date: '2026-05-13T00:00:00.000Z',
              patient_id: 'patient_1',
              related_entity_type: 'care_report',
              related_entity_id: 'report_1',
              recipient_name: '青葉ケアプラン',
              recipient_role: 'care_manager',
              responses: [],
            },
          ],
        },
        isLoading: false,
      };
    });

    render(<CommunicationRequestsContent initialStatus="sent" />);

    expect(screen.getByTestId('reply-followup-list')).toBeTruthy();
    expect(screen.getByText('返信内容と次の対応')).toBeTruthy();
    expect(screen.getByText('絞り込みと文脈')).toBeTruthy();
    expect(screen.queryByRole('group', { name: '表示モード' })).toBeNull();
    expect(screen.queryByText('連携ログ一覧')).toBeNull();
  });

  it('shows an error state instead of an empty follow-up workspace when request loading fails', () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<CommunicationRequestsContent />);

    expect(screen.getByRole('heading', { name: '依頼一覧を表示できません' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
    expect(screen.queryByTestId('reply-followup-list')).toBeNull();
    expect(screen.queryByText('返信待ちの依頼はありません。')).toBeNull();
    expect(screen.queryByText('左の返信待ちリストから依頼を選択してください。')).toBeNull();
    expect(screen.queryByRole('button', { name: '対応済みにする' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('hides the empty follow-up workspace while the initial request list is loading', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    render(<CommunicationRequestsContent />);

    expect(screen.getByRole('status').textContent).toContain('依頼一覧を読み込み中...');
    expect(screen.queryByTestId('reply-followup-list')).toBeNull();
    expect(screen.queryByText('返信待ちの依頼はありません。')).toBeNull();
    expect(screen.queryByText('左の返信待ちリストから依頼を選択してください。')).toBeNull();
    expect(screen.queryByRole('button', { name: '対応済みにする' })).toBeNull();
  });

  it('sends reply, follow-up, and the OCC token through one resolve action', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { request: { id: 'request_1', status: 'closed' } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<CommunicationRequestsContent />);

    const mutationOptions = useMutationMock.mock.calls[0]?.[0] as {
      mutationFn: (input: {
        item: {
          id: string;
          request_type: string;
          subject: string;
          status: string;
          requested_at: string;
          updated_at: string;
          due_date: string | null;
          patient_id: string | null;
          related_entity_type: string | null;
          related_entity_id: string | null;
          recipient_name: string | null;
          recipient_role: string | null;
          responses: [];
        };
        responderName: string;
        content: string;
        followup: string;
      }) => Promise<void>;
    };

    await mutationOptions.mutationFn({
      item: {
        id: 'request_1',
        request_type: 'tracing_report',
        subject: '服薬情報提供書の確認',
        status: 'sent',
        requested_at: '2026-05-12T00:00:00.000Z',
        updated_at: '2026-06-18T00:00:00.000Z',
        due_date: null,
        patient_id: 'patient_1',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
        recipient_name: '在宅主治医',
        recipient_role: 'physician',
        responses: [],
      },
      responderName: '',
      content: '服薬状況の確認が取れました',
      followup: '夕食後薬の飲み忘れを確認',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/communication-requests/request_1/resolve-followup',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      expected_updated_at: '2026-06-18T00:00:00.000Z',
      response: {
        responder_name: '在宅主治医',
        content: '服薬状況の確認が取れました',
        responded_at: expect.any(String),
      },
      followup: '夕食後薬の飲み忘れを確認',
    });
  });

  it('renders the patient filter detail link through the shared boundary resolver', () => {
    render(<CommunicationRequestsContent initialPatientId="patient_1" />);
    const link = screen.getByRole('link', { name: '詳細' });
    expect(link.getAttribute('href')).toBe('/patients/patient_1');
  });

  it('encodes a hostile patient filter id in the detail href while keeping the query identity raw', async () => {
    const hostilePatientId = '../settings?x=1#y';
    render(<CommunicationRequestsContent initialPatientId={hostilePatientId} />);

    const link = screen.getByRole('link', { name: '詳細' });
    expect(link.getAttribute('href')).toBe(`/patients/${encodeURIComponent(hostilePatientId)}`);
    expect(link.getAttribute('href')).not.toContain('/settings');
    expect(link.getAttribute('href')).not.toContain('?x=1');
    expect(link.getAttribute('href')).not.toContain('#y');

    // API フィルタ識別子は生のまま query key に残る(ブラウザ href だけ encode/縮退)。
    const queryArg = useQueryMock.mock.calls.at(-1)?.[0] as {
      queryKey: unknown[];
      queryFn: () => Promise<unknown>;
    };
    expect(queryArg.queryKey).toContain(hostilePatientId);

    // queryFn を実行し、API へ渡る patient_id が生の hostile id のまま(encode/正規化されない)ことを locking。
    // (queryKey だけでなく queryFn 内の URLSearchParams も生 identity であることを保証。)
    await queryArg.queryFn();
    const fetchArg = fetchAllCursorPagesMock.mock.calls.at(-1)?.[0] as { params: URLSearchParams };
    expect(fetchArg.params.get('patient_id')).toBe(hostilePatientId);
  });

  it.each(['.', '..'])(
    'degrades the patient filter detail link to なし for a dot-segment id (%s) without crashing',
    (dotPatientId) => {
      expect(() =>
        render(<CommunicationRequestsContent initialPatientId={dotPatientId} />),
      ).not.toThrow();
      expect(screen.queryByRole('link', { name: '詳細' })).toBeNull();
      // FilterSummaryBar は `${label} ${value}` を 1 Badge に連結描画するため、患者値の
      // 縮退は "患者 なし" として現れる(value 'なし' 単独要素は存在しない)。
      expect(screen.getByText('患者 なし')).toBeTruthy();
    },
  );
});
