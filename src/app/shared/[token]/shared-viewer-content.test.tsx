// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

import { SharedViewerContent } from './shared-viewer-content';

function renderSharedViewerContent() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SharedViewerContent token="token_1" />
    </QueryClientProvider>,
  );
}

function createSharedViewerPayload() {
  return {
    data: {
      patient: {
        id: 'patient_1',
        name: '山田太郎',
        birth_date: '1950-01-01',
        gender: 'male',
      },
      scope: {
        self_report_history: true,
      },
      expires_at: '2026-06-18T09:00:00.000Z',
      self_report_history: [],
    },
  };
}

describe('SharedViewerContent self report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/external-access/token_1') {
          return new Response(JSON.stringify(createSharedViewerPayload()), { status: 200 });
        }
        if (url === '/api/external-access/token_1/self-report' && init?.method === 'POST') {
          return new Response(JSON.stringify({ data: { accepted: true, replayed: false } }), {
            status: 201,
          });
        }
        return new Response(JSON.stringify({ message: `Unhandled request: ${url}` }), {
          status: 500,
        });
      }),
    );
  });

  it('sends self reports with an Idempotency-Key header without putting OTP or idempotency data in the body', async () => {
    renderSharedViewerContent();

    fireEvent.change(screen.getByLabelText('OTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /閲覧する/ }));

    await screen.findByText('患者・ご家族からの連絡');

    fireEvent.change(screen.getByLabelText(/報告者氏名/), { target: { value: '家族A' } });
    fireEvent.change(screen.getByLabelText(/件名/), { target: { value: '飲み忘れ' } });
    fireEvent.change(screen.getByLabelText(/内容/), { target: { value: '夕食後を飲み忘れ' } });
    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('自己申告を受け付けました'));

    const postCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input).endsWith('/self-report') && init?.method === 'POST',
      );
    expect(postCall).toBeTruthy();

    const headers = postCall?.[1]?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/^self-report:[A-Za-z0-9._:-]+$/);
    expect(headers['x-otp']).toBe('123456');

    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body).toMatchObject({
      reported_by_name: '家族A',
      subject: '飲み忘れ',
      content: '夕食後を飲み忘れ',
    });
    expect(body).not.toHaveProperty('otp');
    expect(body).not.toHaveProperty('idempotency_key');
  });

  it('shows inline required errors and does not post an empty self report', async () => {
    renderSharedViewerContent();

    fireEvent.change(screen.getByLabelText('OTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /閲覧する/ }));

    await screen.findByText('患者・ご家族からの連絡');

    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));

    expect(screen.getByText('報告者氏名を入力してください')).toBeTruthy();
    expect(screen.getByText('件名を入力してください')).toBeTruthy();
    expect(screen.getByText('内容を入力してください')).toBeTruthy();
    expect(screen.getByLabelText(/報告者氏名/).getAttribute('aria-invalid')).toBe('true');
    expect(toastErrorMock).toHaveBeenCalledWith('必須項目を確認してください');

    const postCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) => String(input).endsWith('/self-report') && init?.method === 'POST',
      );
    expect(postCalls).toHaveLength(0);
  });
});
