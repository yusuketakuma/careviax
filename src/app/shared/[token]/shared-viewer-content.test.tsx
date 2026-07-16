// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';
const { toastSuccessMock, toastErrorMock, clientLogWarnMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  clientLogWarnMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock('@/lib/utils/client-log', () => ({
  clientLog: { warn: clientLogWarnMock },
}));

import { SharedViewerContent } from './shared-viewer-content';

const SELF_REPORT_DRAFT_STORAGE_KEY = 'ph-os:self-report-draft:v1:token_1';

function renderSharedViewerContent() {
  return render(<SharedViewerContent token="token_1" />, { wrapper: createQueryClientWrapper() });
}

function renderSharedViewerContentWithProductionQueryRetry() {
  const queryClient = createTestQueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        retryDelay: 0,
      },
    },
  });

  return render(<SharedViewerContent token="token_1" />, {
    wrapper: createQueryClientWrapper(queryClient),
  });
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
        allergy_info: true,
      },
      expires_at: '2026-06-18T09:00:00.000Z',
      self_report_history: [],
      shared_summary: {
        headline: '共有情報',
        bullets: [],
        key_medications: [],
        next_visit_date: null,
      },
    },
  };
}

function mockSelfReportPostFailure(status: number, body: Record<string, unknown>) {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/external-access/token_1') {
      return new Response(JSON.stringify(createSharedViewerPayload()), { status: 200 });
    }
    if (url === '/api/external-access/token_1/self-report' && init?.method === 'POST') {
      return new Response(JSON.stringify(body), { status });
    }
    return new Response(JSON.stringify({ message: `Unhandled request: ${url}` }), {
      status: 500,
    });
  });
}

async function unlockAndFillSelfReport() {
  fireEvent.change(screen.getByLabelText('OTP'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /閲覧する/ }));

  await screen.findByText('患者・ご家族からの連絡');

  fireEvent.change(screen.getByLabelText(/報告者氏名/), { target: { value: '家族A' } });
  fireEvent.change(screen.getByLabelText(/件名/), { target: { value: '飲み忘れ' } });
  fireEvent.change(screen.getByLabelText(/内容/), { target: { value: '夕食後を飲み忘れ' } });
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

  it('renders inbound communication summary as controlled counts and labels', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/external-access/token_1') {
        return new Response(
          JSON.stringify({
            data: {
              patient: {
                id: 'patient_1',
                name: '山田太郎',
                birth_date: '1950-01-01',
                gender: 'male',
                archive: { status: 'active', archived: false, archived_at: null },
              },
              scope: {
                inbound_communication_summary: true,
              },
              expires_at: '2026-06-18T09:00:00.000Z',
              self_report_history: [],
              shared_summary: {
                headline: '共有情報',
                bullets: [],
                key_medications: [],
                next_visit_date: null,
              },
              inbound_communication_summary: {
                version: 1,
                window: {
                  from: '2026-05-19T09:00:00.000Z',
                  to: '2026-06-18T09:00:00.000Z',
                  days: 30,
                },
                totals: {
                  event_count: 1,
                  signal_count: 2,
                  safety_event_count: 1,
                  medication_stock_event_count: 0,
                  schedule_event_count: 0,
                  report_event_count: 1,
                  urgent_signal_count: 1,
                  truncated: false,
                },
                latest_received_at: '2026-06-18T08:30:00.000Z',
                event_type_counts: [
                  { event_type: 'care_coordination', label: '連携事項', count: 1 },
                ],
                signal_domain_counts: [
                  { signal_domain: 'report', label: '報告', count: 1 },
                  { signal_domain: 'urgent', label: '至急', count: 1 },
                ],
                signal_type_counts: [
                  { signal_type: 'report_inclusion_candidate', label: '報告書候補', count: 2 },
                ],
                source_channel_counts: [{ source_channel: 'mcs', label: 'MCS', count: 1 }],
                recent_events: [
                  {
                    received_at: '2026-06-18T08:30:00.000Z',
                    event_type: 'care_coordination',
                    event_type_label: '連携事項',
                    source_channel: 'mcs',
                    source_channel_label: 'MCS',
                    sender_role: 'nurse',
                    sender_role_label: '看護師',
                    flags: {
                      medication_stock: false,
                      patient_safety: true,
                      schedule: false,
                      report: true,
                    },
                    signal_domains: [
                      { signal_domain: 'report', label: '報告' },
                      { signal_domain: 'urgent', label: '至急' },
                    ],
                    signal_types: [
                      { signal_type: 'report_inclusion_candidate', label: '報告書候補' },
                    ],
                    raw_text: 'LEAK_RAW_TEXT',
                    normalized_summary: 'LEAK_NORMALIZED_SUMMARY',
                    sender_contact: 'LEAK_SENDER_CONTACT',
                  },
                ],
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

    const { container } = renderSharedViewerContent();

    fireEvent.change(screen.getByLabelText('OTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /閲覧する/ }));

    await screen.findAllByText('他職種受信サマリー');

    expect(screen.getAllByText('他職種受信サマリー').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('確認済み連絡')).toBeTruthy();
    expect(screen.getByText('確認済みシグナル')).toBeTruthy();
    expect(screen.getByText('MCS 1件')).toBeTruthy();
    expect(screen.getByText('連携事項')).toBeTruthy();
    expect(screen.getByText(/看護師/)).toBeTruthy();
    expect(container.textContent).not.toContain('LEAK_');
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

  it('uses fixed recovery copy for shared viewer unlock failures', async () => {
    const poisonMessage = '患者 佐藤花子 / OTP=123456 / token=secret';
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: poisonMessage }), {
        status: 403,
      }),
    );

    renderSharedViewerContentWithProductionQueryRetry();

    fireEvent.change(screen.getByLabelText('OTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /閲覧する/ }));

    expect(
      await screen.findByText(
        '共有情報を取得できませんでした。共有リンクとOTPを確認して、もう一度お試しください。',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(poisonMessage)).toBeNull();
    await waitFor(() =>
      expect(clientLogWarnMock).toHaveBeenCalledWith(
        'external_access.viewer_load_failed',
        expect.any(Error),
        {
          route: '/shared/[token]',
          entityType: 'external_access_viewer',
          code: 'VIEWER_LOAD_FAILED',
        },
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries the same OTP after a shared viewer unlock failure', async () => {
    let unlockAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) !== '/api/external-access/token_1') {
        return new Response(JSON.stringify({ message: 'unexpected request' }), { status: 500 });
      }
      unlockAttempts += 1;
      if (unlockAttempts === 1) {
        return new Response(JSON.stringify({ message: 'temporary failure' }), { status: 503 });
      }
      return new Response(JSON.stringify(createSharedViewerPayload()), { status: 200 });
    });
    renderSharedViewerContentWithProductionQueryRetry();

    fireEvent.change(screen.getByLabelText('OTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /閲覧する/ }));
    await screen.findByText(
      '共有情報を取得できませんでした。共有リンクとOTPを確認して、もう一度お試しください。',
    );
    expect(unlockAttempts).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: /閲覧する/ }));
    await screen.findByText('山田太郎');
    expect(unlockAttempts).toBe(2);
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

  it('bounds reporter names before posting a self report', async () => {
    renderSharedViewerContent();
    await unlockAndFillSelfReport();

    const reporterNameInput = screen.getByLabelText(/報告者氏名/);
    expect(reporterNameInput.getAttribute('maxlength')).toBe('100');
    fireEvent.change(reporterNameInput, { target: { value: '名'.repeat(101) } });
    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));

    expect(screen.getByText('報告者氏名は100文字以内で入力してください')).toBeTruthy();
    expect(reporterNameInput.getAttribute('aria-invalid')).toBe('true');
    const postCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) => String(input).endsWith('/self-report') && init?.method === 'POST',
      );
    expect(postCalls).toHaveLength(0);
  });

  it('keeps generic self report submit failures PHI-safe', async () => {
    const poisonMessage = '患者 佐藤花子 / report=服薬忘れ / token=secret';
    mockSelfReportPostFailure(500, { message: poisonMessage });
    renderSharedViewerContent();

    await unlockAndFillSelfReport();
    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('自己申告の送信に失敗しました'),
    );
    expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain(poisonMessage);
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'external_access.self_report_submit_failed',
      expect.any(Error),
      {
        route: '/shared/[token]',
        entityType: 'external_access_self_report',
        code: 'SELF_REPORT_SUBMIT_FAILED',
        status: 500,
      },
    );
    expect(JSON.stringify(clientLogWarnMock.mock.calls.at(-1)?.[2])).not.toContain(poisonMessage);
  });

  it('falls back when generic self report submit failures have no message', async () => {
    mockSelfReportPostFailure(500, { message: '' });
    renderSharedViewerContent();

    await unlockAndFillSelfReport();
    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('自己申告の送信に失敗しました'),
    );
  });

  it('keeps the self report draft and uses fixed copy when the send result is ambiguous', async () => {
    const poisonMessage = '患者 佐藤花子 / report=服薬忘れ / token=secret';
    let selfReportAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/external-access/token_1') {
        return new Response(JSON.stringify(createSharedViewerPayload()), { status: 200 });
      }
      if (url === '/api/external-access/token_1/self-report' && init?.method === 'POST') {
        selfReportAttempts += 1;
        if (selfReportAttempts === 1) {
          throw new Error(poisonMessage);
        }
        return new Response(JSON.stringify({ data: { accepted: true, replayed: true } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled request: ${url}` }), {
        status: 500,
      });
    });
    renderSharedViewerContent();

    await unlockAndFillSelfReport();
    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        '通信により送信結果を確認できません。しばらく待ってからもう一度お試しください。',
      ),
    );
    expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain(poisonMessage);
    expect((screen.getByLabelText(/報告者氏名/) as HTMLInputElement).value).toBe('家族A');
    expect((screen.getByLabelText(/内容/) as HTMLTextAreaElement).value).toBe('夕食後を飲み忘れ');
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'external_access.self_report_submit_failed',
      expect.any(Error),
      {
        route: '/shared/[token]',
        entityType: 'external_access_self_report',
        code: 'SELF_REPORT_SUBMIT_FAILED',
        status: 0,
      },
    );

    const failedPostCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input).endsWith('/self-report') && init?.method === 'POST',
      );
    const failedIdempotencyKey = (failedPostCall?.[1]?.headers as Record<string, string>)[
      'Idempotency-Key'
    ];
    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('自己申告を受け付けました'));
    const postCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) => String(input).endsWith('/self-report') && init?.method === 'POST',
      );
    expect(postCalls).toHaveLength(2);
    expect((postCalls[1]?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      failedIdempotencyKey,
    );
  });

  it('treats an unreadable successful submit response as ambiguous and reuses its key', async () => {
    const poisonResponse = '{"patient":"佐藤花子","token":"secret"';
    let selfReportAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/external-access/token_1') {
        return new Response(JSON.stringify(createSharedViewerPayload()), { status: 200 });
      }
      if (url === '/api/external-access/token_1/self-report' && init?.method === 'POST') {
        selfReportAttempts += 1;
        if (selfReportAttempts === 1) {
          return new Response(poisonResponse, {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: { accepted: true, replayed: true } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled request: ${url}` }), {
        status: 500,
      });
    });
    renderSharedViewerContent();

    await unlockAndFillSelfReport();
    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        '通信により送信結果を確認できません。しばらく待ってからもう一度お試しください。',
      ),
    );
    expect(screen.queryByText('佐藤花子')).toBeNull();
    expect((screen.getByLabelText(/内容/) as HTMLTextAreaElement).value).toBe('夕食後を飲み忘れ');
    await waitFor(() => {
      const persistedDraft = window.sessionStorage.getItem(SELF_REPORT_DRAFT_STORAGE_KEY);
      expect(persistedDraft).toContain('夕食後を飲み忘れ');
      expect(persistedDraft).not.toContain('123456');
    });
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'external_access.self_report_submit_failed',
      expect.any(Error),
      {
        route: '/shared/[token]',
        entityType: 'external_access_self_report',
        code: 'SELF_REPORT_SUBMIT_FAILED',
        status: 201,
      },
    );

    const failedPostCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input).endsWith('/self-report') && init?.method === 'POST',
      );
    const failedIdempotencyKey = (failedPostCall?.[1]?.headers as Record<string, string>)[
      'Idempotency-Key'
    ];
    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('自己申告を受け付けました'));
    const postCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) => String(input).endsWith('/self-report') && init?.method === 'POST',
      );
    expect(postCalls).toHaveLength(2);
    expect((postCalls[1]?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      failedIdempotencyKey,
    );
  });

  it('treats an unaccepted successful response as ambiguous and reuses its key', async () => {
    let selfReportAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/external-access/token_1') {
        return new Response(JSON.stringify(createSharedViewerPayload()), { status: 200 });
      }
      if (url === '/api/external-access/token_1/self-report' && init?.method === 'POST') {
        selfReportAttempts += 1;
        if (selfReportAttempts === 1) {
          return new Response(JSON.stringify({ data: { accepted: false, replayed: false } }), {
            status: 201,
          });
        }
        return new Response(JSON.stringify({ data: { accepted: true, replayed: true } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled request: ${url}` }), {
        status: 500,
      });
    });
    renderSharedViewerContent();

    await unlockAndFillSelfReport();
    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        '通信により送信結果を確認できません。しばらく待ってからもう一度お試しください。',
      ),
    );
    expect((screen.getByLabelText(/内容/) as HTMLTextAreaElement).value).toBe('夕食後を飲み忘れ');
    await waitFor(() => {
      const persistedDraft = window.sessionStorage.getItem(SELF_REPORT_DRAFT_STORAGE_KEY);
      expect(persistedDraft).toContain('夕食後を飲み忘れ');
      expect(persistedDraft).not.toContain('123456');
    });

    const failedPostCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input).endsWith('/self-report') && init?.method === 'POST',
      );
    const failedIdempotencyKey = (failedPostCall?.[1]?.headers as Record<string, string>)[
      'Idempotency-Key'
    ];
    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('自己申告を受け付けました'));
    const postCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) => String(input).endsWith('/self-report') && init?.method === 'POST',
      );
    expect(postCalls).toHaveLength(2);
    expect((postCalls[1]?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      failedIdempotencyKey,
    );
  });

  it.each([
    [409, '同じ送信内容は受付済みの可能性があります。画面を更新して確認してください'],
    [429, '送信回数が多すぎます。しばらく待ってから再試行してください'],
  ])('keeps the fixed self report submit message for status %s', async (status, message) => {
    mockSelfReportPostFailure(status, { message: 'server message should not override fixed copy' });
    renderSharedViewerContent();

    await unlockAndFillSelfReport();
    fireEvent.click(screen.getByRole('button', { name: '薬局へ送信' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(message));
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
