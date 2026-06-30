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

const SELF_REPORT_DRAFT_STORAGE_KEY = 'ph-os:self-report-draft:v1:token_1';

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
        archive: { status: 'active', archived: false, archived_at: null },
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
    window.sessionStorage.clear();
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

  it('restores a same-session self report draft without posting it', async () => {
    window.sessionStorage.setItem(
      SELF_REPORT_DRAFT_STORAGE_KEY,
      JSON.stringify({
        reporterName: '家族B',
        relation: '長女',
        category: '残薬',
        subject: '残薬があります',
        content: '朝の薬が残っています。',
        preferredContactTime: '午前中',
        requestedCallback: false,
      }),
    );

    renderSharedViewerContent();

    fireEvent.change(screen.getByLabelText('OTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /閲覧する/ }));

    await screen.findByText('患者・ご家族からの連絡');

    await waitFor(() => {
      expect((screen.getByLabelText(/報告者氏名/) as HTMLInputElement).value).toBe('家族B');
    });
    expect((screen.getByLabelText('患者との関係') as HTMLInputElement).value).toBe('長女');
    expect((screen.getByLabelText('カテゴリ') as HTMLInputElement).value).toBe('残薬');
    expect((screen.getByLabelText(/件名/) as HTMLInputElement).value).toBe('残薬があります');
    expect((screen.getByLabelText(/内容/) as HTMLTextAreaElement).value).toBe(
      '朝の薬が残っています。',
    );
    expect((screen.getByLabelText('折返し希望時間') as HTMLInputElement).value).toBe('午前中');
    expect((screen.getByLabelText('薬局からの折返しを希望する') as HTMLInputElement).checked).toBe(
      false,
    );

    const postCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) => String(input).endsWith('/self-report') && init?.method === 'POST',
      );
    expect(postCalls).toHaveLength(0);
  });

  it('autosaves self report drafts without OTP data and clears them after accepted submit', async () => {
    renderSharedViewerContent();

    fireEvent.change(screen.getByLabelText('OTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /閲覧する/ }));

    await screen.findByText('患者・ご家族からの連絡');

    fireEvent.change(screen.getByLabelText(/報告者氏名/), { target: { value: '家族A' } });
    fireEvent.change(screen.getByLabelText('患者との関係'), { target: { value: '長男' } });
    fireEvent.change(screen.getByLabelText('カテゴリ'), { target: { value: '残薬' } });
    fireEvent.change(screen.getByLabelText(/件名/), { target: { value: '飲み忘れ' } });
    fireEvent.change(screen.getByLabelText(/内容/), { target: { value: '夕食後を飲み忘れ' } });
    fireEvent.change(screen.getByLabelText('折返し希望時間'), {
      target: { value: '平日18時以降' },
    });

    await waitFor(() => {
      const rawDraft = window.sessionStorage.getItem(SELF_REPORT_DRAFT_STORAGE_KEY);
      expect(rawDraft).not.toBeNull();
      const draft = JSON.parse(rawDraft ?? '{}') as Record<string, unknown>;
      expect(draft).toMatchObject({
        reporterName: '家族A',
        relation: '長男',
        category: '残薬',
        subject: '飲み忘れ',
        content: '夕食後を飲み忘れ',
        preferredContactTime: '平日18時以降',
        requestedCallback: true,
      });
      expect(draft).not.toHaveProperty('otp');
      expect(draft).not.toHaveProperty('activeOtp');
      expect(draft).not.toHaveProperty('idempotencyKey');
      expect(draft).not.toHaveProperty('idempotency_key');
    });

    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('自己申告を受け付けました'));
    await waitFor(() => {
      expect(window.sessionStorage.getItem(SELF_REPORT_DRAFT_STORAGE_KEY)).toBeNull();
    });

    expect((screen.getByLabelText(/報告者氏名/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('患者との関係') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('カテゴリ') as HTMLInputElement).value).toBe('服薬の困りごと');
    expect((screen.getByLabelText(/件名/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/内容/) as HTMLTextAreaElement).value).toBe('');
  });

  it('surfaces archive state without exposing internal archive ownership', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/external-access/token_1') {
        return new Response(
          JSON.stringify({
            data: {
              ...createSharedViewerPayload().data,
              patient: {
                id: 'patient_1',
                name: '山田太郎',
                birth_date: '1950-01-01',
                gender: 'male',
                archive: {
                  status: 'archived',
                  archived: true,
                  archived_at: '2026-06-30T09:00:00.000Z',
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: `Unhandled request: ${url}` }), {
        status: 500,
      });
    });

    renderSharedViewerContent();

    fireEvent.change(screen.getByLabelText('OTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /閲覧する/ }));

    expect(await screen.findByText('アーカイブ中')).toBeTruthy();
    expect(screen.getByText(/共有元では閲覧専用の患者情報/)).toBeTruthy();
    expect(screen.queryByText(/archived_by|internal_user/)).toBeNull();
  });
});
