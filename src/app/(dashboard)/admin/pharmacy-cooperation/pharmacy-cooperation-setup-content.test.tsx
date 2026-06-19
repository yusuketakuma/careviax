// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PharmacyCooperationSetupContent } from './pharmacy-cooperation-setup-content';

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
  return render(<PharmacyCooperationSetupContent />, { wrapper: createWrapper() });
}

describe('PharmacyCooperationSetupContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/pharmacy-sites') {
          return new Response(
            JSON.stringify({
              data: [{ id: 'site_1', name: '基幹薬局', address: '東京都' }],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/partner-pharmacies?limit=20') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'partner_pharmacy_1',
                  pharmacy_code: 'P001',
                  name: '協力薬局',
                  tel: '03-0000-0000',
                  status: 'active',
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/pharmacy-partnerships?limit=20') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'partnership_1',
                  status: 'draft',
                  base_site_id: 'site_1',
                  partner_pharmacy_id: 'partner_pharmacy_1',
                  effective_from: '2026-06-01T00:00:00.000Z',
                  effective_to: null,
                  base_site: { id: 'site_1', name: '基幹薬局' },
                  partner_pharmacy: {
                    id: 'partner_pharmacy_1',
                    name: '協力薬局',
                    status: 'active',
                  },
                },
                {
                  id: 'partnership_active',
                  status: 'active',
                  base_site_id: 'site_1',
                  partner_pharmacy_id: 'partner_pharmacy_1',
                  effective_from: '2026-06-01T00:00:00.000Z',
                  effective_to: null,
                  base_site: { id: 'site_1', name: '基幹薬局' },
                  partner_pharmacy: {
                    id: 'partner_pharmacy_1',
                    name: '協力薬局',
                    status: 'active',
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/pharmacy-contracts?limit=20') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'contract_1',
                  status: 'active',
                  effective_from: '2026-06-01T00:00:00.000Z',
                  effective_to: null,
                  partnership: {
                    id: 'partnership_active',
                    status: 'active',
                    base_site: { id: 'site_1', name: '基幹薬局' },
                    partner_pharmacy: {
                      id: 'partner_pharmacy_1',
                      name: '協力薬局',
                      status: 'active',
                    },
                  },
                  latest_version: {
                    version_no: 1,
                    status: 'active',
                    active_fee_rule: {
                      billing_model: 'fixed_per_visit',
                      unit_price: 5500,
                      tax_category: 'tax_pending',
                    },
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/templates?template_type=contract_document') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'template_contract_1',
                  name: '薬局間契約書',
                  template_type: 'contract_document',
                  format: 'html',
                  version: 2,
                  is_default: true,
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/pharmacy-contracts/contract_1/documents' && init?.method !== 'POST') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'contract_document_1',
                  contract_id: 'contract_1',
                  version_id: 'contract_version_1',
                  template_id: 'template_contract_1',
                  file_id: null,
                  document_type: 'basic_contract',
                  hash_value: 'hash_existing',
                  signed_at: null,
                  created_at: '2026-06-19T10:00:00.000Z',
                  updated_at: '2026-06-19T10:00:00.000Z',
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/partner-pharmacies' && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'partner_pharmacy_2', status: 'active' }), {
            status: 201,
          });
        }
        if (url === '/api/pharmacy-partnerships' && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'partnership_2', status: 'draft' }), {
            status: 201,
          });
        }
        if (url === '/api/pharmacy-partnerships/partnership_1/activate') {
          return new Response(JSON.stringify({ id: 'partnership_1', status: 'active' }), {
            status: 200,
          });
        }
        if (url === '/api/pharmacy-contracts' && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'contract_2', status: 'active' }), {
            status: 201,
          });
        }
        if (url === '/api/pharmacy-contracts/contract_1/documents' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          const preview = {
            document_type: 'basic_contract',
            hash_value: body.mode === 'preview' ? 'hash_preview' : 'hash_saved',
            rendered_text: '第1条 目的\n別紙費用条件表',
            snapshot: {
              template: {
                id: 'template_contract_1',
                name: '薬局間契約書',
                version: 2,
                format: 'html',
              },
              version: { id: 'contract_version_1', version_no: 1, status: 'active' },
              fee_schedule: {
                billing_model: 'fixed_per_visit',
                unit_price: 5500,
                tax_category: 'tax_pending',
                tax_rate_bp: null,
                rounding_rule: null,
              },
              articles: Array.from({ length: 23 }, (_value, index) => ({
                article_no: index + 1,
                title: `第${index + 1}条`,
              })),
            },
          };
          if (body.mode === 'preview') {
            return new Response(JSON.stringify({ mode: 'preview', ...preview }), { status: 200 });
          }
          return new Response(
            JSON.stringify({
              id: 'contract_document_2',
              contract_id: 'contract_1',
              version_id: 'contract_version_1',
              template_id: 'template_contract_1',
              file_id: body.signed_file_id ?? null,
              document_type: 'basic_contract',
              hash_value: 'hash_saved',
              signed_at: body.signed_at ?? null,
              created_at: '2026-06-19T11:00:00.000Z',
              updated_at: '2026-06-19T11:00:00.000Z',
              preview,
            }),
            { status: 201 },
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('renders setup lists without patient data', async () => {
    renderContent();

    expect(await screen.findByText('協力薬局登録')).toBeTruthy();
    expect(screen.getAllByText('協力薬局').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('partnership_1')).toBeTruthy();
    expect(screen.getByText('contract_1')).toBeTruthy();
    expect(document.body.textContent).not.toContain('山田');
  });

  it('creates a partner pharmacy and a draft pharmacy partnership', async () => {
    renderContent();

    await screen.findByText('協力薬局登録');
    fireEvent.change(screen.getByLabelText('協力薬局名'), { target: { value: '新協力薬局' } });
    fireEvent.change(screen.getByLabelText('薬局コード'), { target: { value: 'P002' } });
    fireEvent.click(screen.getByRole('button', { name: /^登録$/ }));
    fireEvent.click(screen.getByRole('button', { name: /連携作成/ }));

    await waitFor(() => {
      const partnerCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) => String(input) === '/api/partner-pharmacies' && init?.method === 'POST',
        );
      expect(partnerCall).toBeTruthy();
      expect(JSON.parse(String(partnerCall?.[1]?.body))).toMatchObject({
        name: '新協力薬局',
        pharmacy_code: 'P002',
      });

      const partnershipCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/pharmacy-partnerships' && init?.method === 'POST',
        );
      expect(partnershipCall).toBeTruthy();
      expect(JSON.parse(String(partnershipCall?.[1]?.body))).toMatchObject({
        base_site_id: 'site_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
      });
    });
  });

  it('activates a partnership and creates an active contract with approvals', async () => {
    renderContent();

    const partnershipsTable = await screen.findByRole('table', { name: '薬局間連携一覧' });
    fireEvent.change(within(partnershipsTable).getByLabelText('partnership_1 の基幹承認者'), {
      target: { value: 'base_manager' },
    });
    fireEvent.change(within(partnershipsTable).getByLabelText('partnership_1 の協力承認者'), {
      target: { value: 'partner_manager' },
    });
    fireEvent.click(within(partnershipsTable).getAllByRole('button', { name: /有効化/ })[0]);

    fireEvent.change(screen.getByLabelText('契約の基幹承認者'), {
      target: { value: 'base_manager' },
    });
    fireEvent.change(screen.getByLabelText('契約の協力承認者'), {
      target: { value: 'partner_manager' },
    });
    fireEvent.click(screen.getByRole('button', { name: /契約登録/ }));

    await waitFor(() => {
      const activationCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/pharmacy-partnerships/partnership_1/activate' &&
            init?.method === 'POST',
        );
      expect(activationCall).toBeTruthy();
      expect(JSON.parse(String(activationCall?.[1]?.body))).toEqual({
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
      });

      const contractCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) => String(input) === '/api/pharmacy-contracts' && init?.method === 'POST',
        );
      expect(contractCall).toBeTruthy();
      expect(JSON.parse(String(contractCall?.[1]?.body))).toMatchObject({
        partnership_id: 'partnership_active',
        status: 'active',
        base_approved_by: 'base_manager',
        partner_approved_by: 'partner_manager',
        fee_rule: {
          billing_model: 'fixed_per_visit',
          unit_price: 5500,
          tax_category: 'tax_pending',
        },
      });
    });
  });

  it('previews and saves a contract document from the setup screen', async () => {
    renderContent();

    await screen.findByText('契約書作成');
    expect(screen.getByText('contract_document_1')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('署名済みPDF FileAsset ID'), {
      target: { value: 'file_signed_pdf_1' },
    });
    fireEvent.change(screen.getByLabelText('契約書署名日'), {
      target: { value: '2026-06-19' },
    });
    fireEvent.click(screen.getByRole('button', { name: /プレビュー/ }));

    expect(await screen.findByText(/第1条 目的/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /契約書保存/ }));

    await waitFor(() => {
      const previewCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/pharmacy-contracts/contract_1/documents' &&
            init?.method === 'POST' &&
            JSON.parse(String(init.body)).mode === 'preview',
        );
      expect(previewCall).toBeTruthy();
      expect(JSON.parse(String(previewCall?.[1]?.body))).toMatchObject({
        mode: 'preview',
        template_id: 'template_contract_1',
        document_type: 'basic_contract',
      });

      const saveCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/pharmacy-contracts/contract_1/documents' &&
            init?.method === 'POST' &&
            JSON.parse(String(init.body)).mode === 'save',
        );
      expect(saveCall).toBeTruthy();
      expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
        mode: 'save',
        template_id: 'template_contract_1',
        signed_file_id: 'file_signed_pdf_1',
        signed_at: '2026-06-19',
      });
    });
  });
});
