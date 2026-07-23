import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { HandoffBoardResponse } from '../handoff-workspace.helpers';
import { getHandoffWorkspaceTestSupport } from './handoff-workspace.test-support';

const {
  BOARD,
  buildItem,
  jsonResponse,
  QueryClient,
  renderWorkspace,
  stubFetch,
  toast,
  useAuthStore,
  useOrgIdMock,
  useRealtimeEventsMock,
} = getHandoffWorkspaceTestSupport();

export function registerHandoffIncomingCases() {
  it('shows 受領確認 action for incoming items', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        buildItem({
          id: 'item_in',
          content: '疑義照会の判断をお願いします',
          created_by: 'user_2',
          created_by_name: '鈴木 一郎',
          recipient_user_id: 'user_1',
          recipient_label: '山田さん(薬剤師)',
          lifecycle_status: 'proposed',
          rationale: '判断が必要なため',
          direction: 'incoming',
        }),
      ],
      summary: { outgoing_count: 0, incoming_count: 1 },
    };
    stubFetch(board);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText('疑義照会の判断をお願いします → 山田さん(薬剤師)')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: '受領確認' })).toBeTruthy();
    expect(screen.queryByTestId('handoff-incoming-empty')).toBeNull();
  });

  it('falls back when receipt confirmation fails without a server message', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        buildItem({
          id: 'item_in',
          content: '疑義照会の判断をお願いします',
          created_by: 'user_2',
          created_by_name: '鈴木 一郎',
          recipient_user_id: 'user_1',
          recipient_label: '山田さん(薬剤師)',
          lifecycle_status: 'proposed',
          rationale: '判断が必要なため',
          direction: 'incoming',
        }),
      ],
      summary: { outgoing_count: 0, incoming_count: 1 },
    };
    stubFetch(board, {
      itemReadFailure: new Response('server error', { status: 500 }),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '受領確認' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '受領確認' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('受領確認に失敗しました');
    });
  });

  it.each([
    [{ message: '申し送り項目が見つかりません' }, '申し送り項目が見つかりません'],
    [{ error: '申し送りの既読権限がありません' }, '申し送りの既読権限がありません'],
  ])(
    'uses safe recovery copy for receipt confirmation errors from %j',
    async (payload, expectedMessage) => {
      useAuthStore.getState().setCurrentUser({ id: 'user_1' });
      const board: HandoffBoardResponse = {
        ...BOARD,
        items: [
          buildItem({
            id: 'item_in',
            content: '疑義照会の判断をお願いします',
            created_by: 'user_2',
            created_by_name: '鈴木 一郎',
            recipient_user_id: 'user_1',
            recipient_label: '山田さん(薬剤師)',
            lifecycle_status: 'proposed',
            rationale: '判断が必要なため',
            direction: 'incoming',
          }),
        ],
        summary: { outgoing_count: 0, incoming_count: 1 },
      };
      stubFetch(board, {
        itemReadFailure: jsonResponse(payload, 403),
      });
      renderWorkspace();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '受領確認' })).toBeTruthy();
      });

      fireEvent.click(screen.getByRole('button', { name: '受領確認' }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('受領確認に失敗しました');
        expect(toast.error).not.toHaveBeenCalledWith(expectedMessage);
      });
    },
  );

  it('uses safe recovery copy when message read confirmation fails', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        buildItem({
          id: 'message_in',
          content: '14時の鈴木様、保冷剤の準備をお願いします',
          created_by: 'user_2',
          created_by_name: '鈴木 一郎',
          recipient_user_id: 'user_1',
          recipient_label: '山田さん(薬剤師)',
          lifecycle_status: null,
          consult_status: null,
          direction: 'incoming',
        }),
      ],
      summary: { outgoing_count: 0, incoming_count: 1 },
    };
    stubFetch(board, {
      itemReadFailure: jsonResponse({ error: '連絡の既読権限がありません' }, 403),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-message-confirm')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-message-confirm'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('既読にできませんでした');
      expect(toast.error).not.toHaveBeenCalledWith('連絡の既読権限がありません');
    });
  });

  it('keeps the newest incoming item primary and tucks the rest behind a receipt backlog disclosure', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const incoming = (id: string, content: string) =>
      buildItem({
        id,
        content,
        created_by: 'user_2',
        created_by_name: '鈴木 一郎',
        recipient_user_id: 'user_1',
        recipient_label: '山田さん(薬剤師)',
        lifecycle_status: 'proposed',
        rationale: '判断が必要なため',
        direction: 'incoming',
      });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        incoming('item_in_1', '同成分薬の重複疑いについて確認をお願いします'),
        incoming('item_in_2', 'FAX番号の確認が弱いため、送付前に判断してください'),
        incoming('item_in_3', '報告書に入れるべき確認事項か判断をお願いします'),
      ],
      summary: { outgoing_count: 0, incoming_count: 3 },
    };
    stubFetch(board);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText(/同成分薬の重複疑いについて確認をお願いします/)).toBeTruthy();
    });
    const overflow = screen.getByTestId('handoff-incoming-overflow');
    expect(overflow.textContent).toContain('残りの受領待ち');
    expect(overflow.textContent).toContain('2件');
    expect(overflow.textContent).toContain('FAX番号の確認が弱いため');
    expect(overflow.textContent).toContain('報告書に入れるべき確認事項');
  });

  it('keeps the action rail loading instead of showing false no-blockers copy while operation status loads', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch(BOARD, { cockpitResponse: new Promise<Response>(() => undefined) });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });
    expect(screen.getByTestId('handoff-action-rail-loading')).toBeTruthy();
    expect(screen.queryByText('止まっている作業はありません')).toBeNull();
    expect(screen.queryByText('いま期限で止まっている作業はありません。')).toBeNull();
  });

  it('shows a cockpit rail error instead of a false no-blockers state when operation status fails', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const fetchMock = stubFetch(BOARD, { cockpitStatus: 500 });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });
    expect(await screen.findByText('稼働状況を取得できませんでした')).toBeTruthy();
    expect(screen.getByText(/問題なしではなく取得エラーです/)).toBeTruthy();
    expect(screen.queryByText('止まっている作業はありません')).toBeNull();
    expect(screen.queryByText('いま期限で止まっている作業はありません。')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/dashboard/cockpit'))
          .length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it('keeps transfer submission disabled when no active recipient options are available', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch({ ...BOARD, recipient_options: [] });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-open-transfer'));
    expect(await screen.findByText(/宛先候補を取得できません/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '渡す(責任を移す)' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('refreshes board queries only from handoff-related realtime events', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    let realtimeOptions: { onEvent: (event: unknown) => void } | null = null;
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const getRealtimeOptions = () => {
      if (!realtimeOptions) throw new Error('realtime options were not captured');
      return realtimeOptions;
    };
    useRealtimeEventsMock.mockImplementation((options: { onEvent: (event: unknown) => void }) => {
      realtimeOptions = options;
      return { connected: true };
    });
    const fetchMock = stubFetch();
    const handoffBoardFetchCount = () =>
      fetchMock.mock.calls.filter(([input]) => String(input) === '/api/handoff-board').length;

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });
    await waitFor(() => {
      expect(handoffBoardFetchCount()).toBe(1);
    });

    await act(async () => {
      getRealtimeOptions().onEvent({
        type: 'workflow_refresh',
        source: 'prescription_intakes_create',
      });
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
    expect(handoffBoardFetchCount()).toBe(1);
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['nav-badges'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ['tasks', 'handoff-confirmation', 'org_1'],
    });

    await act(async () => {
      getRealtimeOptions().onEvent({
        type: 'workflow_refresh',
        source: 'handoff_board_item_create',
      });
    });

    await waitFor(() => {
      expect(handoffBoardFetchCount()).toBeGreaterThan(1);
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['nav-badges'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['tasks', 'handoff-confirmation', 'org_1'],
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['nav-badges', 'handoff'] });
    invalidateSpy.mockRestore();
  });

  it('renders the pharmacist consultation workspace inside the canonical handoff board', async () => {
    // 相談の「対応」は薬剤師のみ。viewer を薬剤師にして解決パネルの描画を検証する。
    useAuthStore.getState().setCurrentUser({ id: 'user_1', role: 'pharmacist' });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        buildItem({
          id: 'consult_1',
          content: '用法・用量の確認をお願いします。',
          created_by: 'user_2',
          created_by_name: '鈴木 事務',
          recipient_user_id: 'user_1',
          recipient_label: '山田さん(薬剤師)',
          consult_status: 'open',
          rationale: '確認してほしいこと\n・用法が妥当か\n・医師へ確認が必要か',
          direction: 'incoming',
        }),
      ],
      summary: { outgoing_count: 0, incoming_count: 1 },
    };
    stubFetch(board);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-consult-workspace')).toBeTruthy();
    });
    expect(screen.getByText('相談一覧')).toBeTruthy();
    expect(screen.getByText('相談内容')).toBeTruthy();
    expect(screen.getByText('薬剤師の対応')).toBeTruthy();
    expect(screen.getByTestId('handoff-open-transfer')).toBeTruthy();
    expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    expect(screen.getByTestId('handoff-incoming-section')).toBeTruthy();
  });

  it('hides the pharmacist resolution panel from clerks (canAuthorReport gate, FE)', async () => {
    // 事務(clerk)は相談を閲覧・起票できるが「薬剤師の対応」パネルは見えない(二重防御)。
    useAuthStore.getState().setCurrentUser({ id: 'user_1', role: 'clerk' });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        buildItem({
          id: 'consult_clerk',
          content: '用法・用量の確認をお願いします。',
          created_by: 'user_1',
          created_by_name: '鈴木 事務',
          recipient_user_id: 'user_3',
          recipient_label: '佐藤さん(薬剤師)',
          consult_status: 'open',
          direction: 'outgoing',
        }),
      ],
      summary: { outgoing_count: 1, incoming_count: 0 },
    };
    stubFetch(board);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-consult-workspace')).toBeTruthy();
    });
    // 相談は見える(閲覧・起票は可)
    expect(screen.getByText('相談一覧')).toBeTruthy();
    expect(screen.getByTestId('handoff-consult-intake')).toBeTruthy();
    // 対応パネルは出ず、読み取り専用の説明に置き換わる
    expect(screen.queryByText('薬剤師の対応')).toBeNull();
    expect(screen.getByTestId('handoff-consult-resolution-readonly')).toBeTruthy();
  });

  it('uses safe recovery copy when pharmacist consultation resolution fails', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1', role: 'pharmacist' });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        buildItem({
          id: 'consult_1',
          content: '用法・用量の確認をお願いします。',
          created_by: 'user_2',
          created_by_name: '鈴木 事務',
          recipient_user_id: 'user_1',
          recipient_label: '山田さん(薬剤師)',
          consult_status: 'open',
          direction: 'incoming',
        }),
      ],
      summary: { outgoing_count: 0, incoming_count: 1 },
    };
    stubFetch(board, {
      itemResolveFailure: jsonResponse(
        { message: 'この相談は他のユーザーによって更新されています。再読み込みしてください' },
        409,
      ),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-consult-action-acknowledged')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-consult-action-acknowledged'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('対応を記録できませんでした');
      expect(toast.error).not.toHaveBeenCalledWith(
        'この相談は他のユーザーによって更新されています。再読み込みしてください',
      );
    });
  });

  it('disables handoff realtime and data loading until org is available', () => {
    useOrgIdMock.mockReturnValue('');
    const fetchMock = stubFetch();

    renderWorkspace();

    expect(useRealtimeEventsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a recent-comments fetch failure with retry instead of silently hiding the やり取り feed', async () => {
    // 取得失敗を「あなた宛コメント無し」と区別できないと連携記録が無言で消える false-empty。
    const fetchMock = stubFetch(BOARD, { recentCommentsStatus: 500 });

    renderWorkspace();

    const feed = await screen.findByTestId('handoff-comment-feed');
    expect(within(feed).getByText(/やり取りを読み込めませんでした/)).toBeTruthy();
    const retry = within(feed).getByRole('button', { name: '再読み込み' });

    const commentCallsBefore = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/api/comments/recent'),
    ).length;
    fireEvent.click(retry);
    await waitFor(() => {
      const commentCallsAfter = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/api/comments/recent'),
      ).length;
      expect(commentCallsAfter).toBeGreaterThan(commentCallsBefore);
    });
  });

  it('renders the やり取り feed with recent comments and no error on a successful load', async () => {
    stubFetch(BOARD, {
      recentComments: [
        {
          id: 'comment_1',
          entity_type: 'care_report',
          entity_id: 'report_1',
          author_id: 'user_2',
          author_name: '佐藤 太郎',
          content: '次回訪問で残薬を確認してください',
          mentions_me: true,
          authored_by_me: false,
          created_at: '2026-06-11T02:00:00.000Z',
        },
      ],
    });

    renderWorkspace();

    const feed = await screen.findByTestId('handoff-comment-feed');
    expect(within(feed).getByText('次回訪問で残薬を確認してください')).toBeTruthy();
    // a successful (non-empty) load must not show the error affordance
    expect(within(feed).queryByText(/やり取りを読み込めませんでした/)).toBeNull();
    expect(within(feed).queryByRole('button', { name: '再読み込み' })).toBeNull();
  });
}
