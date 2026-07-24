import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { getInboundContentTestSupport } from './inbound-content.test-support';

const {
  buildDetailData,
  buildInboxData,
  buildMedicationStockData,
  buildSignalData,
  InboundCommunicationsContent,
  invalidateQueriesMock,
  mutateMock,
  toastSuccessMock,
  useMutationMock,
  useQueryMock,
} = getInboundContentTestSupport();

export function registerInboundReviewCases() {
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

  it('shows the review lifecycle and keeps MedicationStock apply blocked without an explicit stock target', () => {
    render(<InboundCommunicationsContent />);

    const lifecycle = within(screen.getByTestId('signal-lifecycle-signal_1'));
    expect(lifecycle.getByText('作業ライフサイクル')).toBeTruthy();
    expect(lifecycle.getByText('受信')).toBeTruthy();
    expect(lifecycle.getByText('初期評価')).toBeTruthy();
    expect(lifecycle.getByText('レビュー')).toBeTruthy();
    expect(lifecycle.getByText('反映/クローズ')).toBeTruthy();
    expect(lifecycle.getByText('要レビュー')).toBeTruthy();
    expect(lifecycle.getAllByText('未完了').length).toBeGreaterThan(0);

    const policy = within(screen.getByTestId('stock-apply-policy-signal_1'));
    expect(policy.getByText('MedicationStock 適用条件')).toBeTruthy();
    expect(policy.getByText('台帳直書き不可')).toBeTruthy();
    expect(policy.getByText('患者/ケース')).toBeTruthy();
    expect(policy.getByText('対象薬剤')).toBeTruthy();
    expect(policy.getByText('観測内容')).toBeTruthy();
    expect(policy.getByText('薬剤師レビュー')).toBeTruthy();
    expect(policy.getByText('対象薬剤未確定。薬剤師が残数管理で明示選択します')).toBeTruthy();
    expect(policy.getByText(/apply_to_medication_stock/)).toBeTruthy();

    const reviewPanelText = screen.getByTestId('selected-inbound-review-panel').textContent ?? '';
    expect(reviewPanelText).not.toContain('target_stock_item_id:');
    expect(reviewPanelText).not.toContain('湿布は残り4枚です');
    expect(screen.queryByRole('button', { name: /台帳.*反映|残数.*反映/ })).toBeNull();
  });

  it('enables MedicationStock apply after audited detail and retries the exact failed input', async () => {
    const signalData = buildSignalData();
    signalData.data.items[0].signal.review_status = 'accepted';
    signalData.data.items[0].signal.stock_review!.has_medication_identity = true;
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      const [input] = args;
      const url = String(input);
      if (url.includes('/medication-stock?item_limit=20&event_limit=0')) {
        return new Response(JSON.stringify(buildMedicationStockData()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({
          data: {
            signal_id: 'signal_1',
            inbound_event_id: 'event_1',
            stock_item_id: 'stock_item_1',
            stock_event_id: 'stock_event_1',
            external_observation_id: 'external_observation_1',
            review_status: 'accepted',
            action_status: 'linked_to_stock_event',
            review_task_closure_count: 0,
            idempotent_replay: false,
          },
          meta: { generated_at: '2026-07-07T03:00:00.000Z' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
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

    render(<InboundCommunicationsContent />);

    const selectorBeforeDetail = within(screen.getByTestId('stock-apply-selector-signal_1'));
    expect(selectorBeforeDetail.getByText(/原文・出所を監査付きで確認/)).toBeTruthy();
    expect(selectorBeforeDetail.queryByRole('button', { name: '残数台帳へ反映' })).toBeNull();
    const stockQueryBeforeDetail = useQueryMock.mock.calls
      .filter(([options]) => options.queryKey[0] === 'patient-medication-stock-summary')
      .at(-1)?.[0] as { enabled: boolean };
    expect(stockQueryBeforeDetail.enabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '原文を監査付きで表示' }));

    const selector = within(screen.getByTestId('stock-apply-selector-signal_1'));
    expect(selector.getByText('対象薬剤')).toBeTruthy();
    expect(selector.getByDisplayValue('現在残数')).toBeTruthy();
    const stockQueryAfterDetail = useQueryMock.mock.calls
      .filter(([options]) => options.queryKey[0] === 'patient-medication-stock-summary')
      .at(-1)?.[0] as {
      enabled: boolean;
      queryFn: () => Promise<unknown>;
    };
    expect(stockQueryAfterDetail.enabled).toBe(true);

    // shadcn Select: トリガー click → option click(option はポータル描画のため screen 全体から)。
    fireEvent.click(selector.getByLabelText('対象薬剤'));
    fireEvent.click(screen.getByRole('option', { name: '経皮鎮痛貼付剤 / 枚' }));
    fireEvent.change(selector.getByPlaceholderText('明示入力'), {
      target: { value: '4' },
    });

    const applyButton = selector.getByRole('button', { name: '残数台帳へ反映' });
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(applyButton);

    const attemptedInput = {
      signalId: 'signal_1',
      targetStockItemId: 'stock_item_1',
      idempotencyKey: 'inbound-stock-apply:v1:signal_1:stock_item_1:observed_absolute:枚:4:::',
      observation: {
        kind: 'observed_absolute',
        quantity: 4,
        unit: '枚',
      },
    } as const;
    expect(mutateMock).toHaveBeenCalledWith(attemptedInput);

    const mutationOptions = useMutationMock.mock.calls.find(([options]) =>
      String(options.mutationFn).includes('apply_to_medication_stock'),
    )?.[0] as {
      mutationFn: (input: {
        signalId: string;
        targetStockItemId: string;
        idempotencyKey: string;
        observation: { kind: 'observed_absolute'; quantity: number; unit: string };
      }) => Promise<unknown>;
      onError: (error: Error, input: typeof attemptedInput) => void;
    };
    await mutationOptions.mutationFn(attemptedInput);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/communications/inbound/signals/signal_1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ 'x-org-id': 'org_1' }),
      }),
    );
    const requestInit = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const requestBody = JSON.parse(String(requestInit.body));
    expect(requestBody).toEqual({
      action: 'apply_to_medication_stock',
      target_stock_item_id: 'stock_item_1',
      idempotency_key: 'inbound-stock-apply:v1:signal_1:stock_item_1:observed_absolute:枚:4:::',
      observation: { kind: 'observed_absolute', quantity: 4, unit: '枚' },
    });
    expect(JSON.stringify(requestBody)).not.toContain('湿布は残り4枚です');
    expect(JSON.stringify(requestBody)).not.toContain('訪問看護師A');
    expect(JSON.stringify(requestBody)).not.toContain('090-1234-5678');
    expect(JSON.stringify(requestBody)).not.toContain('storageKey');

    await stockQueryAfterDetail.queryFn();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/patients/patient_1/medication-stock?item_limit=20&event_limit=0',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-org-id': 'org_1' }),
      }),
    );

    const poisonError = new Error('佐藤花子 様 / ロキソニン / token=secret');
    act(() => {
      mutationOptions.onError(poisonError, attemptedInput);
    });

    const updatedSelector = within(screen.getByTestId('stock-apply-selector-signal_1'));
    expect(updatedSelector.getByDisplayValue('4')).toBeTruthy();
    expect(updatedSelector.getAllByText('残数台帳へ反映できませんでした')).toHaveLength(1);
    expect(
      updatedSelector.getByText(
        '反映処理に失敗しました。入力内容と受信シグナルは保持されています。 通信状態を確認して、同じ反映内容を再試行してください。',
      ),
    ).toBeTruthy();
    expect(updatedSelector.queryByText(poisonError.message)).toBeNull();

    fireEvent.click(updatedSelector.getByRole('button', { name: '残数台帳への反映を再試行' }));

    expect(mutateMock).toHaveBeenCalledTimes(2);
    expect(mutateMock).toHaveBeenNthCalledWith(1, attemptedInput);
    expect(mutateMock).toHaveBeenNthCalledWith(2, attemptedInput);
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

    const mutationOptions = useMutationMock.mock.calls[1]?.[0] as {
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

  it('shows task failure on the affected signal and retries the same candidate key', () => {
    const poisonError = new Error('佐藤花子 様 / 090-1234-5678 / token=secret');
    const taskMutateMock = vi.fn();
    useMutationMock.mockImplementation((options) => {
      const isTaskMutation = String(options.mutationFn).includes(
        '/api/communications/inbound/signals/tasks',
      );
      return {
        mutate: isTaskMutation
          ? (candidateKey: string) => {
              taskMutateMock(candidateKey);
              options.onError?.(poisonError, candidateKey);
            }
          : mutateMock,
        isPending: false,
        ...options,
      };
    });

    render(<InboundCommunicationsContent />);

    const reviewPanel = within(screen.getByTestId('selected-inbound-review-panel'));
    fireEvent.click(reviewPanel.getByRole('button', { name: '薬剤師確認タスク化' }));
    expect(taskMutateMock).toHaveBeenCalledWith('inbound_signal:signal_1');
    const updatedReviewPanel = within(screen.getByTestId('selected-inbound-review-panel'));

    expect(updatedReviewPanel.getAllByText('薬剤師確認タスクを作成できませんでした')).toHaveLength(
      1,
    );
    expect(
      updatedReviewPanel.getByText(
        'タスク作成処理に失敗しました。受信シグナルは保持されています。 通信状態を確認して再試行してください。',
      ),
    ).toBeTruthy();
    expect(updatedReviewPanel.queryByText(poisonError.message)).toBeNull();

    fireEvent.click(updatedReviewPanel.getByRole('button', { name: 'タスク作成を再試行' }));

    expect(taskMutateMock).toHaveBeenCalledTimes(2);
    expect(taskMutateMock).toHaveBeenNthCalledWith(1, 'inbound_signal:signal_1');
    expect(taskMutateMock).toHaveBeenNthCalledWith(2, 'inbound_signal:signal_1');
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

    const mutationOptions = useMutationMock.mock.calls[2]?.[0] as {
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

  it('shows review failure on the affected signal and retries the same action', () => {
    const poisonError = new Error('佐藤花子 様 / 090-1234-5678 / token=secret');
    render(<InboundCommunicationsContent />);

    const mutationOptions = useMutationMock.mock.calls[2]?.[0] as {
      onError: (
        error: Error,
        input: { signalId: string; action: 'accept' | 'record_only' | 'reject' },
      ) => void;
    };
    const attemptedInput = { signalId: 'signal_1', action: 'record_only' } as const;

    act(() => {
      mutationOptions.onError(poisonError, attemptedInput);
    });

    const updatedReviewPanel = within(screen.getByTestId('selected-inbound-review-panel'));
    expect(
      updatedReviewPanel.getAllByText('受信シグナルのレビュー状態を更新できませんでした'),
    ).toHaveLength(1);
    expect(
      updatedReviewPanel.getByText(
        'レビュー状態の更新に失敗しました。受信シグナルは保持されています。 通信状態を確認して、選択した操作を再試行してください。',
      ),
    ).toBeTruthy();
    expect(updatedReviewPanel.queryByText(poisonError.message)).toBeNull();

    fireEvent.click(updatedReviewPanel.getByRole('button', { name: 'レビュー操作を再試行' }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledWith(attemptedInput);
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
    expect(reviewPanel.getAllByText('未反映').length).toBeGreaterThan(0);
    expect(
      reviewPanel.getByText(/原文・出所を監査付きで確認すると、反映先候補を取得できます/),
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
    const list = screen.getByRole('list', { name: '他職種受信一覧' });
    expect(list.querySelector(':scope > [role="listitem"]')).toBeTruthy();
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

  it('submits a canonical fax/email/manual intake through the unified inbound endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'event_fax_1',
            channel: 'email',
            event_type: 'side_effect_report',
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

    const intakeForm = within(screen.getByTestId('inbound-intake-form'));
    expect(intakeForm.getByRole('button', { name: /FAX/ })).toBeTruthy();
    expect(intakeForm.getByRole('button', { name: /メール/ })).toBeTruthy();
    expect(intakeForm.getByRole('button', { name: /手入力/ })).toBeTruthy();
    expect(intakeForm.queryByRole('button', { name: '電話' })).toBeNull();
    expect(intakeForm.queryByRole('button', { name: 'MCS' })).toBeNull();

    fireEvent.click(intakeForm.getByRole('button', { name: /メール/ }));
    fireEvent.change(intakeForm.getByLabelText('患者ID'), { target: { value: 'patient_1' } });
    fireEvent.change(intakeForm.getByLabelText('送信者'), { target: { value: '訪問看護師A' } });
    // shadcn(Base UI) Select: virtual click(detail=0)は highlighted item しか選択しないため、
    // pointerDown → 実クリック(detail:1) で非 highlight の option も確実に選択する。
    fireEvent.click(intakeForm.getByLabelText('職種'));
    const roleOption = screen.getByRole('option', { name: '訪問看護師' });
    fireEvent.pointerDown(roleOption);
    fireEvent.click(roleOption, { detail: 1 });
    expect(intakeForm.getByLabelText('職種').textContent).toContain('訪問看護師');
    fireEvent.change(intakeForm.getByLabelText('所属'), {
      target: { value: '訪問看護ステーションA' },
    });
    fireEvent.change(intakeForm.getByLabelText('送信元連絡先'), {
      target: { value: 'nurse@example.test' },
    });
    fireEvent.click(intakeForm.getByRole('button', { name: '薬剤安全' }));
    fireEvent.change(intakeForm.getByLabelText('受信本文'), {
      target: { value: '湿布は残り4枚です。' },
    });
    fireEvent.click(intakeForm.getByRole('button', { name: '受信情報を登録' }));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceChannel: 'email',
        patientId: 'patient_1',
        senderName: '訪問看護師A',
        senderRole: 'nurse',
        senderOrganizationName: '訪問看護ステーションA',
        senderContact: 'nurse@example.test',
        eventType: 'side_effect_report',
        rawText: '湿布は残り4枚です。',
      }),
    );

    const mutationOptions = useMutationMock.mock.calls[0]?.[0] as {
      mutationFn: (input: {
        sourceChannel: 'email';
        patientId: string;
        caseId: string;
        senderName: string;
        senderRole: 'nurse';
        senderOrganizationName: string;
        senderContact: string;
        eventType: string;
        rawText: string;
      }) => Promise<unknown>;
      onSuccess: () => Promise<void>;
    };
    await mutationOptions.mutationFn({
      sourceChannel: 'email',
      patientId: 'patient_1',
      caseId: '',
      senderName: '訪問看護師A',
      senderRole: 'nurse',
      senderOrganizationName: '訪問看護ステーションA',
      senderContact: 'nurse@example.test',
      eventType: 'side_effect_report',
      rawText: '湿布は残り4枚です。',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/communications/inbound',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-org-id': 'org_1',
        }),
      }),
    );
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(requestBody).sort()).toEqual([
      'event_type',
      'patient_id',
      'raw_text',
      'sender_contact',
      'sender_name',
      'sender_organization_name',
      'sender_role',
      'source_channel',
    ]);
    expect(requestBody).toMatchObject({
      source_channel: 'email',
      patient_id: 'patient_1',
      sender_name: '訪問看護師A',
      sender_role: 'nurse',
      sender_organization_name: '訪問看護ステーションA',
      sender_contact: 'nurse@example.test',
      event_type: 'side_effect_report',
      raw_text: '湿布は残り4枚です。',
    });
    expect(JSON.stringify(requestBody)).not.toContain('content');
    expect(JSON.stringify(requestBody)).not.toContain('subject');
    expect(JSON.stringify(requestBody)).not.toContain('source_url');
    expect(JSON.stringify(requestBody)).not.toContain('attachment');

    await act(async () => {
      await mutationOptions.onSuccess();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('受信情報をレビューキューに登録しました');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communications-inbound', 'org_1'],
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['communications-inbound-signals', 'org_1'],
    });
  });

  it('preserves intake input and retries the current payload from a persistent error state', () => {
    const poisonError = new Error('佐藤花子 様 / 090-1234-5678 / token=secret');
    let mutationHookIndex = 0;
    let showIntakeError = false;
    useMutationMock.mockImplementation((options) => {
      const isIntakeMutation = mutationHookIndex % 5 === 0;
      mutationHookIndex += 1;
      return {
        mutate: mutateMock,
        isPending: false,
        isError: isIntakeMutation && showIntakeError,
        error: isIntakeMutation && showIntakeError ? poisonError : null,
        ...options,
      };
    });

    const { rerender } = render(<InboundCommunicationsContent />);
    const intakeForm = within(screen.getByTestId('inbound-intake-form'));
    fireEvent.change(intakeForm.getByLabelText('患者ID'), { target: { value: 'patient_1' } });
    fireEvent.change(intakeForm.getByLabelText('受信本文'), {
      target: { value: '湿布は残り4枚です。' },
    });

    showIntakeError = true;
    rerender(<InboundCommunicationsContent />);

    expect(intakeForm.getByText('受信情報を登録できませんでした')).toBeTruthy();
    expect(
      intakeForm.getByText(
        '登録処理に失敗しました。入力内容は保持されています。 通信状態を確認して再試行してください。',
      ),
    ).toBeTruthy();
    expect(intakeForm.queryByText(poisonError.message)).toBeNull();
    expect((intakeForm.getByLabelText('患者ID') as HTMLInputElement).value).toBe('patient_1');
    expect((intakeForm.getByLabelText('受信本文') as HTMLTextAreaElement).value).toBe(
      '湿布は残り4枚です。',
    );

    fireEvent.click(intakeForm.getByRole('button', { name: '登録を再試行' }));

    expect(mutateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        patientId: 'patient_1',
        rawText: '湿布は残り4枚です。',
      }),
    );
  });
}
