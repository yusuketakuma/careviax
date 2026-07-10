// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { toast } from 'sonner';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const refetchMock = vi.hoisted(() => vi.fn());
const clientLogWarnMock = vi.hoisted(() => vi.fn());
const { buildOrgHeadersMock, buildOrgJsonHeadersMock } = vi.hoisted(() => ({
  buildOrgHeadersMock: vi.fn((orgId: string) => ({
    'x-org-id': `org-header:${orgId}`,
    'x-test-helper': 'buildOrgHeaders',
  })),
  buildOrgJsonHeadersMock: vi.fn((orgId: string) => ({
    'Content-Type': 'application/json',
    'x-org-id': `org-json:${orgId}`,
    'x-test-helper': 'buildOrgJsonHeaders',
  })),
}));

vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@/lib/utils/client-log', () => ({
  clientLog: { warn: clientLogWarnMock },
}));

vi.mock('sonner', async () => {
  const { createSonnerToastMock } = await import('@/test/sonner-test-utils');
  return createSonnerToastMock().module;
});

vi.mock('./mention-input', () => ({
  MentionInput: ({
    value,
    onChange,
    onMentionsChange,
  }: {
    value: string;
    onChange: (value: string) => void;
    onMentionsChange: (mentions: string[]) => void;
  }) => (
    <textarea
      aria-label="コメント入力"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
        onMentionsChange(['user_2']);
      }}
    />
  ),
}));

import { CommentThread } from './comment-thread';

setupDomTestEnv();

function renderWithQueryClient(ui: React.ReactElement) {
  return render(ui, { wrapper: createQueryClientWrapper() });
}

describe('CommentThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    fetchMock.mockResolvedValue(jsonResponse({ data: { deleted: true } }));
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });
  });

  it('uses an org-scoped realtime query key and shared fetch helpers for the comment list', async () => {
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

    const options = useRealtimeQueryMock.mock.calls[0][0] as { queryFn: () => Promise<unknown> };
    await options.queryFn();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/comments?entity_type=patient&entity_id=patient_1',
      { headers: { 'x-org-id': 'org-header:org_1', 'x-test-helper': 'buildOrgHeaders' } },
    );
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
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
        headers: { 'x-org-id': 'org-header:org_1', 'x-test-helper': 'buildOrgHeaders' },
      });
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('%25');
  });

  it('posts comments through shared collection path and JSON org headers', async () => {
    renderWithQueryClient(<CommentThread entityType="patient" entityId="patient_1" />);

    fireEvent.change(screen.getByLabelText('コメント入力'), {
      target: { value: '確認お願いします' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': 'org-json:org_1',
          'x-test-helper': 'buildOrgJsonHeaders',
        },
        body: JSON.stringify({
          entity_type: 'patient',
          entity_id: 'patient_1',
          content: '確認お願いします',
          mentions: ['user_2'],
        }),
      });
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('keeps comment-create errors PHI-safe and retains the draft for retry', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: '患者A 090-1234-5678 本文 token-super-secret' }, 400),
    );

    renderWithQueryClient(<CommentThread entityType="patient" entityId="patient_1" />);

    fireEvent.change(screen.getByLabelText('コメント入力'), {
      target: { value: '確認お願いします' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'コメントを投稿できませんでした。内容と通信状態を確認して、もう一度送信してください。',
      );
    });
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'comment_thread.create_failed',
      expect.any(Error),
      { entityType: 'comment' },
    );
    const createAlert = screen.getByRole('alert').textContent ?? '';
    expect(createAlert).toContain('コメントを投稿できませんでした');
    expect(createAlert).not.toContain('患者A');
    expect(createAlert).not.toContain('090-1234-5678');
    expect(createAlert).not.toContain('本文');
    expect(createAlert).not.toContain('token-super-secret');
    expect((screen.getByLabelText('コメント入力') as HTMLTextAreaElement).value).toBe(
      '確認お願いします',
    );
    expect(screen.getByRole('button', { name: '再送信' })).toHaveProperty('disabled', false);
    const toastPayload = JSON.stringify(vi.mocked(toast.error).mock.calls);
    expect(toastPayload).not.toContain('患者A');
    expect(toastPayload).not.toContain('090-1234-5678');
    expect(toastPayload).not.toContain('本文');
    expect(toastPayload).not.toContain('token-super-secret');

    fireEvent.click(screen.getByRole('button', { name: '再送信' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('keeps comment-delete errors PHI-safe and retains the target for retry', async () => {
    useRealtimeQueryMock.mockReturnValue({
      data: {
        data: [
          {
            id: 'comment_1',
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
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: '患者A 090-1234-5678 本文 token-super-secret' }, 403),
    );

    renderWithQueryClient(<CommentThread entityType="patient" entityId="patient_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'コメントを削除' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'コメントを削除できませんでした。権限と対象を確認して、もう一度操作してください。',
      );
    });
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'comment_thread.delete_failed',
      expect.any(Error),
      { entityType: 'comment' },
    );
    const deleteAlert = screen.getByRole('alert').textContent ?? '';
    expect(deleteAlert).toContain('コメントを削除できませんでした');
    expect(deleteAlert).not.toContain('患者A');
    expect(deleteAlert).not.toContain('090-1234-5678');
    expect(deleteAlert).not.toContain('本文');
    expect(deleteAlert).not.toContain('token-super-secret');
    expect(screen.getByText('確認お願いします')).toBeTruthy();
    expect(screen.getByRole('button', { name: '削除を再試行' })).toHaveProperty('disabled', false);
    const toastPayload = JSON.stringify(vi.mocked(toast.error).mock.calls);
    expect(toastPayload).not.toContain('患者A');
    expect(toastPayload).not.toContain('090-1234-5678');
    expect(toastPayload).not.toContain('本文');
    expect(toastPayload).not.toContain('token-super-secret');

    fireEvent.click(screen.getByRole('button', { name: '削除を再試行' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
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

    expect(screen.getByRole('status', { name: 'コメントを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
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

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toContain('コメントを削除できませんでした');
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
