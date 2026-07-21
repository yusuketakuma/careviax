// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { PartnerCooperationBillingContent } from './partner-cooperation-billing-content';
import {
  candidateMeta,
  createCandidateSummaryResponse,
  createCandidateFixture,
  createContractsResponse,
  createInvoiceFixture,
  invoiceMeta,
  type InvoiceFixture,
} from './partner-cooperation-billing-content.test-fixtures';

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

function renderContent() {
  return render(<PartnerCooperationBillingContent />, { wrapper: createQueryClientWrapper() });
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
          return createCandidateSummaryResponse();
        }
        if (url.startsWith('/api/pharmacy-contracts?')) {
          return createContractsResponse();
        }
        if (url.startsWith('/api/visit-billing-candidates?')) {
          return new Response(
            JSON.stringify({
              data: [createCandidateFixture()],
              meta: candidateMeta(),
            }),
            { status: 200 },
          );
        }
        if (url.startsWith('/api/pharmacy-invoices?')) {
          return new Response(
            JSON.stringify({
              data: invoiceRows,
              meta: invoiceMeta({ totalCount: invoiceRows.length }),
            }),
            { status: 200 },
          );
        }
        if (url === '/api/visit-billing-candidates' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              data: {
                message: '2026-06-01 の薬局間協力訪問請求候補を生成しました',
                billing_month: '2026-06-01',
                scanned_confirmed_records: 3,
                generated_candidates: 3,
                billable_count: 2,
                excluded_count: 1,
                skipped_locked_count: 0,
              },
            }),
            { status: 200 },
          );
        }
        if (url === '/api/pharmacy-invoices' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              data: {
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
              },
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
              data: {
                id: invoice.id,
                contract_id: invoice.contract_id,
                document_kind: invoice.document_kind,
                invoice_no: invoice.invoice_no,
                billing_month: invoice.billing_month,
                subtotal: invoice.subtotal,
                tax_amount: invoice.tax_amount,
                total: invoice.total,
                status: nextStatus,
                issued_at: body.action === 'issue' ? '2026-06-19T00:00:00.000Z' : invoice.issued_at,
                sent_at: null,
                received_at: null,
                payment_scheduled_for: null,
                paid_at: null,
                updated_at: '2026-06-19T00:00:00.000Z',
                version: invoice.version + 1,
                item_count: invoice.item_count,
              },
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('shows the monthly summary error state for malformed summary success payloads', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/visit-billing-candidates/summary?')) {
        return new Response(
          JSON.stringify({
            data: {
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
              planned_invoice_amount: '5500',
            },
          }),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間協力の月次集計を表示できません')).toBeTruthy();
    expect(screen.getByText('対象月の集計取得に失敗しました。再試行してください。')).toBeTruthy();
  });

  it('shows the contract error state and retries instead of falsely rendering an empty contract selector', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    let contractsCallCount = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/pharmacy-contracts?')) {
        contractsCallCount += 1;
        if (contractsCallCount === 1) {
          return new Response(JSON.stringify({ message: 'internal error' }), { status: 500 });
        }
        return originalFetch!(input, init);
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('有効な薬局間契約を表示できません')).toBeTruthy();
    expect(screen.getByText('契約一覧の取得に失敗しました。再試行してください。')).toBeTruthy();
    expect(screen.queryByLabelText('対象契約')).toBeNull();
    expect(
      screen.getByText('契約一覧を取得できませんでした。上の「再試行」から取得し直してください。'),
    ).toBeTruthy();

    // Contract fetch failing must not blank out unrelated billing UI (no false-empty of the wider page).
    expect(await screen.findByText('協力訪問記録')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /請求書ドラフト/ }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    await screen.findByText(/選択中: 基幹薬局/);
    expect(screen.getByLabelText('対象契約')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /請求書ドラフト/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(contractsCallCount).toBeGreaterThanOrEqual(2);
  });

  it('rejects legacy root invoice cursor metadata instead of rendering a partial list', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/pharmacy-invoices?')) {
        return new Response(
          JSON.stringify({ data: invoiceRows, hasMore: false, nextCursor: null }),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間月次ドキュメントを表示できません')).toBeTruthy();
    expect(screen.queryByRole('table', { name: '薬局間月次ドキュメント一覧' })).toBeNull();
  });

  it('rejects malformed invoice draft success payloads before rendering the draft result', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-invoices' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            data: {
              id: 'invoice_1',
              billing_month: '2026-06-01',
              total: 6050,
            },
          }),
          { status: 201 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findByText(/選択中: 基幹薬局/);
    fireEvent.click(screen.getByRole('button', { name: /請求書ドラフト/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('薬局間月次ドキュメントの作成に失敗しました');
    });
    expect(screen.queryByTestId('partner-invoice-draft-result')).toBeNull();
  });

  it('rejects malformed invoice lifecycle PATCH success payloads before showing success', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-invoices/invoice_existing' && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({ data: { id: 'invoice_existing', status: 'issued' } }),
          {
            status: 200,
          },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    const invoicesTable = await screen.findByRole('table', {
      name: '薬局間月次ドキュメント一覧',
    });
    fireEvent.click(within(invoicesTable).getByRole('button', { name: /INV-001 発行/ }));
    fireEvent.click(screen.getByRole('button', { name: '発行する' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('薬局間月次ドキュメントの更新に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalledWith('請求書を更新しました');
  });

  it('rejects malformed candidate generation success payloads before showing success', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/visit-billing-candidates' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            data: {
              message: '2026-06-01 の薬局間協力訪問請求候補を生成しました',
              billing_month: '2026-06-01',
              scanned_confirmed_records: 3,
              generated_candidates: 3,
              billable_count: 2,
              excluded_count: 1,
            },
          }),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findByText(/選択中: 基幹薬局/);
    fireEvent.click(screen.getByRole('button', { name: /候補を生成/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('請求候補の生成に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('shows the billing error state for malformed billing candidate list success payloads', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
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
                  amount: '5500',
                  tax_category: 'taxable',
                  blocker_codes: [],
                },
                partner_visit_record: {
                  id: 'partner_visit_record_1',
                  visit_at: '2026-06-18T01:30:00.000Z',
                  status: 'confirmed',
                  confirmed_at: '2026-06-18T03:00:00.000Z',
                  owner_partner_pharmacy: { name: '協力薬局' },
                },
                contract_version: {
                  id: 'contract_version_1',
                  version_no: 2,
                  effective_from: '2026-06-01T00:00:00.000Z',
                },
              },
            ],
            meta: candidateMeta(),
          }),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間協力の請求候補を表示できません')).toBeTruthy();
    expect(screen.getByText('候補一覧の取得に失敗しました。再試行してください。')).toBeTruthy();
    expect(screen.queryByText('candidate_1')).toBeNull();
  });

  it('shows the billing error state when a valid candidate list omits cursor metadata', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
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
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間協力の請求候補を表示できません')).toBeTruthy();
    expect(screen.queryByText('candidate_1')).toBeNull();
    expect(JSON.stringify(document.body.textContent)).not.toContain('山田');
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
    expect(screen.getByLabelText('読込済み請求候補内検索')).toBeTruthy();
    expect(within(table).getAllByText('協力薬局').length).toBeGreaterThanOrEqual(1);
    expect(within(table).getByText('有償/定額')).toBeTruthy();
    expect(within(table).getByText('候補')).toBeTruthy();
    const invoicesTable = await screen.findByRole('table', {
      name: '薬局間月次ドキュメント一覧',
    });
    expect(invoicesTable.className).toContain('w-full');
    expect(screen.getByLabelText('読込済み月次ドキュメント内検索')).toBeTruthy();
    expect(within(invoicesTable).getByText('請求書')).toBeTruthy();
    expect(within(invoicesTable).getByText('INV-001')).toBeTruthy();
    expect(
      within(invoicesTable)
        .getByRole('link', { name: '請求書 INV-001 PDFを開く' })
        .getAttribute('href'),
    ).toBe('/api/pharmacy-invoices/invoice_existing/pdf?purpose=partner_cooperation_monthly_pdf');
    expect(JSON.stringify(document.body.textContent)).not.toContain('山田');
  });

  it('loads page 2 on demand for candidates and invoices without eager fetching', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/visit-billing-candidates?')) {
        const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
        return new Response(
          JSON.stringify(
            cursor === 'candidate_cursor_1'
              ? {
                  data: [createCandidateFixture('candidate_2', '協力薬局B')],
                  meta: candidateMeta({ totalCount: 2 }),
                }
              : {
                  data: [createCandidateFixture('candidate_1', '協力薬局A')],
                  meta: candidateMeta({
                    hasMore: true,
                    nextCursor: 'candidate_cursor_1',
                    totalCount: 2,
                  }),
                },
          ),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/pharmacy-invoices?')) {
        const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
        return new Response(
          JSON.stringify(
            cursor === 'invoice_cursor_1'
              ? {
                  data: [createInvoiceFixture({ id: 'invoice_2', invoice_no: 'INV-002' })],
                  meta: invoiceMeta({ totalCount: 2 }),
                }
              : {
                  data: [createInvoiceFixture()],
                  meta: invoiceMeta({
                    hasMore: true,
                    nextCursor: 'invoice_cursor_1',
                    totalCount: 2,
                  }),
                },
          ),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect((await screen.findAllByText('協力薬局A')).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText('INV-001')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('協力薬局B')).toBeNull();
    expect(screen.queryByText('INV-002')).toBeNull();
    expect(
      vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('cursor=')).length,
    ).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: '請求候補をさらに読み込む' }));
    expect((await screen.findAllByText('協力薬局B')).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: '月次ドキュメントをさらに読み込む' }));
    expect((await screen.findAllByText('INV-002')).length).toBeGreaterThanOrEqual(1);

    const candidatePage2Call = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => String(input).includes('cursor=candidate_cursor_1'));
    const invoicePage2Call = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => String(input).includes('cursor=invoice_cursor_1'));
    expect(candidatePage2Call).toBeTruthy();
    expect(invoicePage2Call).toBeTruthy();
    expect(String(candidatePage2Call?.[0])).toContain('billing_month=2026-06-01');
    expect(String(candidatePage2Call?.[0])).toContain('limit=20');
    expect(String(invoicePage2Call?.[0])).toContain('billing_month=2026-06-01');
    expect(String(invoicePage2Call?.[0])).toContain('limit=20');
    expect(
      screen.getByText('請求候補を 2 / 全 2 件読み込み済みです。対象月の候補一覧は確認済みです。'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        '月次ドキュメントを 2 / 全 2 件読み込み済みです。対象月の出力履歴は確認済みです。',
      ),
    ).toBeTruthy();
  });

  it('adds providers from loaded historical billing rows to active-contract filter options', async () => {
    invoiceRows = [
      createInvoiceFixture({
        partnership: {
          base_site: { id: 'site_1', name: '基幹薬局' },
          partner_pharmacy: {
            id: 'partner_pharmacy_historical',
            name: '旧協力薬局',
            status: 'inactive',
          },
        },
      }),
    ];

    renderContent();

    const providerFilter = await screen.findByLabelText('一覧の協力薬局');
    expect(within(providerFilter).getByRole('option', { name: '協力薬局' })).toBeTruthy();
    const historicalOption = within(providerFilter).getByRole('option', { name: '旧協力薬局' });
    expect(historicalOption.getAttribute('value')).toBe('partner_pharmacy_historical');
  });

  it('restarts a drifted candidate cursor chain from page one before rebuilding it', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    const candidateUrls: string[] = [];
    let firstPageCalls = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/visit-billing-candidates?')) {
        candidateUrls.push(url);
        const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
        if (cursor === 'candidate_cursor_1') {
          return new Response(
            JSON.stringify({
              data: [createCandidateFixture('candidate_2', '再構築前B薬局')],
              meta: candidateMeta({ totalCount: 3 }),
            }),
            { status: 200 },
          );
        }
        firstPageCalls += 1;
        return new Response(
          JSON.stringify(
            firstPageCalls === 1
              ? {
                  data: [createCandidateFixture('candidate_1', '再構築前A薬局')],
                  meta: candidateMeta({
                    hasMore: true,
                    nextCursor: 'candidate_cursor_1',
                    totalCount: 2,
                  }),
                }
              : {
                  data: [createCandidateFixture('candidate_3', '再構築後C薬局')],
                  meta: candidateMeta(),
                },
          ),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '請求候補をさらに読み込む' }));
    expect(await screen.findByText('請求候補の全件数と読込結果が一致しません')).toBeTruthy();
    expect(screen.getAllByText('再構築前B薬局').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));

    expect((await screen.findAllByText('再構築後C薬局')).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => {
      expect(screen.queryByText('再構築前A薬局')).toBeNull();
      expect(screen.queryByText('再構築前B薬局')).toBeNull();
    });
    expect(new URL(candidateUrls.at(-1)!, 'http://localhost').searchParams.has('cursor')).toBe(
      false,
    );
    expect(firstPageCalls).toBe(2);
  });

  it('starts new cursor chains when provider, status, or billing month filters change', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const parsedUrl = new URL(url, 'http://localhost');
      const billingMonth = parsedUrl.searchParams.get('billing_month') ?? '2026-06-01';
      const status = parsedUrl.searchParams.get('status');
      const partnerPharmacyId = parsedUrl.searchParams.get('partner_pharmacy_id');
      if (url.startsWith('/api/visit-billing-candidates?')) {
        const meta = candidateMeta({ status, partnerPharmacyId });
        meta.filters_applied.billing_month = billingMonth;
        return new Response(JSON.stringify({ data: [createCandidateFixture()], meta }), {
          status: 200,
        });
      }
      if (url.startsWith('/api/pharmacy-invoices?')) {
        const meta = invoiceMeta({ status, partnerPharmacyId });
        meta.filters_applied.billing_month = billingMonth;
        return new Response(JSON.stringify({ data: invoiceRows, meta }), { status: 200 });
      }
      return originalFetch!(input, init);
    });

    renderContent();
    await screen.findByRole('table', { name: '薬局間協力請求候補一覧' });

    fireEvent.change(screen.getByLabelText('請求候補の状態'), {
      target: { value: 'candidate' },
    });
    await waitFor(() => {
      const candidateCall = vi
        .mocked(fetch)
        .mock.calls.map(([input]) => String(input))
        .find(
          (url) =>
            url.includes('/api/visit-billing-candidates?') && url.includes('status=candidate'),
        );
      expect(candidateCall).toBeTruthy();
      expect(new URL(candidateCall!, 'http://localhost').searchParams.has('cursor')).toBe(false);
    });

    fireEvent.change(screen.getByLabelText('一覧の協力薬局'), {
      target: { value: 'partner_pharmacy_1' },
    });
    await waitFor(() => {
      const filteredCalls = vi
        .mocked(fetch)
        .mock.calls.map(([input]) => String(input))
        .filter((url) => url.includes('partner_pharmacy_id=partner_pharmacy_1'));
      expect(filteredCalls.some((url) => url.startsWith('/api/visit-billing-candidates?'))).toBe(
        true,
      );
      expect(filteredCalls.some((url) => url.startsWith('/api/pharmacy-invoices?'))).toBe(true);
      expect(filteredCalls.every((url) => !url.includes('cursor='))).toBe(true);
    });

    fireEvent.change(screen.getByLabelText('対象月'), { target: { value: '2026-07' } });
    await waitFor(() => {
      const julyCalls = vi
        .mocked(fetch)
        .mock.calls.map(([input]) => String(input))
        .filter((url) => url.includes('billing_month=2026-07-01'));
      expect(julyCalls.some((url) => url.startsWith('/api/visit-billing-candidates?'))).toBe(true);
      expect(julyCalls.some((url) => url.startsWith('/api/pharmacy-invoices?'))).toBe(true);
      expect(julyCalls.every((url) => !url.includes('cursor='))).toBe(true);
    });
  });

  it('keeps partial candidates visible and reports a repeated cursor instead of completing', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/visit-billing-candidates?')) {
        const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
        return new Response(
          JSON.stringify({
            data: [
              createCandidateFixture(
                cursor === 'repeated_cursor' ? 'candidate_2' : 'candidate_1',
                cursor === 'repeated_cursor' ? '協力薬局B' : '協力薬局A',
              ),
            ],
            meta: candidateMeta({
              hasMore: true,
              nextCursor: 'repeated_cursor',
              totalCount: 2,
            }),
          }),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '請求候補をさらに読み込む' }));
    expect((await screen.findAllByText('協力薬局B')).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('続きの読み込み位置が重複しました')).toBeTruthy();
    expect(
      screen.getByText(
        '請求候補を 2 / 全 2 件読み込み済みです。未読込または要確認の候補があります。',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '請求候補をさらに読み込む' })).toBeNull();
  });

  it('does not render duplicate candidate identities from later cursor pages', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/visit-billing-candidates?')) {
        const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
        return new Response(
          JSON.stringify(
            cursor
              ? {
                  data: [createCandidateFixture('candidate_1', '重複してはいけない薬局')],
                  meta: candidateMeta(),
                }
              : {
                  data: [createCandidateFixture('candidate_1', '協力薬局A')],
                  meta: candidateMeta({
                    hasMore: true,
                    nextCursor: 'candidate_cursor_1',
                    totalCount: 1,
                  }),
                },
          ),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();
    fireEvent.click(await screen.findByRole('button', { name: '請求候補をさらに読み込む' }));

    expect(await screen.findByText('請求候補の重複を検出しました')).toBeTruthy();
    expect(screen.getAllByText('協力薬局A').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('重複してはいけない薬局')).toBeNull();
  });

  it('posts the selected billing month when generating visit billing candidates', async () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
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
    expect(toast.success).toHaveBeenCalledWith('2026-06-01 の薬局間協力訪問請求候補を生成しました');
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['partner-cooperation-summary', 'org_1'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['partner-cooperation-candidates', 'org_1'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['partner-cooperation-invoices', 'org_1'],
    });
    invalidateSpy.mockRestore();
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
    ).toBe('/api/pharmacy-invoices/invoice_1/pdf?purpose=partner_cooperation_monthly_pdf');

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
        version: 1,
      });
      expect(new Headers(patchCall?.[1]?.headers).get('Idempotency-Key')).toMatch(
        /^pharmacy-invoice-transition:invoice_existing:issue:/,
      );
    });
    expect(toast.success).toHaveBeenCalledWith('請求書を更新しました');
  });

  it('reuses the same transition intent when retrying after a lost response', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    const patchCalls: RequestInit[] = [];
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/pharmacy-invoices/invoice_existing' && init?.method === 'PATCH') {
        patchCalls.push(init);
        if (patchCalls.length === 1) throw new TypeError('response lost');
      }
      return originalFetch!(input, init);
    });

    renderContent();
    const invoicesTable = await screen.findByRole('table', {
      name: '薬局間月次ドキュメント一覧',
    });
    fireEvent.click(within(invoicesTable).getByRole('button', { name: /INV-001 発行/ }));
    fireEvent.click(screen.getByRole('button', { name: '発行する' }));

    await waitFor(() => expect(patchCalls).toHaveLength(2));
    const firstKey = new Headers(patchCalls[0]?.headers).get('Idempotency-Key');
    const secondKey = new Headers(patchCalls[1]?.headers).get('Idempotency-Key');
    expect(firstKey).toMatch(/^pharmacy-invoice-transition:invoice_existing:issue:/);
    expect(secondKey).toBe(firstKey);
    expect(patchCalls[1]?.body).toBe(patchCalls[0]?.body);
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('請求書を更新しました');
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
        version: 1,
      });
    });
  });
});
