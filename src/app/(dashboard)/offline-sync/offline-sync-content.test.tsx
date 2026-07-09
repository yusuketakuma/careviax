// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import {
  discardSyncQueueItem,
  overwriteVisitRecordConflict,
  type SyncQueueItemSummary,
} from '@/lib/stores/sync-engine';
import { OfflineSyncContent } from './offline-sync-content';

setupDomTestEnv();

const mutationMutateMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const refreshSyncStateMock = vi.hoisted(() => vi.fn(async () => undefined));
const offlineState = vi.hoisted(() => ({
  isOffline: false,
  pendingQueue: [] as SyncQueueItemSummary[],
  refreshSyncState: refreshSyncStateMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@tanstack/react-query', () => ({
  // mutationFn を実行し onSuccess/onError へ流す(server/local どちらの解決系
  // sync-engine 関数が呼ばれたかを検証できるようにする。SSOT 5.7 の配線検証)。
  useMutation: (options: {
    mutationFn: (variables?: unknown) => Promise<unknown>;
    onMutate?: (variables?: unknown) => unknown;
    onSuccess?: (data: unknown, variables?: unknown) => unknown;
    onError?: (error: unknown) => unknown;
  }) => ({
    mutate: (variables?: unknown) => {
      mutationMutateMock(variables);
      options.onMutate?.(variables);
      void Promise.resolve()
        .then(() => options.mutationFn(variables))
        .then((data) => options.onSuccess?.(data, variables))
        .catch((error) => options.onError?.(error));
    },
    isPending: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/stores/offline-store', () => ({
  useOfflineStore: (
    selector: (state: {
      isOffline: boolean;
      pendingQueue: SyncQueueItemSummary[];
      refreshSyncState: () => Promise<void>;
    }) => unknown,
  ) => selector(offlineState),
}));

vi.mock('@/lib/stores/offline-db', () => ({
  offlineDb: {
    visitBriefCache: {
      where: vi.fn(() => ({
        anyOf: vi.fn(() => ({
          toArray: vi.fn(async () => []),
        })),
      })),
    },
  },
}));

vi.mock('@/lib/offline/crypto', () => ({
  decryptOfflinePayload: vi.fn(async () => ({})),
}));

vi.mock('@/lib/visits/visit-brief-cache', () => ({
  parseCachedVisitBriefCardPayload: vi.fn(() => null),
}));

vi.mock('@/lib/stores/sync-engine', () => ({
  discardSyncQueueItem: vi.fn(),
  overwriteVisitRecordConflict: vi.fn(async () => ({ ok: true })),
  processSyncQueue: vi.fn(async () => ({ synced: 1, failed: 0 })),
  resetFailedSyncQueueRetries: vi.fn(async () => undefined),
}));

vi.mock('./offline-sync.demo', () => ({
  seedOfflineSyncDemoData: vi.fn(),
}));

function buildQueueItem(overrides: Partial<SyncQueueItemSummary> = {}): SyncQueueItemSummary {
  return {
    id: 1,
    entityType: 'visit_record',
    scope_id: undefined,
    createdAt: new Date('2026-06-12T09:00:00+09:00'),
    retryCount: 0,
    payload: { patient_id: '田中一郎' },
    conflict: null,
    ...overrides,
  };
}

function renderOfflineSyncContent(items: SyncQueueItemSummary[]) {
  offlineState.pendingQueue = items;
  return render(<OfflineSyncContent />);
}

describe('OfflineSyncContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    offlineState.isOffline = false;
    offlineState.pendingQueue = [];
    refreshSyncStateMock.mockReset();
    refreshSyncStateMock.mockResolvedValue(undefined);
  });

  it('renders queue rows through the DataTable with status badges and all row actions', async () => {
    renderOfflineSyncContent([
      buildQueueItem({
        id: 1,
        retryCount: 3,
        lastError: 'HTTP 500',
        payload: { patient_id: '田中一郎', display_kind: '訪問メモ' },
      }),
      buildQueueItem({
        id: 2,
        conflict_state: 'server_conflict',
        payload: { patient_id: '佐藤花子', display_kind: '訪問メモ' },
        conflict: {
          local: { soap_subjective: '服薬できた', outcome_status: 'completed' },
          server: {
            id: 'rec_1',
            version: 2,
            patient_id: 'patient_1',
            visit_date: '2026-06-12',
            outcome_status: 'completed',
            soap_subjective: '便秘あり',
          },
        },
      }),
      buildQueueItem({
        id: 3,
        retryCount: 0,
        payload: { patient_id: '鈴木次郎', display_kind: '残薬調整' },
      }),
    ]);

    expect(await screen.findAllByText('田中一郎')).not.toHaveLength(0);
    expect(screen.getAllByText('失敗')).not.toHaveLength(0);
    expect(screen.getAllByText('HTTP 500')).not.toHaveLength(0);
    expect(screen.getAllByText('佐藤花子')).not.toHaveLength(0);
    expect(screen.getAllByText('競合')).not.toHaveLength(0);
    expect(screen.getAllByText('鈴木次郎')).not.toHaveLength(0);
    expect(screen.getAllByText('同期待ち')).not.toHaveLength(0);

    fireEvent.click(screen.getAllByRole('button', { name: '再試行' })[0]);
    expect(mutationMutateMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole('button', { name: '内容を確認' })[0]);
    expect(await screen.findByTestId('offline-sync-conflict-view')).toBeTruthy();
    expect(screen.getByText('佐藤花子さんの記録が更新されています')).toBeTruthy();
  });

  // SSOT 5.7: 不可逆な競合解決は ConflictDiffDialog 経由で、keep/discard の再掲と
  // server/local で異なる mutation が正しく配線されていることを end-to-end で固定する。
  function buildConflictItem(): SyncQueueItemSummary {
    return buildQueueItem({
      id: 2,
      conflict_state: 'server_conflict',
      payload: { patient_id: '佐藤花子', display_kind: '訪問メモ' },
      conflict: {
        local: { soap_subjective: '服薬できた', outcome_status: 'completed' },
        server: {
          id: 'rec_1',
          version: 2,
          patient_id: 'patient_1',
          visit_date: '2026-06-12',
          outcome_status: 'completed',
          soap_subjective: '便秘あり',
        },
      },
    });
  }

  async function openConflictView() {
    fireEvent.click(screen.getAllByRole('button', { name: '内容を確認' })[0]);
    expect(await screen.findByTestId('offline-sync-conflict-view')).toBeTruthy();
  }

  it('confirms the server choice through the diff dialog and calls only the discard mutation', async () => {
    renderOfflineSyncContent([buildConflictItem()]);
    await openConflictView();

    fireEvent.click(screen.getByRole('button', { name: '最新の内容を使う' }));

    // keep=サーバー(最新) / discard=自分の入力 の向きで再掲される。
    expect(await screen.findByText('最新の内容を残しますか')).toBeTruthy();
    expect(screen.getAllByText('最新の内容（残す）')).toHaveLength(2);
    expect(screen.getAllByText('あなたの入力（破棄）')).toHaveLength(2);
    // モバイル縦積みでも、値の keep/discard 所属を項目ブロック単位で固定する。
    const memoDefinitions = within(
      screen.getByRole('region', { name: '訪問メモの差分' }),
    ).getAllByRole('definition');
    expect(memoDefinitions[0]?.textContent).toBe('便秘あり');
    expect(memoDefinitions[1]?.textContent).toBe('服薬できた');

    fireEvent.click(screen.getByRole('button', { name: '最新の内容を残す' }));

    await waitFor(() => expect(discardSyncQueueItem).toHaveBeenCalledWith(2));
    expect(overwriteVisitRecordConflict).not.toHaveBeenCalled();
  });

  it('confirms the local choice with reversed keep/discard and calls only the overwrite mutation', async () => {
    renderOfflineSyncContent([buildConflictItem()]);
    await openConflictView();

    fireEvent.click(screen.getByRole('button', { name: '自分の入力で上書き' }));

    expect(await screen.findByText('自分の入力で上書きしますか')).toBeTruthy();
    // keep/discard が反転する(見出しとセル値の両方で固定)。
    expect(screen.getAllByText('あなたの入力（残す）')).toHaveLength(2);
    expect(screen.getAllByText('最新の内容（破棄）')).toHaveLength(2);
    const memoDefinitions = within(
      screen.getByRole('region', { name: '訪問メモの差分' }),
    ).getAllByRole('definition');
    expect(memoDefinitions[0]?.textContent).toBe('服薬できた');
    expect(memoDefinitions[1]?.textContent).toBe('便秘あり');

    fireEvent.click(screen.getByRole('button', { name: '自分の入力で上書きする' }));

    await waitFor(() => expect(overwriteVisitRecordConflict).toHaveBeenCalledTimes(1));
    // overwriteVisitRecordConflict(ctx, itemId) — 対象 item id は第2引数。
    expect(vi.mocked(overwriteVisitRecordConflict).mock.calls[0]?.[1]).toBe(2);
    expect(discardSyncQueueItem).not.toHaveBeenCalled();
  });

  it('cancels the diff dialog without firing either resolution mutation', async () => {
    renderOfflineSyncContent([buildConflictItem()]);
    await openConflictView();

    fireEvent.click(screen.getByRole('button', { name: '最新の内容を使う' }));
    expect(await screen.findByText('最新の内容を残しますか')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    await waitFor(() => expect(screen.queryByText('最新の内容を残しますか')).toBeNull());
    expect(discardSyncQueueItem).not.toHaveBeenCalled();
    expect(overwriteVisitRecordConflict).not.toHaveBeenCalled();
  });

  it('keeps a safe inline error and the selected diff visible when overwrite fails', async () => {
    vi.mocked(overwriteVisitRecordConflict).mockResolvedValueOnce({
      ok: false,
      message: 'サーバー側の記録が更新されました。差分を確認してください',
    });
    renderOfflineSyncContent([buildConflictItem()]);
    await openConflictView();

    fireEvent.click(screen.getByRole('button', { name: '自分の入力で上書き' }));
    fireEvent.click(screen.getByRole('button', { name: '自分の入力で上書きする' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('競合を解決できませんでした');
    expect(screen.getByText('自分の入力で上書きしますか')).toBeTruthy();
    expect(toastErrorMock).toHaveBeenCalled();
  });

  it('shows the genuine empty state only when the queue loaded successfully with no rows', async () => {
    renderOfflineSyncContent([]);

    expect(
      await screen.findAllByText('未同期のデータはありません。すべて同期済みです。'),
    ).not.toHaveLength(0);
    expect(screen.queryByText('取得エラーのため一覧を表示できません')).toBeNull();
  });

  it('does not collapse queue load failures into the empty state', async () => {
    refreshSyncStateMock.mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    renderOfflineSyncContent([]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('IndexedDB unavailable');
    expect(screen.queryByText('未同期のデータはありません。すべて同期済みです。')).toBeNull();
    expect(screen.getByText('読込失敗')).toBeTruthy();
    expect(screen.getAllByText('—')).not.toHaveLength(0);
    expect(
      screen.getByRole('button', { name: '未同期キューをすべて再試行' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByText('未同期データを読み込めないため、再読み込みしてください。'),
    ).toBeTruthy();
    expect(screen.getAllByText('取得エラーのため一覧を表示できません')).not.toHaveLength(0);
    expect(toastErrorMock).toHaveBeenCalledWith('IndexedDB unavailable');

    refreshSyncStateMock.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    await waitFor(() => expect(refreshSyncStateMock).toHaveBeenCalledTimes(2));
  });
});
