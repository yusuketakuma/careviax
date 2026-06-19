// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PartnerCooperationBillingContent } from './partner-cooperation-billing-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

setupDomTestEnv();

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

function renderContent() {
  return render(<PartnerCooperationBillingContent />, { wrapper: createWrapper() });
}

type InvoiceFixture = {
  id: string;
  contract_id: string;
  document_kind: 'invoice' | 'free_cooperation_report';
  invoice_no: string | null;
  billing_month: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  status: string;
  issued_at: string | null;
  sent_at: string | null;
  received_at: string | null;
  payment_scheduled_for: string | null;
  paid_at: string | null;
  item_count: number;
  partnership: {
    base_site: { id: string; name: string };
    partner_pharmacy: { id: string; name: string; status: string };
  };
};

function createInvoiceFixture(overrides: Partial<InvoiceFixture> = {}): InvoiceFixture {
  const base: InvoiceFixture = {
    id: 'invoice_existing',
    contract_id: 'contract_1',
    document_kind: 'invoice',
    invoice_no: 'INV-001',
    billing_month: '2026-06-01',
    subtotal: 5500,
    tax_amount: 550,
    total: 6050,
    status: 'draft',
    issued_at: null,
    sent_at: null,
    received_at: null,
    payment_scheduled_for: null,
    paid_at: null,
    item_count: 1,
    partnership: {
      base_site: { id: 'site_1', name: '基幹薬局' },
      partner_pharmacy: {
        id: 'partner_pharmacy_1',
        name: '協力薬局',
        status: 'active',
      },
    },
  };
  return { ...base, ...overrides, partnership: overrides.partnership ?? base.partnership };
}

describe('PartnerCooperationBillingContent', () => {
  let invoiceRows: InvoiceFixture[];

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));
    vi.clearAllMocks();
    invoiceRows = [createInvoiceFixture()];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('/api/visit-billing-candidates/summary?')) {
          return new Response(
            JSON.stringify({
              billing_month: '2026-06-01',
              visit_record_count: 4,
              confirmed_visit_record_count: 3,
              unconfirmed_visit_record_count: 1,
              generated_candidate_count: 2,
              billable_candidate_count: 2,
              excluded_candidate_count: 0,
              invoiced_candidate_count: 0,
              free_candidate_count: 1,
              paid_candidate_count: 1,
              planned_invoice_amount: 5500,
              pending_candidate_generation_count: 1,
            }),
            { status: 200 },
          );
        }
        if (url.startsWith('/api/pharmacy-contracts?')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'contract_1',
                  status: 'active',
                  effective_from: '2026-06-01T00:00:00.000Z',
                  effective_to: null,
                  partnership: {
                    base_site: { name: '基幹薬局' },
                    partner_pharmacy: { name: '協力薬局', status: 'active' },
                  },
                  latest_version: {
                    version_no: 2,
                    active_fee_rule: {
                      billing_model: 'fixed_per_visit',
                      unit_price: 5500,
                      tax_category: 'taxable',
                    },
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.startsWith('/api/visit-billing-candidates?')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'candidate_1',
                  billing_month: '2026-06-01T00:00:00.000Z',
                  billing_status: 'candidate',
                  is_billable: true,
                  exclusion_reason: null,
                  amount_summary: {
                    billing_model: 'fixed_per_visit',
                    amount: 5500,
                    tax_category: 'taxable',
                    blocker_codes: [],
                  },
                  partner_visit_record: {
                    id: 'partner_visit_record_1',
                    visit_at: '2026-06-18T01:30:00.000Z',
                    status: 'confirmed',
                    confirmed_at: '2026-06-18T03:00:00.000Z',
                    owner_partner_pharmacy: { name: '協力薬局', status: 'active' },
                  },
                  contract_version: {
                    id: 'contract_version_1',
                    version_no: 2,
                    effective_from: '2026-06-01T00:00:00.000Z',
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.startsWith('/api/pharmacy-invoices?')) {
          return new Response(
            JSON.stringify({
              data: invoiceRows,
            }),
            { status: 200 },
          );
        }
        if (url === '/api/visit-billing-candidates' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              message: '2026-06-01 の薬局間協力訪問請求候補を生成しました',
              billing_month: '2026-06-01',
              scanned_confirmed_records: 3,
              generated_candidates: 3,
              billable_count: 2,
              excluded_count: 1,
              skipped_locked_count: 0,
            }),
            { status: 200 },
          );
        }
        if (url === '/api/pharmacy-invoices' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              message: '薬局間請求書ドラフトを作成しました',
              id: 'invoice_1',
              contract_id: 'contract_1',
              document_kind: 'invoice',
              billing_month: '2026-06-01',
              subtotal: 5500,
              tax_amount: 550,
              total: 6050,
              status: 'draft',
              reused_existing_draft: false,
              item_count: 1,
              items: [],
            }),
            { status: 201 },
          );
        }
        if (url.startsWith('/api/pharmacy-invoices/') && init?.method === 'PATCH') {
          const invoiceId = url.split('/').at(-1);
          const invoice = invoiceRows.find((row) => row.id === invoiceId) ?? invoiceRows[0];
          const body = JSON.parse(String(init.body ?? '{}')) as { action?: string };
          const nextStatus =
            body.action === 'cancel' ? 'cancelled' : body.action === 'issue' ? 'issued' : 'sent';
          return new Response(
            JSON.stringify({
              ...invoice,
              status: nextStatus,
              issued_at: body.action === 'issue' ? '2026-06-19T00:00:00.000Z' : invoice.issued_at,
              sent_at: null,
              received_at: null,
              payment_scheduled_for: null,
              paid_at: null,
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('renders monthly summary, contract selection, and PHI-minimized candidate rows', async () => {
    renderContent();

    expect(await screen.findByText('協力訪問記録')).toBeTruthy();
    expect(screen.getByText('確認済み 3 / 未確認 1')).toBeTruthy();
    expect(screen.getByText('予定請求額')).toBeTruthy();
    expect(screen.getAllByText('5,500円').length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText(/選択中: 基幹薬局/)).toBeTruthy();

    const table = await screen.findByRole('table', { name: '薬局間協力請求候補一覧' });
    expect(table.className).toContain('w-full');
    expect(screen.getByLabelText('請求候補内検索')).toBeTruthy();
    expect(within(table).getAllByText('協力薬局').length).toBeGreaterThanOrEqual(1);
    expect(within(table).getByText('有償/定額')).toBeTruthy();
    expect(within(table).getByText('候補')).toBeTruthy();
    const invoicesTable = await screen.findByRole('table', {
      name: '薬局間月次ドキュメント一覧',
    });
    expect(invoicesTable.className).toContain('w-full');
    expect(screen.getByLabelText('月次ドキュメント内検索')).toBeTruthy();
    expect(within(invoicesTable).getByText('請求書')).toBeTruthy();
    expect(within(invoicesTable).getByText('INV-001')).toBeTruthy();
    expect(
      within(invoicesTable)
        .getByRole('link', { name: '請求書 INV-001 PDFを開く' })
        .getAttribute('href'),
    ).toContain('/api/pharmacy-invoices/invoice_existing/pdf?purpose=');
    expect(JSON.stringify(document.body.textContent)).not.toContain('山田');
  });

  it('posts the selected billing month when generating visit billing candidates', async () => {
    renderContent();

    await screen.findByText(/選択中: 基幹薬局/);
    fireEvent.click(screen.getByRole('button', { name: /候補を生成/ }));

    await waitFor(() => {
      const postCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/visit-billing-candidates' && init?.method === 'POST',
        );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ billing_month: '2026-06-01' });
    });
  });

  it('creates a paid invoice draft for the selected active contract and exposes the PDF link', async () => {
    renderContent();

    await screen.findByText(/選択中: 基幹薬局/);
    fireEvent.click(screen.getByRole('button', { name: /請求書ドラフト/ }));

    const result = await screen.findByTestId('partner-invoice-draft-result');
    expect(within(result).getByText(/請求書ドラフト: invoice_1/)).toBeTruthy();
    expect(within(result).getByText(/合計 6,050円/)).toBeTruthy();
    expect(
      within(result)
        .getByRole('link', { name: /PDFを開く/ })
        .getAttribute('href'),
    ).toContain('/api/pharmacy-invoices/invoice_1/pdf?purpose=');

    const postCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input) === '/api/pharmacy-invoices' && init?.method === 'POST',
      );
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      billing_month: '2026-06-01',
      contract_id: 'contract_1',
      document_kind: 'invoice',
    });
  });

  it('updates invoice lifecycle state from the history table', async () => {
    renderContent();

    const invoicesTable = await screen.findByRole('table', {
      name: '薬局間月次ドキュメント一覧',
    });
    fireEvent.click(within(invoicesTable).getByRole('button', { name: /INV-001 発行/ }));

    expect(screen.getByText(/請求書を発行します/)).toBeTruthy();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/pharmacy-invoices/invoice_existing' && init?.method === 'PATCH',
        ),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '発行する' }));

    await waitFor(() => {
      const patchCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/pharmacy-invoices/invoice_existing' && init?.method === 'PATCH',
        );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
        action: 'issue',
        occurred_at: '2026-06-19',
      });
    });
  });

  it('requires a reason before cancelling an issued invoice lifecycle state', async () => {
    invoiceRows = [
      createInvoiceFixture({
        id: 'invoice_issued',
        invoice_no: 'INV-002',
        status: 'issued',
        issued_at: '2026-06-19T00:00:00.000Z',
      }),
    ];
    renderContent();

    const invoicesTable = await screen.findByRole('table', {
      name: '薬局間月次ドキュメント一覧',
    });
    fireEvent.click(within(invoicesTable).getByRole('button', { name: /INV-002 取消/ }));

    expect(screen.getByText(/請求書を取消します/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '取消する' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByLabelText('取消理由'), {
      target: { value: '重複して発行したため' },
    });
    expect((screen.getByRole('button', { name: '取消する' }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.click(screen.getByRole('button', { name: '取消する' }));

    await waitFor(() => {
      const patchCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/pharmacy-invoices/invoice_issued' && init?.method === 'PATCH',
        );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
        action: 'cancel',
        reason: '重複して発行したため',
      });
    });
  });
});
