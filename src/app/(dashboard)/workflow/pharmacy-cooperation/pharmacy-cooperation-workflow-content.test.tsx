// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PharmacyCooperationWorkflowContent } from './pharmacy-cooperation-workflow-content';

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
  return render(<PharmacyCooperationWorkflowContent />, { wrapper: createWrapper() });
}

describe('PharmacyCooperationWorkflowContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/patient-share-cases?limit=8') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'share_case_1',
                  status: 'draft',
                  starts_at: '2026-06-01T00:00:00.000Z',
                  ends_at: null,
                  updated_at: '2026-06-18T00:00:00.000Z',
                  partnership: {
                    id: 'partnership_1',
                    status: 'active',
                    partner_pharmacy: {
                      id: 'partner_pharmacy_1',
                      name: '協力薬局',
                      status: 'active',
                    },
                  },
                  patient_link: {
                    id: 'patient_link_1',
                    match_status: 'pending',
                    approved_by_base: null,
                    approved_by_partner: null,
                    accepted_at: null,
                    declined_at: null,
                    has_partner_patient_id: false,
                  },
                },
                {
                  id: 'share_case_accept_ready',
                  status: 'pending_partner',
                  starts_at: '2026-06-01T00:00:00.000Z',
                  ends_at: null,
                  updated_at: '2026-06-18T00:00:00.000Z',
                  partnership: {
                    id: 'partnership_1',
                    status: 'active',
                    partner_pharmacy: {
                      id: 'partner_pharmacy_1',
                      name: '協力薬局',
                      status: 'active',
                    },
                  },
                  patient_link: {
                    id: 'patient_link_2',
                    match_status: 'pending',
                    approved_by_base: 'base_user',
                    approved_by_partner: null,
                    accepted_at: null,
                    declined_at: null,
                    has_partner_patient_id: false,
                  },
                },
                {
                  id: 'share_case_activation_ready',
                  status: 'pending_partner',
                  starts_at: '2026-06-01T00:00:00.000Z',
                  ends_at: null,
                  updated_at: '2026-06-18T00:00:00.000Z',
                  partnership: {
                    id: 'partnership_1',
                    status: 'active',
                    partner_pharmacy: {
                      id: 'partner_pharmacy_1',
                      name: '協力薬局',
                      status: 'active',
                    },
                  },
                  patient_link: {
                    id: 'patient_link_3',
                    match_status: 'accepted',
                    approved_by_base: 'base_user',
                    approved_by_partner: 'partner_user',
                    accepted_at: '2026-06-18T01:00:00.000Z',
                    declined_at: null,
                    has_partner_patient_id: true,
                  },
                },
                {
                  id: 'share_case_active',
                  status: 'active',
                  starts_at: '2026-06-01T00:00:00.000Z',
                  ends_at: null,
                  updated_at: '2026-06-18T00:00:00.000Z',
                  partnership: {
                    id: 'partnership_1',
                    status: 'active',
                    partner_pharmacy: {
                      id: 'partner_pharmacy_1',
                      name: '協力薬局',
                      status: 'active',
                    },
                  },
                  patient_link: {
                    id: 'patient_link_4',
                    match_status: 'accepted',
                    approved_by_base: 'base_user',
                    approved_by_partner: 'partner_user',
                    accepted_at: '2026-06-18T01:00:00.000Z',
                    declined_at: null,
                    has_partner_patient_id: true,
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/patient-share-cases/share_case_1/consents?limit=8') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'share_consent_1',
                  share_case_id: 'share_case_1',
                  consent_record_id: 'consent_record_1',
                  consent_date: '2026-06-18T00:00:00.000Z',
                  consent_method: 'paper_scan',
                  scope_keys: ['pdf_output'],
                  has_file_asset: true,
                  valid_until: null,
                  revoked_at: null,
                  revoked_by: null,
                  created_by: 'base_user',
                  created_at: '2026-06-18T00:00:00.000Z',
                  updated_at: '2026-06-18T00:00:00.000Z',
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/patient-share-cases/share_case_active/correction-requests?limit=8') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'correction_1',
                  share_case_id: 'share_case_active',
                  target_owner: 'base_pharmacy',
                  target_type: 'patient_profile',
                  target_id: null,
                  field_path: 'notes',
                  request_type: 'correction',
                  status: 'open',
                  requested_by: 'partner_user',
                  responded_by: null,
                  resolved_by: null,
                  resolved_at: null,
                  created_at: '2026-06-18T01:00:00.000Z',
                  updated_at: '2026-06-18T01:00:00.000Z',
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/patient-share-cases/share_case_1/correction-requests?limit=8') {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (
          url === '/api/patient-share-cases/share_case_accept_ready/correction-requests?limit=8'
        ) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (
          url === '/api/patient-share-cases/share_case_activation_ready/correction-requests?limit=8'
        ) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (url === '/api/pharmacy-visit-requests?limit=8') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'visit_request_1',
                  share_case_id: 'share_case_1',
                  urgency: 'normal',
                  desired_start_at: '2026-06-20T01:00:00.000Z',
                  desired_end_at: null,
                  visit_type: 'regular',
                  status: 'requested',
                  estimated_amount: 5500,
                  accepted_at: null,
                  declined_at: null,
                  completed_at: null,
                  partner_pharmacy: {
                    id: 'partner_pharmacy_1',
                    name: '協力薬局',
                    status: 'active',
                  },
                  partnership: {
                    id: 'partnership_1',
                    base_site: { id: 'site_1', name: '基幹薬局' },
                  },
                  has_request_reason: true,
                  has_physician_instruction: true,
                  has_carry_items: false,
                  has_patient_home_notes: false,
                  has_decline_reason: false,
                },
                {
                  id: 'visit_request_record_ready',
                  share_case_id: 'share_case_active',
                  urgency: 'normal',
                  desired_start_at: '2026-06-20T01:00:00.000Z',
                  desired_end_at: null,
                  visit_type: 'regular',
                  status: 'accepted',
                  estimated_amount: 5500,
                  accepted_at: '2026-06-20T00:30:00.000Z',
                  declined_at: null,
                  completed_at: null,
                  partner_pharmacy: {
                    id: 'partner_pharmacy_1',
                    name: '協力薬局',
                    status: 'active',
                  },
                  partnership: {
                    id: 'partnership_1',
                    base_site: { id: 'site_1', name: '基幹薬局' },
                  },
                  has_request_reason: true,
                  has_physician_instruction: false,
                  has_carry_items: false,
                  has_patient_home_notes: false,
                  has_decline_reason: false,
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === '/api/partner-visit-records?limit=8') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'partner_record_submitted',
                  visit_request_id: 'visit_request_1',
                  share_case_id: 'share_case_1',
                  revision_no: 1,
                  status: 'submitted',
                  pharmacist_name: '担当薬剤師',
                  visit_at: '2026-06-20T02:00:00.000Z',
                  submitted_at: '2026-06-20T03:00:00.000Z',
                  confirmed_at: null,
                  owner_partner_pharmacy: {
                    id: 'partner_pharmacy_1',
                    name: '協力薬局',
                    status: 'active',
                  },
                  visit_request: {
                    id: 'visit_request_1',
                    status: 'accepted',
                    urgency: 'normal',
                  },
                  claim_note: null,
                  has_record_content: true,
                  attachment_count: 0,
                  has_returned_reason: false,
                  has_base_confirmation_snapshot: false,
                },
                {
                  id: 'partner_record_confirmed',
                  visit_request_id: 'visit_request_2',
                  share_case_id: 'share_case_1',
                  revision_no: 1,
                  status: 'confirmed',
                  pharmacist_name: '担当薬剤師',
                  visit_at: '2026-06-19T02:00:00.000Z',
                  submitted_at: '2026-06-19T03:00:00.000Z',
                  confirmed_at: '2026-06-19T04:00:00.000Z',
                  owner_partner_pharmacy: {
                    id: 'partner_pharmacy_1',
                    name: '協力薬局',
                    status: 'active',
                  },
                  visit_request: {
                    id: 'visit_request_2',
                    status: 'completed',
                    urgency: 'normal',
                  },
                  claim_note: {
                    id: 'claim_note_1',
                    claim_status: 'pending',
                    visit_date: '2026-06-19T00:00:00.000Z',
                    partner_pharmacy_name: '協力薬局',
                    prescription_received_by: '基幹薬局',
                    dispensing_pharmacy_name: '基幹薬局',
                  },
                  has_record_content: true,
                  attachment_count: 0,
                  has_returned_reason: false,
                  has_base_confirmation_snapshot: true,
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (
          url === '/api/patient-share-cases/share_case_activation_ready/activate' &&
          init?.method === 'POST'
        ) {
          return new Response(
            JSON.stringify({ id: 'share_case_activation_ready', status: 'active' }),
            {
              status: 200,
            },
          );
        }
        if (url === '/api/patient-share-cases/share_case_1/patient-link') {
          return new Response(JSON.stringify({ id: 'patient_link_1', match_status: 'pending' }), {
            status: 200,
          });
        }
        if (url === '/api/patient-share-cases/share_case_accept_ready/patient-link') {
          return new Response(JSON.stringify({ id: 'patient_link_2', match_status: 'accepted' }), {
            status: 200,
          });
        }
        if (url === '/api/patient-share-cases/share_case_1/consents' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'share_consent_created',
              share_case_id: 'share_case_1',
              consent_record_id: 'consent_record_2',
              consent_date: '2026-06-19T00:00:00.000Z',
              consent_method: 'paper_scan',
              scope_keys: ['pdf_output', 'attachments'],
              has_file_asset: true,
              valid_until: null,
              revoked_at: null,
              revoked_by: null,
              created_by: 'base_user',
              created_at: '2026-06-19T00:00:00.000Z',
              updated_at: '2026-06-19T00:00:00.000Z',
            }),
            { status: 201 },
          );
        }
        if (
          url === '/api/patient-share-cases/share_case_1/consents/share_consent_1/revoke' &&
          init?.method === 'POST'
        ) {
          return new Response(
            JSON.stringify({ id: 'share_consent_1', revoked_at: '2026-06-19T00:00:00.000Z' }),
            { status: 200 },
          );
        }
        if (url === '/api/patient-share-cases/share_case_active/correction-requests') {
          return new Response(
            JSON.stringify({
              id: 'correction_2',
              share_case_id: 'share_case_active',
              target_type: 'patient_profile',
              field_path: 'notes',
              status: 'open',
            }),
            { status: 201 },
          );
        }
        if (url === '/api/pharmacy-visit-requests/visit_request_1/decision') {
          return new Response(JSON.stringify({ id: 'visit_request_1', status: 'accepted' }), {
            status: 200,
          });
        }
        if (url === '/api/partner-visit-records' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'partner_record_draft',
              visit_request_id: 'visit_request_record_ready',
              share_case_id: 'share_case_active',
              revision_no: 1,
              status: 'draft',
              pharmacist_name: '協力 太郎',
              visit_at: '2026-06-20T01:30:00.000Z',
              submitted_at: null,
              confirmed_at: null,
              owner_partner_pharmacy: {
                id: 'partner_pharmacy_1',
                name: '協力薬局',
                status: 'active',
              },
              visit_request: {
                id: 'visit_request_record_ready',
                status: 'accepted',
                urgency: 'normal',
              },
              claim_note: null,
              has_record_content: true,
              attachment_count: 0,
              has_returned_reason: false,
              has_base_confirmation_snapshot: false,
            }),
            { status: 201 },
          );
        }
        if (url === '/api/partner-visit-records/partner_record_submitted/review') {
          return new Response(
            JSON.stringify({ id: 'partner_record_submitted', status: 'returned' }),
            {
              status: 200,
            },
          );
        }
        if (url === '/api/partner-visit-records/partner_record_confirmed/physician-report-draft') {
          return new Response(
            JSON.stringify({
              message: '医師向け報告書ドラフトを作成しました',
              reused_existing_draft: false,
              report: { id: 'care_report_1', status: 'draft', report_type: 'physician' },
            }),
            { status: 201 },
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('registers and revokes patient share consents without rendering raw consent person', async () => {
    renderContent();

    expect(await screen.findByText('share_consent_1')).toBeTruthy();
    expect(document.body.textContent).not.toContain('山田花子');

    fireEvent.change(screen.getByLabelText('患者共有同意日'), {
      target: { value: '2026-06-19' },
    });
    fireEvent.change(screen.getByLabelText('患者共有同意者'), {
      target: { value: '患者家族 山田花子' },
    });
    fireEvent.change(screen.getByLabelText('患者共有同意記録ID'), {
      target: { value: 'consent_record_2' },
    });
    fireEvent.change(screen.getByLabelText('患者共有同意添付ID'), {
      target: { value: 'file_1' },
    });
    fireEvent.click(screen.getByLabelText('患者共有同意PDF出力'));
    fireEvent.click(screen.getByLabelText('患者共有同意添付閲覧'));
    fireEvent.click(screen.getByRole('button', { name: /同意登録/ }));

    await waitFor(() => {
      const createConsentCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/patient-share-cases/share_case_1/consents' &&
            init?.method === 'POST',
        );
      expect(createConsentCall).toBeTruthy();
      expect(JSON.parse(String(createConsentCall?.[1]?.body))).toEqual({
        consent_date: '2026-06-19',
        consent_person: '患者家族 山田花子',
        consent_method: 'paper_scan',
        scope: {
          pdf_output: true,
          attachments: true,
        },
        consent_record_id: 'consent_record_2',
        file_asset_id: 'file_1',
      });
    });

    fireEvent.change(screen.getByLabelText('share_consent_1 の患者共有同意撤回理由'), {
      target: { value: '撤回連絡あり' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^撤回$/ }));

    await waitFor(() => {
      const revokeConsentCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) ===
              '/api/patient-share-cases/share_case_1/consents/share_consent_1/revoke' &&
            init?.method === 'POST',
        );
      expect(revokeConsentCall).toBeTruthy();
      expect(JSON.parse(String(revokeConsentCall?.[1]?.body))).toEqual({
        reason: '撤回連絡あり',
      });
    });
  });

  it('renders PHI-minimized share cases, visit requests, and partner visit records', async () => {
    renderContent();

    expect(await screen.findByText('有効化待ち共有')).toBeTruthy();
    expect(screen.getByText('依頼中の訪問')).toBeTruthy();
    expect(screen.getByText('確認待ち記録')).toBeTruthy();
    expect(await screen.findByText('share_case_1')).toBeTruthy();
    expect(await screen.findByText('share_case_active')).toBeTruthy();
    expect(await screen.findByText('visit_request_1')).toBeTruthy();
    expect(await screen.findByText('partner_record_submitted')).toBeTruthy();
    expect(await screen.findByText('correction_1')).toBeTruthy();
    expect(screen.getAllByText('協力薬局').length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain('山田');
    expect(document.body.textContent).not.toContain('訪問本文');
  });

  it('posts a share case activation and accepts a visit request from row actions', async () => {
    renderContent();

    const shareCasesTable = await screen.findByRole('table', { name: '患者共有ケース一覧' });
    const activationReadyCell = within(shareCasesTable).getByText('share_case_activation_ready');
    const activationReadyRow = activationReadyCell.closest('tr');
    expect(activationReadyRow).toBeTruthy();

    fireEvent.click(
      within(activationReadyRow as HTMLTableRowElement).getByRole('button', { name: /共有開始/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^受諾$/ }));

    await waitFor(() => {
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([input, init]) =>
              String(input) === '/api/patient-share-cases/share_case_activation_ready/activate' &&
              init?.method === 'POST',
          ),
      ).toBe(true);
      const decisionCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/pharmacy-visit-requests/visit_request_1/decision' &&
            init?.method === 'POST',
        );
      expect(decisionCall).toBeTruthy();
      expect(JSON.parse(String(decisionCall?.[1]?.body))).toEqual({ decision: 'accept' });
    });
  });

  it('updates patient links with base approval, partner acceptance, and decline reason', async () => {
    renderContent();

    const shareCasesTable = await screen.findByRole('table', { name: '患者共有ケース一覧' });
    const baseRow = within(shareCasesTable).getByText('share_case_1').closest('tr');
    const acceptReadyRow = within(shareCasesTable)
      .getByText('share_case_accept_ready')
      .closest('tr');
    expect(baseRow).toBeTruthy();
    expect(acceptReadyRow).toBeTruthy();

    fireEvent.click(
      within(baseRow as HTMLTableRowElement).getByRole('button', { name: /基幹承認/ }),
    );
    await waitFor(() => {
      const baseApprovalCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/patient-share-cases/share_case_1/patient-link' &&
            init?.method === 'PATCH' &&
            JSON.parse(String(init.body)).decision === 'base_approve',
        );
      expect(baseApprovalCall).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('share_case_1 の患者リンク辞退理由'), {
      target: { value: '同一患者として扱えません' },
    });
    fireEvent.click(within(baseRow as HTMLTableRowElement).getByRole('button', { name: /^辞退$/ }));
    await waitFor(() => {
      const declineCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/patient-share-cases/share_case_1/patient-link' &&
            init?.method === 'PATCH' &&
            JSON.parse(String(init.body)).decision === 'decline',
        );
      expect(JSON.parse(String(declineCall?.[1]?.body))).toEqual({
        decision: 'decline',
        decline_reason: '同一患者として扱えません',
      });
    });

    fireEvent.change(screen.getByLabelText('share_case_accept_ready の協力側ID'), {
      target: { value: 'partner_patient_1' },
    });
    fireEvent.change(screen.getByLabelText('share_case_accept_ready の協力側氏名'), {
      target: { value: '佐藤 花子' },
    });
    fireEvent.change(screen.getByLabelText('share_case_accept_ready の協力側生年月日'), {
      target: { value: '1940-01-02' },
    });
    fireEvent.click(
      within(acceptReadyRow as HTMLTableRowElement).getByRole('button', { name: /協力受諾/ }),
    );

    await waitFor(() => {
      const acceptCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/patient-share-cases/share_case_accept_ready/patient-link' &&
            init?.method === 'PATCH',
        );
      expect(JSON.parse(String(acceptCall?.[1]?.body))).toEqual(
        expect.objectContaining({
          decision: 'accept',
          partner_patient_id: 'partner_patient_1',
          partner_patient_snapshot: {
            name: '佐藤 花子',
            birth_date: '1940-01-02',
          },
        }),
      );
    });
  });

  it('creates and lists correction requests without rendering raw reason or proposed value', async () => {
    renderContent();

    expect(await screen.findByText('correction_1')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '修正依頼の項目' }), {
      target: { value: 'notes' },
    });
    fireEvent.change(screen.getByLabelText('修正依頼の理由'), {
      target: { value: '共有内容の確認が必要です' },
    });
    fireEvent.change(screen.getByLabelText('修正依頼の提案値'), {
      target: { value: '連携先確認済み' },
    });
    fireEvent.click(screen.getByRole('button', { name: /修正依頼を作成/ }));

    await waitFor(() => {
      const correctionCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/patient-share-cases/share_case_active/correction-requests' &&
            init?.method === 'POST',
        );
      expect(correctionCall).toBeTruthy();
      expect(JSON.parse(String(correctionCall?.[1]?.body))).toEqual({
        target_type: 'patient_profile',
        request_type: 'correction',
        field_path: 'notes',
        reason: '共有内容の確認が必要です',
        proposed_value: '連携先確認済み',
      });
    });

    expect(document.body.textContent).not.toContain('共有内容の確認が必要です');
    expect(document.body.textContent).not.toContain('連携先確認済み');
  });

  it('saves a partner visit record draft for an accepted visit request', async () => {
    renderContent();

    await screen.findByText('visit_request_record_ready');
    fireEvent.change(screen.getByLabelText('協力訪問記録の訪問日時'), {
      target: { value: '2026-06-20T10:30' },
    });
    fireEvent.change(screen.getByLabelText('協力訪問記録の薬剤師ID'), {
      target: { value: 'pharmacist_1' },
    });
    fireEvent.change(screen.getByLabelText('協力訪問記録の薬剤師名'), {
      target: { value: '協力 太郎' },
    });
    fireEvent.change(screen.getByLabelText('協力訪問記録の元記録ID'), {
      target: { value: 'visit_record_1' },
    });
    fireEvent.change(screen.getByLabelText('協力訪問記録の服薬状況'), {
      target: { value: '確認済み' },
    });
    fireEvent.change(screen.getByLabelText('協力訪問記録の残薬'), {
      target: { value: '残薬なし' },
    });
    fireEvent.change(screen.getByLabelText('協力訪問記録の提案'), {
      target: { value: '継続確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: /下書き保存/ }));

    await waitFor(() => {
      const createRecordCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/partner-visit-records' && init?.method === 'POST',
        );
      expect(createRecordCall).toBeTruthy();
      expect(JSON.parse(String(createRecordCall?.[1]?.body))).toEqual({
        visit_request_id: 'visit_request_record_ready',
        pharmacist_id: 'pharmacist_1',
        pharmacist_name: '協力 太郎',
        visit_at: new Date('2026-06-20T10:30').toISOString(),
        source_visit_record_id: 'visit_record_1',
        record_content: {
          medication_adherence: '確認済み',
          remaining_medications: '残薬なし',
          proposals: '継続確認',
        },
      });
    });
  });

  it('returns a submitted partner record with reason and creates a report draft for confirmed records', async () => {
    renderContent();

    const recordsTable = await screen.findByRole('table', { name: '協力訪問記録一覧' });
    fireEvent.change(within(recordsTable).getByLabelText('partner_record_submitted の差戻し理由'), {
      target: { value: '記録の確認が必要です' },
    });
    fireEvent.click(within(recordsTable).getByRole('button', { name: /差戻し/ }));
    fireEvent.click(within(recordsTable).getByRole('button', { name: /報告書ドラフト/ }));

    await waitFor(() => {
      const returnCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/partner-visit-records/partner_record_submitted/review' &&
            init?.method === 'POST',
        );
      expect(returnCall).toBeTruthy();
      expect(JSON.parse(String(returnCall?.[1]?.body))).toMatchObject({
        decision: 'return',
        return_reason: '記録の確認が必要です',
      });
    });

    expect(await screen.findByTestId('pharmacy-cooperation-report-result')).toBeTruthy();
    expect(screen.getByRole('link', { name: /報告書を開く/ }).getAttribute('href')).toBe(
      '/reports/care_report_1',
    );
  });
});
