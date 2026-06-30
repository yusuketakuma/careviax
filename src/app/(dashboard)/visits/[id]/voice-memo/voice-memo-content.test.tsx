// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { VoiceMemoContent } from './voice-memo-content';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/offline/voice-memo-drafts', () => ({
  loadLatestVoiceMemoDraft: vi.fn().mockResolvedValue(null),
  saveVoiceMemoDraft: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

function renderContent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <VoiceMemoContent visitId="visit_1" />
    </QueryClientProvider>,
  );
}

describe('VoiceMemoContent', () => {
  it('reflects a manual transcript into the same transcript/append workflow used by STT results', async () => {
    renderContent();

    const textarea = await screen.findByTestId('voice-memo-manual-transcript');
    fireEvent.change(textarea, {
      target: {
        value: '  夕食後は家族の声かけで飲めている。 \n\n  便秘あり。次回も確認。  ',
      },
    });
    fireEvent.click(screen.getByTestId('voice-memo-manual-apply-button'));

    await waitFor(() => {
      expect(screen.getByTestId('voice-memo-transcript-text').textContent).toBe(
        '夕食後は家族の声かけで飲めている。\n便秘あり。次回も確認。',
      );
    });
    expect(screen.getByTestId('voice-memo-transcript-highlights').textContent).toContain(
      '夕食後は家族の声かけで飲めている。',
    );
    expect(screen.getByTestId('voice-memo-append-button')).toBeTruthy();
  });
});
