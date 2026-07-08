// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

import { InboundCommunicationsContent } from './inbound-content';

setupDomTestEnv();

function buildInboxData() {
  return {
    data: {
      summary: {
        total_visible_count: 2,
        filtered_count: 2,
        needs_review_count: 2,
        reviewed_pending_action_count: 0,
        urgent_count: 1,
        channel_counts: { phone: 1, fax: 1, email: 0, mcs: 0 },
      },
      items: [
        {
          id: 'inbound_communication:event_1',
          title: '電話連絡を受信',
          summary: '他職種または関係者からの受信情報があります。内容は連絡履歴で確認してください。',
          channel: 'phone',
          status: 'needs_review',
          priority: 'high',
          patient_name: '佐藤花子',
          due_at: '2026-07-07T01:00:00.000Z',
          action_href: '/patients/patient_1/collaboration',
          action_label: '受信情報を確認',
        },
        {
          id: 'inbound_communication:event_2',
          title: 'FAX連絡を受信',
          summary: '他職種または関係者からの受信情報があります。内容は連絡履歴で確認してください。',
          channel: 'fax',
          status: 'needs_review',
          priority: 'urgent',
          patient_name: '高橋一郎',
          due_at: '2026-07-07T02:00:00.000Z',
          action_href: '/communications/requests',
          action_label: '受信情報を確認',
        },
      ],
      filters: { channel: null, status: 'needs_review', priority: null },
    },
    meta: {
      generated_at: '2026-07-07T03:00:00.000Z',
      limit: 50,
      count_basis: 'visible_window',
    },
  };
}

function buildSignalData() {
  return {
    data: {
      summary: {
        source_event_count: 2,
        events_with_signals_count: 2,
        signal_count: 3,
        urgent_count: 1,
        domain_counts: {
          medication_stock: 1,
          medication_safety: 1,
          schedule: 0,
          urgent: 1,
        },
      },
      items: [
        {
          candidate_key: 'inbound_signal:signal_1',
          inbound_event_id: 'event_1',
          signal_id: 'signal_1',
          channel: 'phone',
          occurred_at: '2026-07-07T01:00:00.000Z',
          patient_linked: true,
          case_linked: true,
          signal: {
            domain: 'medication_stock',
            type: 'observed_quantity',
            has_quantity: true,
            unit: '枚',
            quantity_effect: 'observed_absolute',
            source_confidence: 'text_parsed_high',
            review_status: 'needs_review',
            action_status: 'not_linked',
            evidence_code: 'remaining_quantity_expression',
            requires_pharmacist_review: true,
            stock_review: {
              action: 'stage_for_pharmacist_review',
              target_label: '残数レビュー',
              observation_kind: 'remaining_quantity',
              ledger_write_policy: 'never_direct_from_external',
              review_priority: 'medium',
              warning_codes: ['medication_identity_missing'],
              has_medication_identity: false,
              has_observed_quantity: true,
              has_usage_quantity: false,
              direct_ledger_write_allowed: false,
            },
          },
        },
        {
          candidate_key: 'inbound_signal:signal_2',
          inbound_event_id: 'event_2',
          signal_id: 'signal_2',
          channel: 'fax',
          occurred_at: '2026-07-07T02:00:00.000Z',
          patient_linked: false,
          case_linked: false,
          signal: {
            domain: 'urgent',
            type: 'urgent_review_required',
            has_quantity: false,
            unit: null,
            quantity_effect: null,
            source_confidence: 'text_parsed_low',
            review_status: 'needs_review',
            action_status: 'not_linked',
            evidence_code: 'urgent_expression',
            requires_pharmacist_review: true,
            stock_review: null,
          },
        },
      ],
      filters: { channel: null, domain: null, type: null },
    },
    meta: {
      generated_at: '2026-07-07T03:00:00.000Z',
      limit: 50,
      count_basis: 'visible_window',
      source: 'inbound_communication_event',
      classifier_version: 'inbound_signal_classifier_v1',
    },
  };
}

function buildDetailData() {
  return {
    data: {
      id: 'event_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      source_channel: 'phone',
      sender_role: 'nurse',
      sender_name: '訪問看護師A',
      sender_contact: '090-1234-5678',
      sender_organization_name: '訪問看護ステーションA',
      event_type: 'medication_stock_report',
      received_at: '2026-07-07T01:00:00.000Z',
      occurred_at: '2026-07-07T00:55:00.000Z',
      raw_text: '湿布は残り4枚です。storageKey=secret token=secret',
      normalized_summary: '外用薬の残数確認',
      attachment_count: 1,
      processing_status: 'signals_extracted',
    },
    meta: {
      generated_at: '2026-07-07T03:00:00.000Z',
      request_id: 'inbound_review:event_1',
      purpose: 'care_coordination',
      read_reason: 'review_inbound_detail',
      raw_text_included: true,
    },
  };
}

describe('InboundCommunicationsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      if (options.queryKey[0] === 'communications-inbound-detail') {
        return {
          data: buildDetailData(),
          isLoading: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        };
      }

      if (options.queryKey[0] === 'communications-inbound-signals') {
        return {
          data: buildSignalData(),
          isLoading: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        };
      }

      return {
        data: buildInboxData(),
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      };
    });
    useMutationMock.mockImplementation((options) => ({
      mutate: mutateMock,
      isPending: false,
      ...options,
    }));
    invalidateQueriesMock.mockResolvedValue(undefined);
  });

  it('renders the pharmacy-wide inbound inbox without raw communication text', () => {
    render(<InboundCommunicationsContent />);

    expect(screen.getByTestId('inbound-communications-content')).toBeTruthy();
    expect(screen.getByText('表示対象')).toBeTruthy();
    expect(screen.getAllByText('確認待ち').length).toBeGreaterThan(1);
    expect(screen.getAllByText('電話連絡を受信')).toHaveLength(2);
    expect(screen.getByText('FAX連絡を受信')).toBeTruthy();
    expect(screen.getByText('シグナル候補')).toBeTruthy();
    expect(screen.getAllByText('残数・使用量').length).toBeGreaterThan(1);
    expect(screen.getAllByText('残数観測').length).toBeGreaterThan(1);
    expect(screen.getAllByText('緊急確認').length).toBeGreaterThan(1);
    expect(screen.getAllByText('単位 枚').length).toBeGreaterThan(1);
    expect(screen.getByRole('link', { name: '受信情報を確認' }).getAttribute('href')).toBe(
      '/patients/patient_1/collaboration',
    );
    const reviewPanel = within(screen.getByTestId('selected-inbound-review-panel'));
    expect(reviewPanel.getByText('抽出候補')).toBeTruthy();
    expect(reviewPanel.getByText('反映先候補 残数レビュー')).toBeTruthy();
    expect(reviewPanel.getByText('優先度 中')).toBeTruthy();
    expect(reviewPanel.getByText('薬剤未紐づけ')).toBeTruthy();

    const html = document.body.textContent ?? '';
    expect(html).not.toContain('湿布は残り4枚です');
    expect(html).not.toContain('残り4枚');
    expect(html).not.toContain('訪問看護師A');
    expect(html).not.toContain('090-1234-5678');
    expect(html).not.toContain('アムロジピン');
    expect(html).not.toContain('ロキソニン');
    expect(html).not.toContain('storageKey');
    expect(html).not.toContain('token=secret');
  });

  it('fetches and reveals raw detail only after an explicit audited-detail action', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(buildDetailData()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<InboundCommunicationsContent />);

    expect(screen.queryByText('原文（監査記録済み）')).toBeNull();
    expect(screen.queryByText(/storageKey=secret/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '原文を監査付きで表示' }));

    expect(screen.getByText('原文（監査記録済み）')).toBeTruthy();
    expect(screen.getByText(/storageKey=secret/)).toBeTruthy();
    expect(screen.getByText('監査ID')).toBeTruthy();
    expect(screen.getByText('inbound_review:event_1')).toBeTruthy();

    const detailQueryCalls = useQueryMock.mock.calls.filter(
      ([options]) => options.queryKey[0] === 'communications-inbound-detail',
    );
    const detailQueryOptions = detailQueryCalls.at(-1)?.[0] as {
      queryFn: () => Promise<unknown>;
      enabled: boolean;
      retry: boolean;
    };
    await detailQueryOptions.queryFn();

    expect(detailQueryOptions.enabled).toBe(true);
    expect(detailQueryOptions.retry).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/communications/inbound/event_1/detail?purpose=care_coordination&read_reason=review_inbound_detail&request_id=inbound_review%3Aevent_1',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-org-id': 'org_1' }),
      }),
    );
  });

  it('shows signal candidates only for the selected inbound item in the right review panel', () => {
    render(<InboundCommunicationsContent />);

    const reviewPanel = () => within(screen.getByTestId('selected-inbound-review-panel'));
    expect(reviewPanel().getAllByText('残数観測').length).toBeGreaterThan(0);
    expect(reviewPanel().queryByText('緊急確認')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /FAX連絡を受信/ }));

    expect(reviewPanel().getByText('緊急確認')).toBeTruthy();
    expect(reviewPanel().getByText('反映先候補 薬剤師確認')).toBeTruthy();
    expect(reviewPanel().getByText('患者未紐づけ')).toBeTruthy();
    expect(reviewPanel().queryByText('残数観測')).toBeNull();
    expect(reviewPanel().queryByText('薬剤未紐づけ')).toBeNull();

    const html = screen.getByTestId('selected-inbound-review-panel').textContent ?? '';
    expect(html).not.toContain('湿布は残り4枚です');
    expect(html).not.toContain('訪問看護師A');
    expect(html).not.toContain('090-1234-5678');
    expect(html).not.toContain('ロキソニン');
    expect(html).not.toContain('storageKey');
  });

  it('creates a pharmacist review task from the selected signal candidate key only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            task_id: 'task_1',
            task_type: 'pharmacy.inbound_medication_stock_signal_review_required',
            status: 'pending',
            action_href: '/patients/patient_1#medication-stock-events',
          },
          meta: { generated_at: '2026-07-07T03:00:00.000Z' },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<InboundCommunicationsContent />);

    fireEvent.click(screen.getByRole('button', { name: '薬剤師確認タスク化' }));

    expect(mutateMock).toHaveBeenCalledWith('inbound_signal:signal_1');

    const mutationOptions = useMutationMock.mock.calls[2]?.[0] as {
      mutationFn: (candidateKey: string) => Promise<unknown>;
      onSuccess: () => Promise<void>;
    };
    await mutationOptions.mutationFn('inbound_signal:signal_1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/communications/inbound/signals/tasks',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-org-id': 'org_1',
        }),
        body: JSON.stringify({
          candidate_key: 'inbound_signal:signal_1',
        }),
      }),
    );

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(requestBody)).toEqual(['candidate_key']);

    await act(async () => {
      await mutationOptions.onSuccess();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('薬剤師確認タスクを作成しました');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communications-inbound', 'org_1'],
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communications-inbound-signals', 'org_1'],
    });
  });

  it('updates a signal review action using only the durable signal id and action', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            signal_id: 'signal_1',
            inbound_event_id: 'event_1',
            review_status: 'accepted',
            action_status: 'not_linked',
            reviewed_at: '2026-07-07T03:00:00.000Z',
            review_task_closure_count: 1,
          },
          meta: { generated_at: '2026-07-07T03:00:00.000Z' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<InboundCommunicationsContent />);

    fireEvent.click(screen.getByRole('button', { name: '確認済み' }));

    expect(mutateMock).toHaveBeenCalledWith({
      signalId: 'signal_1',
      action: 'accept',
    });

    const mutationOptions = useMutationMock.mock.calls[3]?.[0] as {
      mutationFn: (input: { signalId: string; action: 'accept' }) => Promise<unknown>;
      onSuccess: (response: {
        data: {
          review_task_closure_count?: number;
        };
      }) => Promise<void>;
    };
    await mutationOptions.mutationFn({ signalId: 'signal_1', action: 'accept' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/communications/inbound/signals/signal_1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-org-id': 'org_1',
        }),
        body: JSON.stringify({
          action: 'accept',
        }),
      }),
    );

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(requestBody)).toEqual(['action']);
    expect(JSON.stringify(requestBody)).not.toContain('湿布');
    expect(JSON.stringify(requestBody)).not.toContain('残り4枚');
    expect(JSON.stringify(requestBody)).not.toContain('訪問看護師A');
    expect(JSON.stringify(requestBody)).not.toContain('090-1234-5678');

    await act(async () => {
      await mutationOptions.onSuccess({
        data: {
          review_task_closure_count: 1,
        },
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      '受信シグナルを確認し、関連レビュータスクを完了しました',
    );
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communications-inbound', 'org_1'],
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communications-inbound-signals', 'org_1'],
    });
  });

  it('does not allow accepted signals to be reviewed or task-created again', () => {
    const signalData = buildSignalData();
    signalData.data.items[0].signal.review_status = 'accepted';
    signalData.data.items[0].signal.action_status = 'not_linked';

    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      if (options.queryKey[0] === 'communications-inbound-signals') {
        return {
          data: signalData,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }

      return {
        data: buildInboxData(),
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    });

    render(<InboundCommunicationsContent />);

    const reviewPanel = within(screen.getByTestId('selected-inbound-review-panel'));
    expect(reviewPanel.getAllByText('確認済み').length).toBeGreaterThan(0);
    expect(reviewPanel.getByText('未反映')).toBeTruthy();
    expect(
      reviewPanel.getByText(
        '薬剤師レビューは完了しています。残数台帳への反映は、残数管理の明示操作で行います。',
      ),
    ).toBeTruthy();

    expect(
      (reviewPanel.getByRole('button', { name: '確認済み' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (reviewPanel.getByRole('button', { name: '記録のみ' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((reviewPanel.getByRole('button', { name: '却下' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (reviewPanel.getByRole('button', { name: '薬剤師確認タスク化' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('keeps false-empty and fetch failure visually separated', () => {
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      if (options.queryKey[0] === 'communications-inbound-signals') {
        return {
          data: buildSignalData(),
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }

      return {
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      };
    });

    render(<InboundCommunicationsContent />);

    expect(screen.getByText('他職種受信を表示できません')).toBeTruthy();
    expect(screen.queryByText('確認待ちの他職種受信はありません')).toBeNull();
  });

  it('shows an empty state only when the request succeeds with no items', () => {
    const data = buildInboxData();
    data.data.summary.filtered_count = 0;
    data.data.items = [];
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      if (options.queryKey[0] === 'communications-inbound-signals') {
        return {
          data: buildSignalData(),
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }

      return {
        data,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    });

    render(<InboundCommunicationsContent />);

    expect(screen.getByText('確認待ちの他職種受信はありません')).toBeTruthy();
  });

  it('updates the query key when channel and priority filters change', () => {
    render(<InboundCommunicationsContent />);

    fireEvent.click(screen.getByRole('button', { name: '電話' }));
    fireEvent.click(screen.getByRole('button', { name: '至急' }));

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['communications-inbound', 'org_1', 'phone', 'urgent', 'needs_review'],
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['communications-inbound-signals', 'org_1', 'phone'],
      }),
    );
  });

  it('submits a structured phone memo through the inbound phone endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'event_1',
            status: 'needs_review',
            action_href: '/communications/inbound',
          },
          meta: { generated_at: '2026-07-07T03:00:00.000Z' },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<InboundCommunicationsContent />);

    fireEvent.change(screen.getAllByLabelText('患者ID')[0], { target: { value: 'patient_1' } });
    fireEvent.change(screen.getByLabelText('相手'), { target: { value: '訪問看護師A' } });
    fireEvent.click(screen.getAllByRole('button', { name: '残数報告' })[0]);
    fireEvent.change(screen.getByLabelText('電話メモ本文'), {
      target: { value: '湿布は残り4枚です。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '電話メモを登録' }));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'patient_1',
        counterpartName: '訪問看護師A',
        eventType: 'medication_stock_report',
        content: '湿布は残り4枚です。',
      }),
    );

    const mutationOptions = useMutationMock.mock.calls[0]?.[0] as {
      mutationFn: (input: {
        patientId: string;
        caseId: string;
        counterpartName: string;
        counterpartContact: string;
        eventType: string;
        content: string;
      }) => Promise<unknown>;
      onSuccess: () => Promise<void>;
    };
    await mutationOptions.mutationFn({
      patientId: 'patient_1',
      caseId: '',
      counterpartName: '訪問看護師A',
      counterpartContact: '',
      eventType: 'medication_stock_report',
      content: '湿布は残り4枚です。',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/communications/inbound/phone',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-org-id': 'org_1',
        }),
        body: JSON.stringify({
          patient_id: 'patient_1',
          counterpart_name: '訪問看護師A',
          event_type: 'medication_stock_report',
          content: '湿布は残り4枚です。',
        }),
      }),
    );

    await act(async () => {
      await mutationOptions.onSuccess();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('電話メモを受信キューに登録しました');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communications-inbound', 'org_1'],
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communications-inbound-signals', 'org_1'],
    });
  });

  it('submits an MCS pasted post through the inbound mcs endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'event_mcs_1',
            status: 'needs_review',
            action_href: '/patients/patient_1/mcs',
          },
          meta: { generated_at: '2026-07-07T03:00:00.000Z' },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<InboundCommunicationsContent />);

    fireEvent.change(screen.getAllByLabelText('患者ID')[1], { target: { value: 'patient_1' } });
    fireEvent.change(screen.getByLabelText('投稿者'), { target: { value: '訪問看護師A' } });
    fireEvent.change(screen.getByLabelText('職種'), { target: { value: '訪問看護師' } });
    fireEvent.change(screen.getByLabelText('所属'), { target: { value: '訪看ステーション' } });
    fireEvent.change(screen.getByLabelText('MCSスレッドURL'), {
      target: { value: 'https://www.medical-care.net/projects/medical/57886227' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: '残数報告' })[1]);
    fireEvent.change(screen.getByLabelText('MCS投稿本文'), {
      target: { value: 'カロナールは残り6錠です。' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'MCS投稿を登録' }));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'patient_1',
        senderName: '訪問看護師A',
        senderRole: '訪問看護師',
        senderOrganization: '訪看ステーション',
        sourceUrl: 'https://www.medical-care.net/projects/medical/57886227',
        eventType: 'medication_stock_report',
        content: 'カロナールは残り6錠です。',
      }),
    );

    const mutationOptions = useMutationMock.mock.calls[1]?.[0] as {
      mutationFn: (input: {
        patientId: string;
        caseId: string;
        senderName: string;
        senderRole: string;
        senderOrganization: string;
        sourceUrl: string;
        eventType: string;
        content: string;
      }) => Promise<unknown>;
      onSuccess: () => Promise<void>;
    };
    await mutationOptions.mutationFn({
      patientId: 'patient_1',
      caseId: '',
      senderName: '訪問看護師A',
      senderRole: '訪問看護師',
      senderOrganization: '訪看ステーション',
      sourceUrl: 'https://www.medical-care.net/projects/medical/57886227',
      eventType: 'medication_stock_report',
      content: 'カロナールは残り6錠です。',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/communications/inbound/mcs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-org-id': 'org_1',
        }),
        body: JSON.stringify({
          patient_id: 'patient_1',
          sender_name: '訪問看護師A',
          sender_role: '訪問看護師',
          sender_organization: '訪看ステーション',
          source_url: 'https://www.medical-care.net/projects/medical/57886227',
          event_type: 'medication_stock_report',
          content: 'カロナールは残り6錠です。',
        }),
      }),
    );

    await act(async () => {
      await mutationOptions.onSuccess();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('MCS投稿を受信キューに登録しました');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communications-inbound', 'org_1'],
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communications-inbound-signals', 'org_1'],
    });
  });
});
