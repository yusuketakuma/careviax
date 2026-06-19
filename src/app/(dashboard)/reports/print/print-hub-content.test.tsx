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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderPrintHubContent() {
  return render(<PrintHubContent />, { wrapper: createWrapper() });
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
                content: {
                  patient: { name: '山田 太郎' },
                  report_date: '2026-06-18',
                  assessment: '訪問報告書の監査済み本文',
                },
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
});
