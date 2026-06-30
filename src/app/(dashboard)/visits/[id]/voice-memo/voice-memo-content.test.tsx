// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import {
  loadLatestVoiceMemoDraft,
  saveVoiceMemoManualTranscript,
} from '@/lib/offline/voice-memo-drafts';
import { VoiceMemoContent } from './voice-memo-content';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/offline/voice-memo-drafts', () => ({
  loadLatestVoiceMemoDraft: vi.fn().mockResolvedValue(null),
  saveVoiceMemoDraft: vi.fn(),
  saveVoiceMemoManualTranscript: vi.fn().mockResolvedValue(false),
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

beforeEach(() => {
  vi.mocked(loadLatestVoiceMemoDraft).mockResolvedValue(null);
  vi.mocked(saveVoiceMemoManualTranscript).mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('VoiceMemoContent', () => {
  it('restores an encrypted manual transcript from the latest voice memo draft', async () => {
    vi.mocked(loadLatestVoiceMemoDraft).mockResolvedValueOnce({
      dataUrl: 'data:audio/webm;base64,VOICE',
      fileName: 'memo.webm',
      mimeType: 'audio/webm',
      durationSeconds: 42,
      recordedAt: '2026-06-18T10:00:00.000Z',
      manualTranscript: '夕食後は家族の声かけで飲めている。',
    });

    renderContent();

    await waitFor(() => {
      expect(screen.getByTestId('voice-memo-transcript-text').textContent).toBe(
        '夕食後は家族の声かけで飲めている。',
      );
    });
    expect(screen.getByTestId('voice-memo-title').textContent).toBe('訪問中メモ 00:42');
  });

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
    await waitFor(() => {
      expect(saveVoiceMemoManualTranscript).toHaveBeenCalledWith(
        'visit_1',
        '夕食後は家族の声かけで飲めている。\n便秘あり。次回も確認。',
      );
    });
    expect(screen.getByTestId('voice-memo-transcript-highlights').textContent).toContain(
      '夕食後は家族の声かけで飲めている。',
    );
    expect(screen.getByTestId('voice-memo-append-button')).toBeTruthy();
  });

  it('disables append after a transcript has been written to the visit record', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === '/api/visit-schedules/visit_1') {
        return new Response(JSON.stringify({ visit_record: { id: 'record_1' } }), { status: 200 });
      }
      if (url === '/api/visit-records/record_1' && init?.method !== 'PATCH') {
        return new Response(JSON.stringify({ version: 3, soap_subjective: '既存メモ' }), {
          status: 200,
        });
      }
      if (url === '/api/visit-records/record_1' && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ data: { id: 'record_1' } }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderContent();

    const textarea = await screen.findByTestId('voice-memo-manual-transcript');
    fireEvent.change(textarea, {
      target: {
        value: '夕食後は家族の声かけで飲めている。',
      },
    });
    fireEvent.click(screen.getByTestId('voice-memo-manual-apply-button'));

    const appendButton = await screen.findByTestId('voice-memo-append-button');
    fireEvent.click(appendButton);

    await waitFor(() => {
      expect(screen.getByTestId('voice-memo-append-button').textContent).toBe('記録へ反映済み');
    });
    expect((screen.getByTestId('voice-memo-append-button') as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByTestId('voice-memo-append-button'));

    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input) === '/api/visit-records/record_1' && init?.method === 'PATCH',
      ),
    ).toHaveLength(1);
  });
});
