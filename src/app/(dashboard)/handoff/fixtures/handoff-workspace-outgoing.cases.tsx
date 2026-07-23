import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { getHandoffWorkspaceTestSupport } from './handoff-workspace.test-support';

const {
  BOARD,
  fetchHandoffBoard,
  fetchHandoffConfirmationTasks,
  fetchOperationCockpit,
  fetchRecentComments,
  fetchVisitHandoff,
  jsonResponse,
  renderWorkspace,
  stubFetch,
  submitCompleteTransferDraft,
  toast,
  useAuthStore,
} = getHandoffWorkspaceTestSupport();

export function registerHandoffOutgoingCases() {
  it('keeps API messages from failed handoff workspace read fetches', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: 'ハンドオフデータを表示できません' }, 403),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHandoffBoard('org_1')).rejects.toThrow('ハンドオフデータを表示できません');
    await expect(fetchOperationCockpit('org_1')).rejects.toThrow(
      'ハンドオフデータを表示できません',
    );
    await expect(fetchHandoffConfirmationTasks('org_1')).rejects.toThrow(
      'ハンドオフデータを表示できません',
    );
    await expect(fetchRecentComments('org_1')).rejects.toThrow('ハンドオフデータを表示できません');
    await expect(fetchVisitHandoff('org_1', 'visit_record_1')).rejects.toThrow(
      'ハンドオフデータを表示できません',
    );

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/handoff-board',
      '/api/dashboard/cockpit',
      '/api/tasks?status=pending&task_types=handoff_confirmation%2Chandoff_supervision_review',
      '/api/comments/recent',
      '/api/visit-records/visit_record_1/handoff',
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ 'x-org-id': 'org_1' });
    }
  });

  it('preserves visit record version from the handoff detail response', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: {
          next_check_items: ['残薬を確認'],
          ongoing_monitoring: ['眠気'],
          decision_rationale: '訪問時に眠気の訴えあり',
          ai_extracted: true,
          ai_confidence: 0.88,
          confirmed_by: null,
          confirmed_at: null,
          extracted_at: '2026-06-11T00:00:00.000Z',
        },
        meta: {
          visit_record_version: 7,
          visit_record_updated_at: '2026-06-11T00:00:00.000Z',
          confirmation_policy: {
            can_confirm: true,
            requires_override_reason: false,
            authorized_basis: 'assigned_schedule',
            override_reason_max_length: 500,
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVisitHandoff('org_1', 'visit_record_1')).resolves.toMatchObject({
      data: { next_check_items: ['残薬を確認'] },
      meta: {
        visit_record_version: 7,
        confirmation_policy: { can_confirm: true },
      },
    });
  });

  it('rejects legacy root metadata from the visit handoff response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        jsonResponse({
          data: {
            next_check_items: ['残薬を確認'],
            ongoing_monitoring: ['眠気'],
            decision_rationale: '訪問時に眠気の訴えあり',
            ai_extracted: true,
            ai_confidence: 0.88,
            confirmed_by: null,
            confirmed_at: null,
            extracted_at: '2026-06-11T00:00:00.000Z',
          },
          visit_record_version: 7,
          confirmation_policy: { can_confirm: true },
        }),
      ),
    );

    await expect(fetchVisitHandoff('org_1', 'visit_record_1')).rejects.toThrow(
      '訪問申し送りの取得に失敗しました',
    );
  });

  it('renders 私が渡した cards with status badges, 3-point summaries and rule bar', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch();
    renderWorkspace();

    expect(screen.getByText('ハンドオフ')).toBeTruthy();
    // 主操作(青)は「+ 仕事を渡す」1 つだけ
    expect(screen.getByTestId('handoff-open-transfer')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByTestId('visit-handoff-confirmation-workspace')).toBeTruthy();
    });
    expect(screen.getByText('訪問申し送り確認')).toBeTruthy();
    expect(screen.getByText('申し送り確認: 田中 一郎')).toBeTruthy();
    expect(screen.getByText('残薬を確認')).toBeTruthy();

    // ヘッダーメタ(渡した/来た)
    expect(screen.getByText(/渡した3・来た0/)).toBeTruthy();
    expect(
      screen.getByText(/3件 — 渡す=責任の移動。受領確認と根拠が必ず記録されます/),
    ).toBeTruthy();

    // 状態バッジ: 承諾待ち(紫)/作業中 9\/12(青)/確認中(橙)
    expect(screen.getByText('承諾待ち')).toBeTruthy();
    expect(screen.getByText('作業中 9/12')).toBeTruthy();
    expect(screen.getByText(/^確認中/)).toBeTruthy();

    // 件名 → 宛先
    expect(screen.getByText('判断キュー 定型12件 → 佐藤さん')).toBeTruthy();
    expect(screen.getByText('セット先行準備(施設GH) → 鈴木さん(事務)')).toBeTruthy();
    expect(screen.getByText('送付先の確認(やまもと内科) → 事務')).toBeTruthy();

    // 3点セット要約と戻り先リンク
    expect(
      screen.getByText('根拠: 判断WIP 18/目安12 — あなたの余白11分では捌けないため'),
    ).toBeTruthy();
    expect(
      screen.getByText('許可済みの範囲: 数量セットまで。最終確認は薬剤師(あなた)'),
    ).toBeTruthy();
    expect(screen.getByText('→ ダッシュボードへ')).toBeTruthy();
    expect(screen.getByText('→ セットへ')).toBeTruthy();
    expect(screen.getByText('→ 報告・共有へ')).toBeTruthy();
    expect(screen.getByRole('link', { name: '状況を聞く' }).getAttribute('href')).toBe(
      '/communications/requests?status=sent',
    );

    // 私に来た: 0 件は done(緑) success 表現ではなく neutral な空状態 + チームルール注記
    const incomingEmpty = screen.getByTestId('handoff-incoming-empty');
    expect(incomingEmpty.getAttribute('role')).toBe('status');
    expect(incomingEmpty.textContent).toBe('受け取り待ちの仕事はありません');
    expect(incomingEmpty.className).not.toContain('state-done');
    expect(incomingEmpty.className).toContain('text-muted-foreground');
    expect(screen.getByText(/対応は監査ログに残ります/)).toBeTruthy();

    // 3点セットのルール帯
    expect(screen.getByTestId('handoff-rule-bar').textContent).toContain(
      '3つ揃わないと送信できません',
    );

    // 右レール 根拠・記録
    expect(screen.getByText('ハンドオフ履歴')).toBeTruthy();
    expect(screen.getByText('今月31件')).toBeTruthy();
    expect(screen.getByText('許可済み事務作業の範囲')).toBeTruthy();
  });

  it('passes visit record version through the handoff workspace confirmation flow', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const fetchMock = stubFetch();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText('残薬を確認')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '確認' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/visit-records/visit_record_1/handoff' && init?.method === 'PUT',
        ),
      ).toBe(true);
    });
    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/visit-records/visit_record_1/handoff' && init?.method === 'PUT',
    );
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
      confirmed: true,
      expected_visit_record_version: 7,
    });
  });

  it('passes override reason through the handoff workspace confirmation flow', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'owner_1' });
    const fetchMock = stubFetch(BOARD, {
      handoffDetail: {
        data: {
          next_check_items: ['残薬を確認'],
          ongoing_monitoring: ['眠気'],
          decision_rationale: '訪問時に眠気の訴えあり',
          ai_extracted: true,
          ai_confidence: 0.88,
          confirmed_by: null,
          confirmed_at: null,
          extracted_at: '2026-06-11T00:00:00.000Z',
        },
        meta: {
          visit_record_version: 7,
          visit_record_updated_at: '2026-06-11T00:00:00.000Z',
          confirmation_policy: {
            can_confirm: false,
            requires_override_reason: true,
            authorized_basis: 'admin_emergency_override',
            override_reason_max_length: 500,
            override_reason_code_required: false,
            override_reason_codes: [
              {
                code: 'assignee_unavailable',
                label: '担当者不在',
                description: '担当者が確認できないため、管理者が代行確認する',
              },
            ],
          },
        },
      },
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText('管理者代行確認')).toBeTruthy();
    });

    const button = screen.getByRole('button', { name: '管理者として確定' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('代行理由'), {
      target: { value: '担当者不在のため本日訪問前に確認が必要' },
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/visit-records/visit_record_1/handoff' && init?.method === 'PUT',
        ),
      ).toBe(true);
    });
    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/visit-records/visit_record_1/handoff' && init?.method === 'PUT',
    );
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      confirmed: true,
      expected_visit_record_version: 7,
      override_reason_code: 'assignee_unavailable',
      override_reason: '担当者不在のため本日訪問前に確認が必要',
    });
  });

  it('passes trainee supervision request policy without calling final confirmation', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'trainee_1' });
    const fetchMock = stubFetch(BOARD, {
      handoffDetail: {
        data: {
          next_check_items: ['残薬を確認'],
          ongoing_monitoring: ['眠気'],
          decision_rationale: '訪問時に眠気の訴えあり',
          ai_extracted: true,
          ai_confidence: 0.88,
          confirmed_by: null,
          confirmed_at: null,
          extracted_at: '2026-06-11T00:00:00.000Z',
        },
        meta: {
          visit_record_version: 7,
          visit_record_updated_at: '2026-06-11T00:00:00.000Z',
          confirmation_policy: {
            can_confirm: false,
            requires_override_reason: false,
            authorized_basis: null,
            override_reason_max_length: 500,
            can_request_supervision: true,
            supervision_required: true,
            supervision_available: true,
            supervision_request_note_max_length: 500,
          },
        },
      },
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '上長確認を依頼' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
    expect(screen.queryByRole('button', { name: '編集して確定' })).toBeNull();
    fireEvent.change(screen.getByLabelText('依頼メモ'), {
      target: { value: ' 上長確認をお願いします ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '上長確認を依頼' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/visit-records/visit_record_1/handoff/supervision-request' &&
            init?.method === 'POST',
        ),
      ).toBe(true);
    });
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/visit-records/visit_record_1/handoff/supervision-request' &&
        init?.method === 'POST',
    );
    const postBody = JSON.parse(String(postCall?.[1]?.body));
    expect(postBody).toEqual({
      expected_visit_record_version: 7,
      request_note: '上長確認をお願いします',
    });
    expect(postBody).not.toHaveProperty('confirmed');
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === '/api/visit-records/visit_record_1/handoff' && init?.method === 'PUT',
      ),
    ).toBe(false);
  });

  it('uses the selected supervision review task for supervisor final confirmation', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'supervisor_1' });
    const fetchMock = stubFetch(BOARD, {
      handoffTasks: [
        {
          id: 'task_supervision_1',
          title: '申し送り上長確認',
          task_type: 'handoff_supervision_review',
          priority: 'normal',
          due_date: null,
          related_entity_id: 'visit_record_1',
          created_at: '2026-06-11T00:00:00.000Z',
        },
      ],
      handoffDetail: {
        data: {
          next_check_items: ['残薬を確認'],
          ongoing_monitoring: ['眠気'],
          decision_rationale: '訪問時に眠気の訴えあり',
          ai_extracted: true,
          ai_confidence: 0.88,
          confirmed_by: null,
          confirmed_at: null,
          extracted_at: '2026-06-11T00:00:00.000Z',
        },
        meta: {
          visit_record_version: 7,
          visit_record_updated_at: '2026-06-11T00:00:00.000Z',
          confirmation_policy: {
            can_confirm: false,
            requires_override_reason: false,
            authorized_basis: null,
            override_reason_max_length: 500,
            can_request_supervision: false,
          },
        },
      },
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '上長確認を確定' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
    expect(screen.queryByRole('button', { name: '上長確認を依頼' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '上長確認を確定' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/visit-records/visit_record_1/handoff/supervision-confirm' &&
            init?.method === 'POST',
        ),
      ).toBe(true);
    });
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/visit-records/visit_record_1/handoff/supervision-confirm' &&
        init?.method === 'POST',
    );
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      confirmed: true,
      expected_visit_record_version: 7,
      task_id: 'task_supervision_1',
    });
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === '/api/visit-records/visit_record_1/handoff' && init?.method === 'PUT',
      ),
    ).toBe(false);
  });

  it('disables transfer submission until the 3-point set is complete', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-open-transfer'));
    const submit = await screen.findByRole('button', { name: '渡す(責任を移す)' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    // 無効理由が未充足項目を示し、ボタンへ aria-describedby で接続される
    expect(submit.getAttribute('aria-describedby')).toBe('handoff-transfer-missing');
    expect(screen.getByText(/未入力のため渡せません:/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('件名'), {
      target: { value: 'セット先行準備(施設GH)' },
    });
    fireEvent.click(screen.getByLabelText('宛先(誰に渡すか)'));
    fireEvent.click(screen.getByRole('option', { name: '鈴木 一郎(事務スタッフ)' }));
    fireEvent.change(screen.getByLabelText('①何を(作業の範囲)'), {
      target: { value: '数量セットまで' },
    });
    fireEvent.change(screen.getByLabelText('②なぜ(根拠)'), {
      target: { value: '判断WIPが目安超過のため' },
    });
    // 期限が無い間は送信できない
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('③いつまで(期限)'), {
      target: { value: '2026-06-11T17:00' },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    // 全項目が揃えば無効理由は消える
    expect(submit.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByText(/未入力のため渡せません:/)).toBeNull();
  });

  it('creates transfers with the selected recipient user id so the recipient can receive it', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const fetchMock = stubFetch();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-open-transfer'));
    fireEvent.change(await screen.findByLabelText('件名'), {
      target: { value: 'セット先行準備(施設GH)' },
    });
    fireEvent.click(screen.getByLabelText('宛先(誰に渡すか)'));
    fireEvent.click(screen.getByRole('option', { name: '鈴木 一郎(事務スタッフ)' }));
    fireEvent.change(screen.getByLabelText('①何を(作業の範囲)'), {
      target: { value: '数量セットまで' },
    });
    fireEvent.change(screen.getByLabelText('②なぜ(根拠)'), {
      target: { value: '判断WIPが目安超過のため' },
    });
    fireEvent.change(screen.getByLabelText('③いつまで(期限)'), {
      target: { value: '2026-06-11T17:00' },
    });

    fireEvent.click(screen.getByRole('button', { name: '渡す(責任を移す)' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/handoff-board/items',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/handoff-board/items' && init?.method === 'POST',
    );
    expect(createCall).toBeTruthy();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      board_id: 'board_1',
      content: 'セット先行準備(施設GH)',
      recipient_user_id: 'user_2',
      recipient_label: '鈴木 一郎(事務スタッフ)',
      lifecycle_status: 'proposed',
      scope: '数量セットまで',
      rationale: '判断WIPが目安超過のため',
    });
  });

  it('uses safe recovery copy when transfer creation fails', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch(BOARD, {
      itemPostFailure: new Response(JSON.stringify({ message: 'この仕事は既に渡されています' }), {
        status: 409,
      }),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-open-transfer'));
    fireEvent.change(await screen.findByLabelText('件名'), {
      target: { value: 'セット先行準備(施設GH)' },
    });
    fireEvent.click(screen.getByLabelText('宛先(誰に渡すか)'));
    fireEvent.click(screen.getByRole('option', { name: '鈴木 一郎(事務スタッフ)' }));
    fireEvent.change(screen.getByLabelText('①何を(作業の範囲)'), {
      target: { value: '数量セットまで' },
    });
    fireEvent.change(screen.getByLabelText('②なぜ(根拠)'), {
      target: { value: '判断WIPが目安超過のため' },
    });
    fireEvent.change(screen.getByLabelText('③いつまで(期限)'), {
      target: { value: '2026-06-11T17:00' },
    });

    fireEvent.click(screen.getByRole('button', { name: '渡す(責任を移す)' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('仕事を渡せませんでした');
      expect(toast.error).not.toHaveBeenCalledWith('この仕事は既に渡されています');
    });
  });

  it('rejects legacy successful transfer responses', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch(BOARD, {
      itemPostFailure: new Response(JSON.stringify({ id: 'legacy_handoff' }), { status: 201 }),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });
    await submitCompleteTransferDraft();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('仕事を渡せませんでした');
    });
    expect(toast.success).not.toHaveBeenCalledWith(
      '仕事を渡しました。受領確認と根拠が記録されます。',
    );
  });

  it('uses the same safe recovery copy for error envelopes and non-JSON transfer failures', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch(BOARD, {
      itemPostFailure: jsonResponse({ error: '宛先ユーザーが見つかりません' }, 400),
    });
    const firstRender = renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });
    await submitCompleteTransferDraft();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('仕事を渡せませんでした');
      expect(toast.error).not.toHaveBeenCalledWith('宛先ユーザーが見つかりません');
    });

    firstRender.unmount();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    stubFetch(BOARD, {
      itemPostFailure: new Response('not-json', { status: 500 }),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });
    await submitCompleteTransferDraft();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('仕事を渡せませんでした');
    });
  });

  it('uses safe recovery copy for message and consult creation failures', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1', role: 'clerk' });
    stubFetch(BOARD, {
      itemPostFailure: (body) => {
        if (body.kind === 'message') {
          return jsonResponse({ error: 'この宛先へ連絡する権限がありません' }, 403);
        }
        if (body.consult_status === 'open') {
          return new Response('not-json', { status: 500 });
        }
        return jsonResponse({ message: '送信できません' }, 400);
      },
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-message-channel')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('連絡の宛先'));
    fireEvent.click(screen.getByRole('option', { name: '鈴木 一郎(事務スタッフ)' }));
    fireEvent.change(screen.getByLabelText('連絡内容'), {
      target: { value: '14時の鈴木様、保冷剤の準備をお願いします' },
    });
    fireEvent.click(screen.getByTestId('handoff-message-send'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('連絡を送れませんでした');
      expect(toast.error).not.toHaveBeenCalledWith('この宛先へ連絡する権限がありません');
    });

    fireEvent.click(screen.getByLabelText('相談先の薬剤師'));
    fireEvent.click(screen.getByRole('option', { name: '佐藤 薬剤師(薬剤師)' }));
    fireEvent.change(screen.getByLabelText('相談内容'), {
      target: { value: '同成分薬の重複疑い。用法は妥当か確認をお願いします' },
    });
    fireEvent.click(screen.getByTestId('handoff-consult-submit'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('相談を起票できませんでした');
    });
  });

  it('shows the priority label, not the raw enum, in the transfer dialog select', async () => {
    // bare <SelectValue /> は既定値 'normal' の生 enum を初期表示で漏らす。
    // 明示 children で常に日本語ラベル('通常')を表示することを固定する(SSR enum 漏れ封止)。
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-open-transfer'));
    const priorityTrigger = await screen.findByLabelText('優先度');
    expect(priorityTrigger.textContent).toContain('通常');
    expect(priorityTrigger.textContent).not.toContain('normal');
  });
}
