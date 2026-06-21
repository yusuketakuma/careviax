// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PrintHubContent } from './print-hub-content';

const replaceMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/reports/print',
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: useSearchParamsMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

setupDomTestEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient = createTestQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderPrintHubContent(queryClient: QueryClient = createTestQueryClient()) {
  return {
    queryClient,
    ...render(<PrintHubContent />, { wrapper: createWrapper(queryClient) }),
  };
}

function physicianPrintAuditContent(assessment: string, reportDate = '2026-06-18') {
  return {
    patient: { name: '山田 太郎', birth_date: '1940-01-01', gender: 'M' },
    report_date: reportDate,
    visit_date: '2026-06-18',
    pharmacist_name: '薬剤師 太郎',
    prescriber: { name: '主治医 一郎', institution: '在宅診療所' },
    prescriptions: [
      {
        drug_name: 'アムロジピン錠5mg',
        dose: '1錠',
        frequency: '1日1回朝食後',
        days: 28,
      },
    ],
    medication_management: {
      compliance_summary: '概ね良好',
      adherence_score: 4,
      self_management: '家族支援あり',
      calendar_used: true,
    },
    adverse_events: { has_events: false, events: [] },
    functional_assessment: {
      lab_values: '未確認',
      sleep: '良好',
      cognition: '変化なし',
      diet_oral: '良好',
      mobility: '杖歩行',
      excretion: '自立',
    },
    residual_medications: [],
    assessment,
    plan: '次回も残薬確認',
    physician_communication: '処方継続で問題ありません',
    warnings: [],
  };
}

describe('PrintHubContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('type=first_visit_documents&patient_id=patient_1'),
    );
    vi.stubGlobal('print', vi.fn());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/patients/patient_1/documents') {
          return new Response(
            JSON.stringify({
              patient: { id: 'patient_1', name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
              print_readiness: {
                overall_status: 'ready',
                missing_required_count: 0,
                warning_count: 0,
                template_versions: [],
                checks: [
                  {
                    key: 'patient_profile',
                    label: '患者基本情報',
                    completed: true,
                    severity: 'required',
                    description: '差し込みできます。',
                    action_href: '/patients/patient_1/edit',
                    action_label: '基本情報を編集',
                  },
                ],
              },
              first_visit_documents: [
                {
                  id: 'doc_1',
                  case_id: 'case_1',
                  document_url: '/reports/print?copy=1',
                  delivered_at: '2026-06-16T00:00:00.000Z',
                  delivered_to: '山田 花子',
                  created_at: '2026-06-16T00:00:00.000Z',
                  updated_at: '2026-06-16T00:00:00.000Z',
                  emergency_contacts: [],
                  history: [],
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/first-visit-documents/print-batch') {
          expect(init?.method).toBe('POST');
          return new Response(JSON.stringify({ data: { print_batch_id: 'print_batch_1' } }), {
            status: 200,
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('records first-visit print history only after staff confirms output completion', async () => {
    renderPrintHubContent();

    await screen.findByTestId('print-target-first_visit_documents');
    expect(screen.getAllByLabelText('控えを保存').length).toBeGreaterThan(0);
    const printButton = await screen.findByTestId('print-submit-button');

    fireEvent.click(printButton);

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/first-visit-documents/print-batch',
      expect.anything(),
    );
    expect((await screen.findByTestId('first-visit-print-confirm-button')).textContent).toContain(
      '印刷完了を記録',
    );

    fireEvent.click(screen.getByTestId('first-visit-print-confirm-button'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/first-visit-documents/print-batch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            patient_id: 'patient_1',
            document_ids: ['doc_1'],
            save_copy: true,
          }),
        }),
      ),
    );
  });

  it('describes blocked first-visit printing without leaking patient values', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/documents') {
        return new Response(
          JSON.stringify({
            patient: { id: 'patient_1', name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
            print_readiness: {
              overall_status: 'ready',
              missing_required_count: 0,
              warning_count: 0,
              template_versions: [],
              checks: [],
            },
            first_visit_documents: [],
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    const printReason = await screen.findByText(
      '印刷対象の契約・同意文書がありません。患者詳細で文書を作成してから印刷してください。',
    );
    const printButton = screen.getByTestId('print-submit-button');

    expect(printButton).toHaveProperty('disabled', true);
    expect(printButton.getAttribute('aria-describedby')).toBe(printReason.id);
    expect(printReason.textContent).not.toMatch(/patient_1|山田|太郎|doc_/);

    fireEvent.click(printButton);

    expect(window.print).not.toHaveBeenCalled();
  });

  it('hides save-copy controls for print types without persisted copy support', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    vi.mocked(fetch).mockImplementationOnce(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/care-reports?limit=50&status=confirmed');
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    renderPrintHubContent();

    await screen.findByTestId('print-target-visit_report');

    expect(screen.queryAllByLabelText('控えを保存')).toHaveLength(0);
    expect(screen.queryByText(/患者文書にこの印刷プレビューの控えリンクを保存/)).toBeNull();
  });

  it('loads visit report preview content through the print audit endpoint', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_1',
                report_type: 'physician_report',
                content: physicianPrintAuditContent('訪問報告書の監査済み本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    await screen.findByText('訪問報告書の監査済み本文');
    expect(fetch).toHaveBeenCalledWith('/api/care-reports/report_1/print-audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
      body: JSON.stringify({ intent: 'preview_rendered' }),
    });
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/care-reports?limit=50&include_content=1',
      expect.anything(),
    );

    fireEvent.click(await screen.findByTestId('print-submit-button'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/care-reports/report_1/print-audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
        body: JSON.stringify({ intent: 'print_requested' }),
      }),
    );
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('does not show or print a visit report when the preview audit response is for another report', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_other',
                report_type: 'physician_report',
                content: physicianPrintAuditContent('別報告書として返された監査本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    expect(
      await screen.findByText('帳票データの読み込みに失敗しました。再読み込みしてください。'),
    ).toBeTruthy();
    expect(screen.queryByText('別報告書として返された監査本文')).toBeNull();
    expect(screen.getByTestId('print-submit-button')).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByTestId('print-submit-button'));

    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not show cached visit report content before the current preview audit resolves', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['print-hub-care-report-print-audit', 'org_1', 'report_1'], {
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          content: physicianPrintAuditContent('キャッシュ済みの古い監査本文', '2026-06-17'),
        },
      },
    });
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        return new Promise<Response>(() => {});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent(queryClient);

    expect(
      await screen.findByText(
        '帳票の明細を確認しています。完了するとこのプレビューに反映されます。',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('キャッシュ済みの古い監査本文')).toBeNull();
    expect(await screen.findByTestId('print-submit-button')).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByTestId('print-submit-button'));

    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not show cached visit report content when the current preview audit fails', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['print-hub-care-report-print-audit', 'org_1', 'report_1'], {
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          content: physicianPrintAuditContent('キャッシュ済みの失敗時本文', '2026-06-17'),
        },
      },
    });
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        return new Response(JSON.stringify({ error: 'audit failed' }), { status: 500 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent(queryClient);

    expect(
      await screen.findByText('帳票データの読み込みに失敗しました。再読み込みしてください。'),
    ).toBeTruthy();
    expect(screen.queryByText('キャッシュ済みの失敗時本文')).toBeNull();
    expect(screen.getByTestId('print-submit-button')).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByTestId('print-submit-button'));

    expect(window.print).not.toHaveBeenCalled();
  });

  it('uses only the current preview audit success for visit report content', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['print-hub-care-report-print-audit', 'org_1', 'report_1'], {
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          content: physicianPrintAuditContent('キャッシュ済みの旧本文', '2026-06-17'),
        },
      },
    });
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_1',
                report_type: 'physician_report',
                content: physicianPrintAuditContent('現在の監査済み本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent(queryClient);

    expect(await screen.findByText('現在の監査済み本文')).toBeTruthy();
    expect(screen.queryByText('キャッシュ済みの旧本文')).toBeNull();
  });

  it('does not print a visit report when the print-requested audit response is not audited', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    let printRequested = false;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body ?? '{}')) as { intent?: string };
        if (body.intent === 'print_requested') {
          printRequested = true;
          return new Response(
            JSON.stringify({
              data: {
                audited: false,
                report: {
                  id: 'report_1',
                  report_type: 'physician_report',
                  content: physicianPrintAuditContent('印刷前に表示済みの監査本文'),
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_1',
                report_type: 'physician_report',
                content: physicianPrintAuditContent('印刷前に表示済みの監査本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    expect(await screen.findByText('印刷前に表示済みの監査本文')).toBeTruthy();

    fireEvent.click(await screen.findByTestId('print-submit-button'));

    await waitFor(() => expect(printRequested).toBe(true));
    expect((await screen.findByRole('alert')).textContent).toContain(
      '報告書の印刷監査を記録できませんでした。再読み込みしてください。',
    );
    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not print a visit report when the print-requested audit success response is malformed', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    let printRequested = false;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body ?? '{}')) as { intent?: string };
        if (body.intent === 'print_requested') {
          printRequested = true;
          return new Response(JSON.stringify({ data: { audited: true } }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_1',
                report_type: 'physician_report',
                content: physicianPrintAuditContent('印刷前に表示済みの監査本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    expect(await screen.findByText('印刷前に表示済みの監査本文')).toBeTruthy();

    fireEvent.click(await screen.findByTestId('print-submit-button'));

    await waitFor(() => expect(printRequested).toBe(true));
    expect((await screen.findByRole('alert')).textContent).toContain(
      '報告書の印刷監査を記録できませんでした。再読み込みしてください。',
    );
    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not print a visit report when the print-requested audit response is for another report', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    let printRequested = false;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body ?? '{}')) as { intent?: string };
        if (body.intent === 'print_requested') {
          printRequested = true;
          return new Response(
            JSON.stringify({
              data: {
                audited: true,
                report: {
                  id: 'report_other',
                  report_type: 'physician_report',
                  content: physicianPrintAuditContent('別報告書として返された監査本文'),
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_1',
                report_type: 'physician_report',
                content: physicianPrintAuditContent('印刷前に表示済みの監査本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    expect(await screen.findByText('印刷前に表示済みの監査本文')).toBeTruthy();

    fireEvent.click(await screen.findByTestId('print-submit-button'));

    await waitFor(() => expect(printRequested).toBe(true));
    expect((await screen.findByRole('alert')).textContent).toContain(
      '報告書の印刷監査を記録できませんでした。再読み込みしてください。',
    );
    expect(window.print).not.toHaveBeenCalled();
  });
});
