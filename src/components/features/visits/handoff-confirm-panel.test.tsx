// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { HandoffConfirmPanel } from './handoff-confirm-panel';
import type { VisitHandoff } from '@/types/visit-brief';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', async () => {
  const { createSonnerToastMock } = await import('@/test/sonner-test-utils');
  return createSonnerToastMock().module;
});

function baseHandoff(): VisitHandoff {
  return {
    next_check_items: ['残薬を確認'],
    ongoing_monitoring: ['眠気'],
    decision_rationale: '訪問時に眠気の訴えあり',
    ai_extracted: true,
    ai_confidence: 0.88,
    confirmed_by: null,
    confirmed_at: null,
    extracted_at: '2026-06-11T00:00:00.000Z',
  };
}

function renderPanel(handoff: VisitHandoff = baseHandoff()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HandoffConfirmPanel visitRecordId="visit_record_1" handoff={handoff} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('HandoffConfirmPanel', () => {
  it('keeps server messages when handoff confirmation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: '申し送りは既に確定されています' }), {
            status: 409,
          }),
      ),
    );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '確認' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('申し送りは既に確定されています');
    });
  });

  it('falls back when handoff confirmation fails without a server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 500 })),
    );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '確認' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('申し送りの確定に失敗しました');
    });
  });
});
