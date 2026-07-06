// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { SyncQueueItemSummary } from '@/lib/stores/sync-engine';
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
  useMutation: () => ({
    mutate: mutationMutateMock,
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
