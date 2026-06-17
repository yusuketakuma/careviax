// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());

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
    useOrgIdMock.mockReturnValue('org_1');
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
});
