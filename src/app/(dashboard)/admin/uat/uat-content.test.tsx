// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { UatContent } from './uat-content';

setupDomTestEnv();

const { mutateAsyncMock, invalidateQueriesMock, loadingQueryKeysMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  loadingQueryKeysMock: new Set<string>(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey?: readonly unknown[] }) => {
    const queryName = String(options.queryKey?.[0] ?? '');
    if (loadingQueryKeysMock.has(queryName)) {
      return {
        data: undefined,
        isLoading: true,
        error: null,
      };
    }
    return {
      data: undefined,
      isLoading: false,
      error: null,
    };
  },
  useMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, id }: { children: ReactNode; id?: string }) => (
    <div id={id}>{children}</div>
  ),
  SelectValue: () => <span>medium</span>,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('UatContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadingQueryKeysMock.clear();
    mutateAsyncMock.mockResolvedValue(undefined);
  });

  it('shows a disabled-send reason until feedback content is entered', () => {
    render(<UatContent />);

    const textarea = screen.getByLabelText('フィードバック内容');
    const submitButton = screen.getByRole('button', { name: 'フィードバックを送信' });

    expect(screen.getByText('フィードバック内容を入力すると送信できます。')).toBeTruthy();
    expect(textarea.getAttribute('aria-describedby')).toBe('uat-feedback-help');
    expect(submitButton.getAttribute('aria-describedby')).toBe('uat-feedback-help');
    expect(submitButton).toHaveProperty('disabled', true);

    fireEvent.change(textarea, { target: { value: 'チェックリストの導線を改善したい' } });

    expect(screen.queryByText('フィードバック内容を入力すると送信できます。')).toBeNull();
    expect(textarea.getAttribute('aria-describedby')).toBeNull();
    expect(submitButton.getAttribute('aria-describedby')).toBeNull();
    expect(submitButton).toHaveProperty('disabled', false);

    fireEvent.click(submitButton);

    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('uses announced skeletons while launch dossier, summary, and org audit are loading', () => {
    loadingQueryKeysMock.add('pilot-launch-dossier');
    loadingQueryKeysMock.add('uat-feedback-summary');
    loadingQueryKeysMock.add('pilot-org-audit');

    render(<UatContent />);

    expect(screen.getByRole('status', { name: 'ローンチ前提を読み込み中' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'UAT集計を読み込み中' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '監査サマリーを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('ローンチ前提を読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('集計を読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('監査サマリーを読み込み中...', { selector: 'p' })).toBeNull();
  });

  it('uses an announced skeleton while saved feedback is loading', () => {
    loadingQueryKeysMock.add('uat-feedback');

    render(<UatContent />);

    expect(screen.getByRole('status', { name: '保存済みフィードバックを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
  });
});
