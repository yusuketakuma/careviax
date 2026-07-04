// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
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

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDateAfterDays(days: number) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function renderContent() {
  return render(<PharmacyCooperationSetupContent />, { wrapper: createQueryClientWrapper() });
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
              hasMore: false,
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
              hasMore: false,
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
                  effective_to: isoDateAfterDays(30),
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
              hasMore: false,
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
              hasMore: false,
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
          return new Response(
            JSON.stringify({
              id: 'partner_pharmacy_2',
              pharmacy_code: 'P002',
              name: '新協力薬局',
              tel: null,
              status: 'active',
              updated_at: '2026-06-19T10:30:00.000Z',
            }),
            { status: 201 },
          );
        }
        if (url === '/api/pharmacy-partnerships' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'partnership_2',
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
            }),
            { status: 201 },
          );
        }
        if (url === '/api/pharmacy-partnerships/partnership_1/activate') {
          return new Response(
            JSON.stringify({
              id: 'partnership_1',
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
            }),
            { status: 200 },
          );
        }
        if (url === '/api/pharmacy-contracts' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'contract_2',
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
            }),
            { status: 201 },
          );
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
              file_id: body.signed_file_id ?? (body.generate_pdf ? 'generated_file_1' : null),
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
        if (url === '/api/files/presigned-upload' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              data: {
                id: 'file_signed_pdf_1',
                uploadUrl: 'https://uploads.example.test/signed-contract.pdf',
                headers: { 'Content-Type': 'application/pdf' },
              },
            }),
            { status: 201 },
          );
        }
        if (url === 'https://uploads.example.test/signed-contract.pdf' && init?.method === 'PUT') {
          return new Response(null, {
            status: 200,
            headers: { etag: '"etag-signed-contract"' },
          });
        }
        if (url === '/api/files/complete' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          return new Response(
            JSON.stringify({
              data: {
                id: body.file_id,
              },
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('shows the setup error state for malformed contract list success payloads', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
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
                  },
                },
                latest_version: {
                  version_no: 1,
                  active_fee_rule: null,
                },
              },
            ],
            hasMore: false,
          }),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間協力設定を表示できません')).toBeTruthy();
    expect(screen.getByText('薬局間契約の取得に失敗しました')).toBeTruthy();
  });

  it('rejects malformed contract preview success payloads before rendering preview text', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-contracts/contract_1/documents' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body.mode === 'preview') {
          return new Response(
            JSON.stringify({
              mode: 'preview',
              document_type: 'basic_contract',
              hash_value: 'hash_preview',
              rendered_text: '第1条 目的',
            }),
            { status: 200 },
          );
        }
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findByText('契約書作成');
    fireEvent.click(screen.getByRole('button', { name: /プレビュー/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('契約書プレビューに失敗しました');
    });
    expect(screen.queryByText(/第1条 目的/)).toBeNull();
  });

  it('rejects malformed contract save success payloads before treating the document as saved', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-contracts/contract_1/documents' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body.mode === 'save') {
          return new Response(
            JSON.stringify({
              id: 'contract_document_2',
              contract_id: 'contract_1',
              version_id: 'contract_version_1',
              template_id: 'template_contract_1',
              file_id: 'generated_file_1',
              document_type: 'basic_contract',
              hash_value: 'hash_saved',
              signed_at: null,
              created_at: '2026-06-19T11:00:00.000Z',
              updated_at: '2026-06-19T11:00:00.000Z',
            }),
            { status: 201 },
          );
        }
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findByText('契約書作成');
    fireEvent.click(screen.getByRole('button', { name: /契約書保存/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('契約書の保存に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalledWith('契約書を保存しました');
  });

  it('does not upload a signed contract PDF when presigned upload response is malformed', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/files/presigned-upload' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            data: {
              id: 'file_signed_pdf_1',
            },
          }),
          { status: 201 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findByText('契約書作成');
    const signedPdf = new File(['signed'], 'signed-contract.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(screen.getByLabelText('署名済み契約書PDF'), {
      target: { files: [signedPdf] },
    });
    fireEvent.click(screen.getByRole('button', { name: /契約書保存/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('署名付きアップロードURLの取得に失敗しました');
    });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([input, init]) =>
            String(input) === 'https://uploads.example.test/signed-contract.pdf' &&
            init?.method === 'PUT',
        ),
    ).toBe(false);
  });

  it('renders setup lists without patient data', async () => {
    renderContent();

    expect(await screen.findByText('協力薬局登録')).toBeTruthy();
    expect(screen.getAllByText('協力薬局').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('partnership_1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('contract_1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('薬局間連携内検索')).toBeTruthy();
    expect(screen.getByLabelText('契約書内検索')).toBeTruthy();
    expect(screen.getByLabelText('薬局間契約内検索')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '列' }).length).toBeGreaterThanOrEqual(3);
    expect(document.body.textContent).not.toContain('山田');
  });

  it('shows PHI-free contract renewal alerts for contracts ending soon', async () => {
    renderContent();

    expect(await screen.findByText('契約更新アラート')).toBeTruthy();
    const alertList = screen.getByRole('list', { name: '契約更新アラート一覧' });
    const setupRoot = screen.getByTestId('pharmacy-cooperation-setup');
    const refreshButton = screen.getByRole('button', { name: /更新/ });

    expect(within(alertList).getByText('contract_1')).toBeTruthy();
    expect(within(alertList).getByText(/あと\d+日/)).toBeTruthy();
    expect(alertList.textContent).toContain('協力薬局');
    expect(alertList.textContent).toContain('有償/定額');
    expect(alertList.textContent).not.toContain('山田');
    expect(alertList.textContent).not.toContain('signed-contract.pdf');
    expect(
      setupRoot.compareDocumentPosition(alertList) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      alertList.compareDocumentPosition(refreshButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps setup controls at medical touch target size', async () => {
    renderContent();

    const setupRoot = await screen.findByTestId('pharmacy-cooperation-setup');
    expect(setupRoot.className).toContain('[&_button]:!h-11');
    expect(setupRoot.className).toContain('[&_input]:!h-11');
    expect(setupRoot.className).toContain('[&_select]:!h-11');

    const generatePdfCheckbox = screen.getByLabelText('PDFを生成して保存');
    expect(generatePdfCheckbox.className).toContain('size-11');
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

  it('rejects malformed partner pharmacy create success payloads before clearing the form', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/partner-pharmacies' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'partner_pharmacy_2', status: 'active' }), {
          status: 201,
        });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findByText('協力薬局登録');
    fireEvent.change(screen.getByLabelText('協力薬局名'), { target: { value: '新協力薬局' } });
    fireEvent.click(screen.getByRole('button', { name: /^登録$/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('協力薬局の登録に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalledWith('協力薬局を登録しました');
    expect((screen.getByLabelText('協力薬局名') as HTMLInputElement).value).toBe('新協力薬局');
  });

  it('rejects malformed pharmacy partnership create success payloads before showing success', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-partnerships' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'partnership_2', status: 'draft' }), {
          status: 201,
        });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findByText('協力薬局登録');
    fireEvent.click(screen.getByRole('button', { name: /連携作成/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('薬局間連携の作成に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalledWith('薬局間連携を作成しました');
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
    fireEvent.click(
      within(partnershipsTable).getByRole('button', {
        name: 'partnership_1 協力薬局 の薬局間連携を有効化',
      }),
    );

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

  it('rejects malformed partnership activation success payloads before showing success', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-partnerships/partnership_1/activate' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'partnership_1', status: 'active' }), {
          status: 200,
        });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    const partnershipsTable = await screen.findByRole('table', { name: '薬局間連携一覧' });
    fireEvent.change(within(partnershipsTable).getByLabelText('partnership_1 の基幹承認者'), {
      target: { value: 'base_manager' },
    });
    fireEvent.change(within(partnershipsTable).getByLabelText('partnership_1 の協力承認者'), {
      target: { value: 'partner_manager' },
    });
    fireEvent.click(
      within(partnershipsTable).getByRole('button', {
        name: 'partnership_1 協力薬局 の薬局間連携を有効化',
      }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('薬局間連携の有効化に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalledWith('薬局間連携を有効化しました');
  });

  it('rejects malformed pharmacy contract create success payloads before showing success', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-contracts' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'contract_2', status: 'active' }), {
          status: 201,
        });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findByText('協力薬局登録');
    fireEvent.change(screen.getByLabelText('契約の基幹承認者'), {
      target: { value: 'base_manager' },
    });
    fireEvent.change(screen.getByLabelText('契約の協力承認者'), {
      target: { value: 'partner_manager' },
    });
    fireEvent.click(screen.getByRole('button', { name: /契約登録/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('薬局間契約の登録に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalledWith('薬局間契約を登録しました');
  });

  it('previews and saves a contract document from the setup screen', async () => {
    renderContent();

    await screen.findByText('契約書作成');
    expect(screen.getAllByText('contract_document_1').length).toBeGreaterThanOrEqual(1);

    const signedPdf = new File(['signed'], 'signed-contract.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(screen.getByLabelText('署名済み契約書PDF'), {
      target: { files: [signedPdf] },
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
      expect(JSON.parse(String(saveCall?.[1]?.body))).not.toHaveProperty('generate_pdf');

      const presignCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/files/presigned-upload' && init?.method === 'POST',
        );
      expect(presignCall).toBeTruthy();
      expect(JSON.parse(String(presignCall?.[1]?.body))).toEqual({
        purpose: 'contract-document',
        file_name: 'signed-contract.pdf',
        mime_type: 'application/pdf',
        size_bytes: signedPdf.size,
      });

      const uploadCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === 'https://uploads.example.test/signed-contract.pdf' &&
            init?.method === 'PUT',
        );
      expect(uploadCall).toBeTruthy();

      const completeCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) => String(input) === '/api/files/complete' && init?.method === 'POST',
        );
      expect(completeCall).toBeTruthy();
      expect(JSON.parse(String(completeCall?.[1]?.body))).toEqual({
        file_id: 'file_signed_pdf_1',
        etag: '"etag-signed-contract"',
      });
    });
  });

  it('saves a generated contract PDF from the setup screen when no signed PDF is attached', async () => {
    renderContent();

    await screen.findByText('契約書作成');
    const generatePdfCheckbox = screen.getByLabelText('PDFを生成して保存');
    expect(generatePdfCheckbox.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /契約書保存/ }));

    await waitFor(() => {
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
        document_type: 'basic_contract',
        generate_pdf: true,
      });
      expect(JSON.parse(String(saveCall?.[1]?.body))).not.toHaveProperty('signed_file_id');
    });
  });
});
