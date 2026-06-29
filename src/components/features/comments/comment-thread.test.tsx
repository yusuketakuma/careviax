// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const refetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('./mention-input', () => ({
  MentionInput: () => <textarea aria-label="コメント入力" readOnly />,
}));

import { CommentThread } from './comment-thread';

setupDomTestEnv();

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('CommentThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ deleted: true }) });
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });
  });

  it('uses an org-scoped realtime query key and fallback polling only when SSE is unavailable', () => {
    renderWithQueryClient(<CommentThread entityType="patient" entityId="patient_1" />);

    expect(screen.getByText('コメントはまだありません。')).toBeTruthy();
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['comments', 'org_1', 'patient', 'patient_1'],
        enabled: true,
        invalidateOn: ['comment_refresh'],
        fallbackRefetchInterval: 30_000,
      }),
    );
  });

  it('single-encodes comment delete paths and preserves delete headers', async () => {
    const hostileCommentId = 'comment/1?x=y#frag';
    const encodedCommentId = encodeURIComponent(hostileCommentId);
    useRealtimeQueryMock.mockReturnValue({
      data: {
        data: [
          {
            id: hostileCommentId,
            author_id: 'user_1',
            author_name: '田中',
            content: '確認お願いします',
            mentions: [],
            created_at: '2026-06-13T09:30:00+09:00',
          },
        ],
      },
      isLoading: false,
    });

    renderWithQueryClient(<CommentThread entityType="patient" entityId="patient_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'コメントを削除' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`/api/comments/${encodedCommentId}`, {
        method: 'DELETE',
        headers: { 'x-org-id': 'org_1' },
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('%25');
  });

  it('fails closed with a retryable error instead of a false-empty "no comments" on fetch failure', () => {
    // A failed realtime query must not render the empty-state copy — that misreads a fetch
    // failure as "this entity has no comments". Surface an announced error + retry instead.
    useRealtimeQueryMock.mockReturnValue({
      data: undefined,
      isError: true,
      isPending: false,
      refetch: refetchMock,
    });

    renderWithQueryClient(<CommentThread entityType="patient" entityId="patient_1" />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('コメントを取得できませんでした');
    // the misleading empty-state copy must be gone
    expect(screen.queryByText('コメントはまだありません。')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows loading (not the empty-state) while the disabled/pending query has not resolved', () => {
    // useRealtimeQuery gates on enabled: !!orgId && !!entityId, so an unresolved org leaves the
    // query pending-but-not-fetching (isPending true). The empty-state must not show yet.
    useRealtimeQueryMock.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: true,
      refetch: refetchMock,
    });

    renderWithQueryClient(<CommentThread entityType="patient" entityId="patient_1" />);

    expect(screen.getByText('読み込み中...')).toBeTruthy();
    expect(screen.queryByText('コメントはまだありません。')).toBeNull();
  });

  it.each(['.', '..'])(
    'fails closed before delete fetch for exact dot comment id %p',
    async (dotId) => {
      useRealtimeQueryMock.mockReturnValue({
        data: {
          data: [
            {
              id: dotId,
              author_id: 'user_1',
              author_name: '田中',
              content: '確認お願いします',
              mentions: [],
              created_at: '2026-06-13T09:30:00+09:00',
            },
          ],
        },
        isLoading: false,
      });

      renderWithQueryClient(<CommentThread entityType="patient" entityId="patient_1" />);
      fireEvent.click(screen.getByRole('button', { name: 'コメントを削除' }));

      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
