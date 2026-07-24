import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getInboundContentTestSupport } from './inbound-content.test-support';

const {
  buildDetailData,
  buildInboxData,
  buildMedicationStockData,
  buildSignalData,
  clientLogWarnMock,
  InboundCommunicationsContent,
  invalidateQueriesMock,
  mutateMock,
  toastErrorMock,
  useMutationMock,
  useOrgIdMock,
  useQueryMock,
} = getInboundContentTestSupport();

export function registerInboundDetailCases() {
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

      if (options.queryKey[0] === 'patient-medication-stock-summary') {
        return {
          data: buildMedicationStockData(),
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
    expect(screen.getByText('出所詳細')).toBeTruthy();
    expect(screen.getByText('正規化要約')).toBeTruthy();
    expect(screen.getByText('外用薬の残数確認')).toBeTruthy();

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

  it('keeps a failed audited-detail payload out of the DOM and logs only static context', () => {
    const poisonError = new Error('佐藤花子 様 / 090-1234-5678 / token=secret');
    const refetchMock = vi.fn();
    useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
      if (options.queryKey[0] === 'communications-inbound-detail') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          isFetching: false,
          error: poisonError,
          refetch: refetchMock,
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

      if (options.queryKey[0] === 'patient-medication-stock-summary') {
        return {
          data: undefined,
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

    render(<InboundCommunicationsContent />);
    fireEvent.click(screen.getByRole('button', { name: '原文を監査付きで表示' }));

    expect(screen.getByText('受信詳細を表示できません')).toBeTruthy();
    expect(screen.getByText(/詳細取得に失敗しました。/)).toBeTruthy();
    expect(screen.queryByText(poisonError.message)).toBeNull();
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'inbound_communication.detail_load_failed',
      poisonError,
      {
        route: '/communications/inbound',
        entityType: 'inbound_communication_detail',
        code: 'INBOUND_DETAIL_LOAD_FAILED',
      },
    );

    fireEvent.click(screen.getByRole('button', { name: '詳細を再取得' }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed stock-summary payload out of the DOM and logs only static context', () => {
    const signalData = buildSignalData();
    signalData.data.items[0].signal.review_status = 'accepted';
    signalData.data.items[0].signal.stock_review!.has_medication_identity = true;
    const poisonError = new Error('佐藤花子 様の残数 4枚 / token=secret');
    const refetchMock = vi.fn();
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
          data: signalData,
          isLoading: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        };
      }

      if (options.queryKey[0] === 'patient-medication-stock-summary') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          isFetching: false,
          error: poisonError,
          refetch: refetchMock,
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

    render(<InboundCommunicationsContent />);
    fireEvent.click(screen.getByRole('button', { name: '原文を監査付きで表示' }));

    expect(screen.getByText('残数管理候補を取得できません')).toBeTruthy();
    expect(screen.getByText(/残数管理候補の取得に失敗しました。/)).toBeTruthy();
    expect(screen.queryByText(poisonError.message)).toBeNull();
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'inbound_communication.stock_summary_load_failed',
      poisonError,
      {
        route: '/communications/inbound',
        entityType: 'patient_medication_stock_summary',
        code: 'INBOUND_STOCK_SUMMARY_LOAD_FAILED',
      },
    );

    fireEvent.click(screen.getByRole('button', { name: '候補を再取得' }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps all inbound mutation failures PHI-safe with static recovery copy', () => {
    const poisonError = new Error('佐藤花子 様 / 090-1234-5678 / token=secret');

    render(<InboundCommunicationsContent />);

    const mutationOptions = useMutationMock.mock.calls.map(
      ([options]) => options as { onError?: (error: unknown) => void },
    );
    const failures = [
      {
        index: 0,
        event: 'inbound_communication.intake_create_failed',
        message: '受信情報を登録できませんでした',
        context: {
          route: '/communications/inbound',
          entityType: 'inbound_communication',
          code: 'INBOUND_INTAKE_CREATE_FAILED',
        },
      },
      {
        index: 1,
        event: 'inbound_communication.pharmacist_task_create_failed',
        message: '薬剤師確認タスクを作成できませんでした',
        context: {
          route: '/communications/inbound',
          entityType: 'inbound_signal_task',
          code: 'INBOUND_SIGNAL_TASK_CREATE_FAILED',
        },
      },
      {
        index: 2,
        event: 'inbound_communication.signal_review_failed',
        message: '受信シグナルのレビュー状態を更新できませんでした',
        context: {
          route: '/communications/inbound',
          entityType: 'inbound_signal',
          code: 'INBOUND_SIGNAL_REVIEW_FAILED',
        },
      },
      {
        index: 3,
        event: 'inbound_communication.stock_apply_failed',
        message: '残数台帳へ反映できませんでした',
        context: {
          route: '/communications/inbound',
          entityType: 'medication_stock_observation',
          code: 'INBOUND_STOCK_APPLY_FAILED',
        },
      },
      {
        index: 4,
        event: 'inbound_communication.source_mapping_save_failed',
        message: '出所mappingを保存できませんでした',
        context: {
          route: '/communications/inbound',
          entityType: 'inbound_source_mapping',
          code: 'INBOUND_SOURCE_MAPPING_SAVE_FAILED',
        },
      },
    ];

    for (const failure of failures) {
      const onError = mutationOptions[failure.index]?.onError;
      expect(onError).toEqual(expect.any(Function));
      onError?.(poisonError);
      expect(toastErrorMock).toHaveBeenLastCalledWith(failure.message);
      expect(clientLogWarnMock).toHaveBeenLastCalledWith(
        failure.event,
        poisonError,
        failure.context,
      );
    }

    expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain(poisonError.message);
    expect(
      JSON.stringify(clientLogWarnMock.mock.calls.map(([, , context]) => context)),
    ).not.toContain(poisonError.message);
  });

  it('submits source mapping after audited detail and retries the exact failed input', async () => {
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      const [input] = args;
      const url = String(input);
      if (url.includes('/source-mapping')) {
        return new Response(
          JSON.stringify({
            data: {
              mapping_id: 'mapping_1',
              inbound_event_id: 'event_1',
              patient_id: 'patient_1',
              case_id: 'case_1',
              source_system: 'phone',
              mapping_status: 'needs_review',
              confidence: 'probable',
              created_at: '2026-07-08T01:00:00.000Z',
              reviewed_at: null,
            },
            meta: { generated_at: '2026-07-08T01:00:00.000Z' },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify(buildDetailData()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<InboundCommunicationsContent />);

    expect(screen.queryByTestId('inbound-source-mapping-panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '原文を監査付きで表示' }));
    const panel = within(screen.getByTestId('inbound-source-mapping-panel'));
    expect(panel.getByText('出所mapping')).toBeTruthy();
    expect(panel.getByText(/payload には送信しません/)).toBeTruthy();

    fireEvent.click(panel.getByRole('button', { name: '詳細から候補を入力' }));
    expect((panel.getByLabelText('mapping患者ID') as HTMLInputElement).value).toBe('patient_1');
    expect((panel.getByLabelText('mappingケースID') as HTMLInputElement).value).toBe('case_1');
    expect((panel.getByLabelText('外部連絡者名') as HTMLInputElement).value).toBe('訪問看護師A');
    expect((panel.getByLabelText('外部職種') as HTMLInputElement).value).toBe('nurse');
    expect((panel.getByLabelText('外部所属') as HTMLInputElement).value).toBe(
      '訪問看護ステーションA',
    );

    fireEvent.change(panel.getByLabelText('MCS thread key'), {
      target: { value: 'phone:09012345678' },
    });
    fireEvent.click(panel.getByRole('button', { name: '出所mappingを保存' }));

    const attemptedInput = mutateMock.mock.calls[0]?.[0] as {
      eventId: string;
      form: {
        patientId: string;
        caseId: string;
        externalPatientLabel: string;
        externalThreadId: string;
        externalRoomId: string;
        externalContactName: string;
        externalContactRole: string;
        externalOrganizationName: string;
        confidence: 'probable';
        mappingStatus: 'needs_review';
      };
    };
    expect(attemptedInput).toEqual({
      eventId: 'event_1',
      form: expect.objectContaining({
        patientId: 'patient_1',
        caseId: 'case_1',
        externalThreadId: 'phone:09012345678',
        externalContactName: '訪問看護師A',
        externalContactRole: 'nurse',
        externalOrganizationName: '訪問看護ステーションA',
        confidence: 'probable',
        mappingStatus: 'needs_review',
      }),
    });

    const mutationOptions = useMutationMock.mock.calls.find(([options]) =>
      String(options.mutationFn).includes('source-mapping'),
    )?.[0] as {
      mutationFn: (input: typeof attemptedInput) => Promise<unknown>;
      onError: (error: Error, input: typeof attemptedInput) => void;
    };
    await mutationOptions.mutationFn({
      eventId: 'event_1',
      form: {
        patientId: 'patient_1',
        caseId: 'case_1',
        externalPatientLabel: '',
        externalThreadId: 'phone:09012345678',
        externalRoomId: '',
        externalContactName: '訪問看護師A',
        externalContactRole: 'nurse',
        externalOrganizationName: '訪問看護ステーションA',
        confidence: 'probable',
        mappingStatus: 'needs_review',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/communications/inbound/event_1/source-mapping',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-org-id': 'org_1',
        }),
      }),
    );
    const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const requestBody = JSON.parse(String(requestInit.body)) as Record<string, unknown>;
    expect(requestBody).toEqual({
      patient_id: 'patient_1',
      case_id: 'case_1',
      external_thread_id: 'phone:09012345678',
      external_contact_name: '訪問看護師A',
      external_contact_role: 'nurse',
      external_organization_name: '訪問看護ステーションA',
      confidence: 'probable',
      mapping_status: 'needs_review',
    });
    expect(JSON.stringify(requestBody)).not.toContain('湿布は残り4枚です');
    expect(JSON.stringify(requestBody)).not.toContain('090-1234-5678');
    expect(JSON.stringify(requestBody)).not.toContain('sender_contact');
    expect(JSON.stringify(requestBody)).not.toContain('raw_text');
    expect(JSON.stringify(requestBody)).not.toContain('source_url');
    expect(JSON.stringify(requestBody)).not.toContain('source_system');
    expect(JSON.stringify(requestBody)).not.toContain('externalThreadId');

    const poisonError = new Error('佐藤花子 様 / 090-1234-5678 / token=secret');
    act(() => {
      mutationOptions.onError(poisonError, attemptedInput);
    });

    const updatedPanel = within(screen.getByTestId('inbound-source-mapping-panel'));
    expect((updatedPanel.getByLabelText('mapping患者ID') as HTMLInputElement).value).toBe(
      'patient_1',
    );
    expect((updatedPanel.getByLabelText('MCS thread key') as HTMLInputElement).value).toBe(
      'phone:09012345678',
    );
    expect(updatedPanel.getAllByText('出所mappingを保存できませんでした')).toHaveLength(1);
    expect(
      updatedPanel.getByText(
        '保存処理に失敗しました。入力内容と監査済み詳細は保持されています。 通信状態を確認して、同じmapping内容を再試行してください。',
      ),
    ).toBeTruthy();
    expect(updatedPanel.queryByText(poisonError.message)).toBeNull();

    fireEvent.click(updatedPanel.getByRole('button', { name: '出所mappingの保存を再試行' }));

    expect(mutateMock).toHaveBeenCalledTimes(2);
    expect(mutateMock).toHaveBeenNthCalledWith(1, attemptedInput);
    expect(mutateMock).toHaveBeenNthCalledWith(2, attemptedInput);
  });
}
