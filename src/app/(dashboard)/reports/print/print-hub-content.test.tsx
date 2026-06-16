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
});
