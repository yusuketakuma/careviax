// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { PharmacyCooperationWorkflowContent } from './pharmacy-cooperation-workflow-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', async () => {
  const { createSonnerToastMock } = await import('@/test/sonner-test-utils');
  return createSonnerToastMock().module;
});

setupDomTestEnv();

function renderContent() {
  return render(<PharmacyCooperationWorkflowContent />, { wrapper: createQueryClientWrapper() });
}

function findFetchCall(
  predicate: (input: RequestInfo | URL, init: RequestInit | undefined) => boolean,
) {
  return vi.mocked(fetch).mock.calls.find(([input, init]) => predicate(input, init));
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
        if (url === '/api/patient-share-cases?limit=8&view_context=pharmacy_cooperation_workflow') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'share_case_1',
                  status: 'consent_pending',
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
                  status: 'partner_confirmation_pending',
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
                  status: 'partner_confirmation_pending',
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
              hasMore: false,
              total_count: 4,
              visible_count: 4,
              hidden_count: 0,
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
              hasMore: false,
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
              hasMore: false,
            }),
            { status: 200 },
          );
        }
        if (url === '/api/patient-share-cases/share_case_1/correction-requests?limit=8') {
          return new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200 });
        }
        if (
          url === '/api/patient-share-cases/share_case_accept_ready/correction-requests?limit=8'
        ) {
          return new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200 });
        }
        if (
          url === '/api/patient-share-cases/share_case_activation_ready/correction-requests?limit=8'
        ) {
          return new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200 });
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
                  contract_id: 'contract_1',
                  contract_version_id: 'contract_version_1',
                  estimated_amount: 5500,
                  estimated_snapshot: {
                    estimate_status: 'estimated',
                    billing_model: 'fixed_per_visit',
                    unit_price: 5500,
                    tax_category: 'taxable',
                  },
                  accepted_at: null,
                  declined_at: null,
                  completed_at: null,
                  updated_at: '2026-06-18T00:00:00.000Z',
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
                  contract_id: 'contract_1',
                  contract_version_id: 'contract_version_1',
                  estimated_amount: 5500,
                  estimated_snapshot: {
                    estimate_status: 'estimated',
                    billing_model: 'fixed_per_visit',
                    unit_price: 5500,
                    tax_category: 'taxable',
                  },
                  accepted_at: '2026-06-20T00:30:00.000Z',
                  declined_at: null,
                  completed_at: null,
                  updated_at: '2026-06-18T01:00:00.000Z',
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
              hasMore: false,
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
                  updated_at: '2026-06-20T03:00:00.000Z',
                  owner_partner_pharmacy: {
                    id: 'partner_pharmacy_1',
                    name: '協力薬局',
                    status: 'active',
                  },
                  visit_request: {
                    id: 'visit_request_1',
                    status: 'submitted',
                    urgency: 'normal',
                  },
                  claim_note: null,
                  record_content: {
                    medication_guidance: '服薬指導詳細',
                    visit_note: '訪問記録本文',
                  },
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
                  updated_at: '2026-06-19T04:00:00.000Z',
                  owner_partner_pharmacy: {
                    id: 'partner_pharmacy_1',
                    name: '協力薬局',
                    status: 'active',
                  },
                  visit_request: {
                    id: 'visit_request_2',
                    status: 'confirmed',
                    urgency: 'normal',
                  },
                  claim_note: {
                    id: 'claim_note_1',
                    claim_status: 'pending',
                    visit_date: '2026-06-19T00:00:00.000Z',
                    partner_pharmacy_name: '協力薬局',
                    prescription_received_by: null,
                    dispensing_pharmacy_name: null,
                  },
                  has_record_content: true,
                  attachment_count: 0,
                  has_returned_reason: false,
                  has_base_confirmation_snapshot: true,
                },
                {
                  id: 'partner_record_draft',
                  visit_request_id: 'visit_request_record_ready',
                  share_case_id: 'share_case_active',
                  revision_no: 1,
                  status: 'draft',
                  pharmacist_name: '協力 太郎',
                  visit_at: '2026-06-20T01:30:00.000Z',
                  submitted_at: null,
                  confirmed_at: null,
                  updated_at: '2026-06-20T01:30:00.000Z',
                  owner_partner_pharmacy: {
                    id: 'partner_pharmacy_1',
                    name: '協力薬局',
                    status: 'active',
                  },
                  visit_request: {
                    id: 'visit_request_record_ready',
                    status: 'recording',
                    urgency: 'normal',
                  },
                  claim_note: null,
                  has_record_content: true,
                  attachment_count: 0,
                  has_returned_reason: false,
                  has_base_confirmation_snapshot: false,
                },
              ],
              hasMore: false,
            }),
            { status: 200 },
          );
        }
        if (url.startsWith('/api/pharmacy-cooperation-message-threads?')) {
          const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
          const visitRequestId = params.get('visit_request_id');
          const shareCaseId = params.get('share_case_id') ?? 'share_case_active';
          const messageBody = visitRequestId ? '訪問依頼の確認事項です' : '確認事項があります';

          return new Response(
            JSON.stringify({
              data: [
                {
                  id: visitRequestId ? 'message_thread_visit_request' : 'message_thread_share_case',
                  org_id: 'org_1',
                  share_case_id: shareCaseId,
                  visit_request_id: visitRequestId,
                  context_type: visitRequestId ? 'visit_request' : 'patient_share_case',
                  status: 'open',
                  created_by: 'base_user',
                  last_message_at: '2026-06-20T01:40:00.000Z',
                  created_at: '2026-06-20T01:30:00.000Z',
                  updated_at: '2026-06-20T01:40:00.000Z',
                  messages: [
                    {
                      id: visitRequestId ? 'message_visit_1' : 'message_share_1',
                      org_id: 'org_1',
                      thread_id: visitRequestId
                        ? 'message_thread_visit_request'
                        : 'message_thread_share_case',
                      sender_user_id: 'partner_user',
                      sender_side: 'partner_pharmacy',
                      body: messageBody,
                      created_at: '2026-06-20T01:40:00.000Z',
                      updated_at: '2026-06-20T01:40:00.000Z',
                    },
                  ],
                },
              ],
              hasMore: false,
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
              target_owner: 'partner_pharmacy',
              target_type: 'patient_profile',
              target_id: null,
              field_path: 'notes',
              request_type: 'correction',
              status: 'open',
              requested_by: 'base_user',
              responded_by: null,
              resolved_by: null,
              resolved_at: null,
              created_at: '2026-06-19T10:20:00.000Z',
              updated_at: '2026-06-19T10:20:00.000Z',
            }),
            { status: 201 },
          );
        }
        if (url === '/api/pharmacy-visit-requests/visit_request_1/decision') {
          return new Response(JSON.stringify({ id: 'visit_request_1', status: 'accepted' }), {
            status: 200,
          });
        }
        if (url === '/api/pharmacy-visit-requests' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'visit_request_created',
              share_case_id: 'share_case_active',
              urgency: 'emergency',
              desired_start_at: '2026-06-20T01:30:00.000Z',
              desired_end_at: '2026-06-20T02:30:00.000Z',
              visit_type: 'physician_co_visit',
              status: 'requested',
              contract_id: 'contract_1',
              contract_version_id: 'contract_version_1',
              estimated_amount: 8800,
              estimated_snapshot: {
                estimate_status: 'estimated',
                billing_model: 'per_visit_with_addon',
                unit_price: 8800,
                tax_category: 'taxable',
              },
              accepted_at: null,
              declined_at: null,
              completed_at: null,
              updated_at: '2026-06-20T01:45:00.000Z',
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
              has_carry_items: true,
              has_patient_home_notes: true,
              has_decline_reason: false,
            }),
            { status: 201 },
          );
        }
        if (url === '/api/pharmacy-cooperation-message-threads' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          return new Response(
            JSON.stringify({
              thread: {
                id: 'message_thread_created',
                org_id: 'org_1',
                share_case_id: body.share_case_id,
                visit_request_id: body.visit_request_id ?? null,
                context_type: body.visit_request_id ? 'visit_request' : 'patient_share_case',
                status: 'open',
                created_by: 'base_user',
                last_message_at: '2026-06-20T01:45:00.000Z',
                created_at: '2026-06-20T01:45:00.000Z',
                updated_at: '2026-06-20T01:45:00.000Z',
                messages: [
                  {
                    id: 'message_created_1',
                    org_id: 'org_1',
                    thread_id: 'message_thread_created',
                    sender_user_id: 'base_user',
                    sender_side: 'base_pharmacy',
                    body: body.body,
                    created_at: '2026-06-20T01:45:00.000Z',
                    updated_at: '2026-06-20T01:45:00.000Z',
                  },
                ],
              },
              notification_count: 1,
            }),
            { status: 201 },
          );
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
              updated_at: '2026-06-20T01:45:00.000Z',
              owner_partner_pharmacy: {
                id: 'partner_pharmacy_1',
                name: '協力薬局',
                status: 'active',
              },
              visit_request: {
                id: 'visit_request_record_ready',
                status: 'recording',
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
            JSON.stringify({ data: { id: 'partner_record_submitted', status: 'returned' } }),
            {
              status: 200,
            },
          );
        }
        if (
          url === '/api/partner-visit-records/partner_record_draft/submit' &&
          init?.method === 'POST'
        ) {
          return new Response(JSON.stringify({ id: 'partner_record_draft', status: 'submitted' }), {
            status: 200,
          });
        }
        if (url === '/api/partner-visit-records/partner_record_confirmed/physician-report-draft') {
          return new Response(
            JSON.stringify({
              data: {
                message: '医師向け報告書ドラフトを作成しました',
                reused_existing_draft: false,
                report: { id: 'care_report_1', status: 'draft', report_type: 'physician' },
              },
            }),
            { status: 201 },
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('shows the workflow error state for malformed share case success payloads', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-share-cases?limit=8&view_context=pharmacy_cooperation_workflow') {
        return new Response(
          JSON.stringify({
            data: [{ id: 'share_case_1', partnership: null }],
            hasMore: false,
            total_count: 1,
            visible_count: 1,
            hidden_count: 0,
          }),
          { status: 200 },
        );
      }
      if (
        url === '/api/patient-share-cases/share_case_legacy/consents?limit=8' ||
        url === '/api/patient-share-cases/share_case_legacy/correction-requests?limit=8'
      ) {
        return new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200 });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間協力ワークフローを表示できません')).toBeTruthy();
    expect(screen.getByText('状態一覧の取得に失敗しました。再試行してください。')).toBeTruthy();
    expect(screen.queryByText('share_case_1')).toBeNull();
  });

  it('shows the workflow error state for cursor pages missing hasMore', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-share-cases?limit=8&view_context=pharmacy_cooperation_workflow') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'share_case_1',
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
                patient_link: null,
              },
            ],
            total_count: 1,
            visible_count: 1,
            hidden_count: 0,
          }),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間協力ワークフローを表示できません')).toBeTruthy();
    expect(screen.getByText('状態一覧の取得に失敗しました。再試行してください。')).toBeTruthy();
    expect(screen.queryByText('share_case_1')).toBeNull();
  });

  it('rejects malformed report draft success payloads before showing a generated report result', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/partner-visit-records/partner_record_confirmed/physician-report-draft') {
        return new Response(
          JSON.stringify({
            data: {
              message: '医師向け報告書ドラフトを作成しました',
              reused_existing_draft: false,
              report: { id: 'care_report_1', status: 'draft' },
            },
          }),
          { status: 201 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    const recordsTable = await screen.findByRole('table', { name: '協力訪問記録一覧' });
    const confirmedRow = within(recordsTable).getByText('partner_record_confirmed').closest('tr');
    expect(confirmedRow).toBeTruthy();
    fireEvent.click(
      within(confirmedRow as HTMLTableRowElement).getByRole('button', {
        name: 'partner_record_confirmed 協力薬局 の報告書ドラフトを作成',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '報告書ドラフトを作成する' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('報告書ドラフトの作成に失敗しました');
    });
    expect(screen.queryByTestId('pharmacy-cooperation-report-result')).toBeNull();
    expect(toast.success).not.toHaveBeenCalledWith('医師向け報告書ドラフトを作成しました');
  });

  it('registers and revokes patient share consents without rendering raw consent person', async () => {
    renderContent();

    expect((await screen.findAllByText('share_consent_1')).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('山田花子');
    expect(screen.queryByRole('button', { name: /CSV出力/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '印刷' })).toBeNull();

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

    const revokeButtonName = 'share_consent_1 の患者共有同意を撤回';
    const revokeReasonLabel = 'share_consent_1 の患者共有同意撤回理由';
    expect(
      screen
        .getAllByRole('button', { name: revokeButtonName })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);

    fireEvent.change(screen.getAllByLabelText(revokeReasonLabel)[0], {
      target: { value: '撤回連絡あり' },
    });
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('button', { name: revokeButtonName })
          .some((button) => !(button as HTMLButtonElement).disabled),
      ).toBe(true);
    });
    const revokeButton = screen
      .getAllByRole('button', {
        name: revokeButtonName,
      })
      .find((button) => !(button as HTMLButtonElement).disabled);
    expect(revokeButton).toBeTruthy();
    fireEvent.click(revokeButton as HTMLButtonElement);
    expect(
      findFetchCall(
        (input, init) =>
          String(input) ===
            '/api/patient-share-cases/share_case_1/consents/share_consent_1/revoke' &&
          init?.method === 'POST',
      ),
    ).toBeUndefined();
    expect(screen.getByRole('heading', { name: '患者共有同意を撤回します' })).toBeTruthy();
    expect(screen.getByText('同意: share_consent_1')).toBeTruthy();
    expect(screen.getByText('撤回理由: 入力済み (6文字)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤回する' }));

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

  it('shows the patient share consent empty state only for genuine empty results', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-share-cases/share_case_1/consents?limit=8') {
        return new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200 });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('患者共有同意はまだありません')).toBeTruthy();
    expect(screen.queryByText('薬局間協力ワークフローを表示できません')).toBeNull();
  });

  it('keeps patient share consent query failures out of the empty state', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-share-cases/share_case_1/consents?limit=8') {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間協力ワークフローを表示できません')).toBeTruthy();
    expect(screen.queryByText('患者共有同意はまだありません')).toBeNull();
  });

  it('renders PHI-minimized share cases, visit requests, and partner visit records', async () => {
    renderContent();

    expect(await screen.findByText('有効化待ち共有')).toBeTruthy();
    expect(screen.getByText('依頼中の訪問')).toBeTruthy();
    expect(screen.getByText('確認待ち記録')).toBeTruthy();
    expect(await screen.findByText('共有ケース 4 件')).toBeTruthy();
    expect((await screen.findAllByText('share_case_1')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('share_case_active')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('visit_request_1')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('partner_record_submitted')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('correction_1')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: /CSV出力/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '印刷' })).toBeNull();
    const shareCasesTable = screen.getByRole('table', { name: '患者共有ケース一覧' });
    expect(within(shareCasesTable).getByRole('columnheader', { name: '共有ケース' })).toBeTruthy();
    expect(within(shareCasesTable).getByRole('columnheader', { name: '操作' })).toBeTruthy();
    expect(screen.getAllByText('患者リンク').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('協力薬局').length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain('山田');
    expect(document.body.textContent).not.toContain('訪問本文');
    expect(document.body.textContent).not.toContain('訪問記録本文');
    expect(document.body.textContent).not.toContain('服薬指導詳細');
  });

  it('shows the patient share case empty state only for genuine empty results', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-share-cases?limit=8&view_context=pharmacy_cooperation_workflow') {
        return new Response(
          JSON.stringify({
            data: [],
            hasMore: false,
            total_count: 0,
            visible_count: 0,
            hidden_count: 0,
            status_counts: {
              draft: 0,
              consent_pending: 0,
              partner_confirmation_pending: 0,
              active: 0,
              suspended: 0,
              revoked: 0,
              ended: 0,
              declined: 0,
            },
          }),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('患者共有ケースはまだありません')).toBeTruthy();
    expect(screen.queryByText('薬局間協力ワークフローを表示できません')).toBeNull();
  });

  it('keeps patient share case query failures out of the empty state', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-share-cases?limit=8&view_context=pharmacy_cooperation_workflow') {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間協力ワークフローを表示できません')).toBeTruthy();
    expect(screen.queryByText('患者共有ケースはまだありません')).toBeNull();
  });

  it('shows the pharmacy visit request empty state only for genuine empty results', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-visit-requests?limit=8') {
        return new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200 });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('協力薬局への訪問依頼はまだありません')).toBeTruthy();
    expect(screen.queryByText('薬局間協力ワークフローを表示できません')).toBeNull();
  });

  it('keeps pharmacy visit request query failures out of the empty state', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-visit-requests?limit=8') {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間協力ワークフローを表示できません')).toBeTruthy();
    expect(screen.queryByText('協力薬局への訪問依頼はまだありません')).toBeNull();
  });

  it('shows the partner visit record empty state only for genuine empty results', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/partner-visit-records?limit=8') {
        return new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200 });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('協力訪問記録はまだありません')).toBeTruthy();
    expect(screen.queryByText('薬局間協力ワークフローを表示できません')).toBeNull();
  });

  it('keeps partner visit record query failures out of the empty state', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/partner-visit-records?limit=8') {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間協力ワークフローを表示できません')).toBeTruthy();
    expect(screen.queryByText('協力訪問記録はまだありません')).toBeNull();
  });

  it('shows total and hidden share-case counts from the API instead of only visible rows', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-share-cases?limit=8&view_context=pharmacy_cooperation_workflow') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'share_case_1',
                status: 'consent_pending',
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
                patient_link: null,
              },
            ],
            hasMore: true,
            nextCursor: 'share_case_1',
            total_count: 7,
            visible_count: 1,
            hidden_count: 6,
            status_counts: {
              draft: 0,
              consent_pending: 6,
              partner_confirmation_pending: 0,
              active: 1,
              suspended: 0,
              revoked: 0,
              ended: 0,
              declined: 0,
            },
          }),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('共有ケース 7 件 / 表示 1 件 / 他 6 件')).toBeTruthy();
    const pendingShareCard = screen.getByText('有効化待ち共有').closest('div');
    expect(pendingShareCard).toBeTruthy();
    expect(within(pendingShareCard as HTMLElement).getByText('6')).toBeTruthy();
  });

  it('keeps rendering legacy share-case cursor pages that do not include count metadata', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-share-cases?limit=8&view_context=pharmacy_cooperation_workflow') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'share_case_legacy',
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
                patient_link: null,
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

    expect(await screen.findByText('共有ケース 1 件')).toBeTruthy();
    expect((await screen.findAllByText('share_case_legacy')).length).toBeGreaterThan(0);
  });

  it('fails closed when share-case count metadata is internally inconsistent', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-share-cases?limit=8&view_context=pharmacy_cooperation_workflow') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'share_case_bad_counts',
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
                patient_link: null,
              },
            ],
            hasMore: true,
            nextCursor: 'share_case_bad_counts',
            total_count: 7,
            visible_count: 1,
            hidden_count: 0,
          }),
          { status: 200 },
        );
      }
      return originalFetch!(input, init);
    });

    renderContent();

    expect(await screen.findByText('薬局間協力ワークフローを表示できません')).toBeTruthy();
    expect(screen.getByText('状態一覧の取得に失敗しました。再試行してください。')).toBeTruthy();
    expect(screen.queryByText('share_case_bad_counts')).toBeNull();
  });

  it('posts a share case activation and accepts a visit request from row actions', async () => {
    renderContent();

    const shareCasesTable = await screen.findByRole('table', { name: '患者共有ケース一覧' });
    const activationReadyCell = within(shareCasesTable).getByText('share_case_activation_ready');
    const activationReadyRow = activationReadyCell.closest('tr');
    expect(activationReadyRow).toBeTruthy();

    fireEvent.click(
      within(activationReadyRow as HTMLTableRowElement).getByRole('button', {
        name: 'share_case_activation_ready 協力薬局 を共有開始',
      }),
    );
    expect(
      findFetchCall(
        (input, init) =>
          String(input) === '/api/patient-share-cases/share_case_activation_ready/activate' &&
          init?.method === 'POST',
      ),
    ).toBeUndefined();
    expect(screen.getByRole('heading', { name: '患者共有ケースを共有開始します' })).toBeTruthy();
    expect(screen.getByText('共有ケース: share_case_activation_ready')).toBeTruthy();
    expect(screen.getByText('協力薬局: 協力薬局')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '共有開始する' }));

    await waitFor(() => {
      expect(
        Boolean(
          findFetchCall(
            (input, init) =>
              String(input) === '/api/patient-share-cases/share_case_activation_ready/activate' &&
              init?.method === 'POST',
          ),
        ),
      ).toBe(true);
    });

    const visitRequestsTable = await screen.findByRole('table', {
      name: '協力薬局訪問依頼一覧',
    });
    const requestedVisitRow = within(visitRequestsTable).getByText('visit_request_1').closest('tr');
    expect(requestedVisitRow).toBeTruthy();
    await waitFor(() => {
      expect(
        (
          within(requestedVisitRow as HTMLTableRowElement).getByRole('button', {
            name: 'visit_request_1 協力薬局 の訪問依頼を受諾',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });
    fireEvent.click(
      within(requestedVisitRow as HTMLTableRowElement).getByRole('button', {
        name: 'visit_request_1 協力薬局 の訪問依頼を受諾',
      }),
    );
    expect(
      findFetchCall(
        (input, init) =>
          String(input) === '/api/pharmacy-visit-requests/visit_request_1/decision' &&
          init?.method === 'POST',
      ),
    ).toBeUndefined();
    expect(screen.getByRole('heading', { name: '訪問依頼を受諾します' })).toBeTruthy();
    expect(screen.getByText('訪問依頼: visit_request_1')).toBeTruthy();
    expect(screen.getByText('協力薬局: 協力薬局')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '受諾する' }));

    await waitFor(() => {
      const decisionCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/pharmacy-visit-requests/visit_request_1/decision' &&
            init?.method === 'POST',
        );
      expect(decisionCall).toBeTruthy();
      expect(JSON.parse(String(decisionCall?.[1]?.body))).toEqual({
        decision: 'accept',
        expected_updated_at: '2026-06-18T00:00:00.000Z',
      });
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
    expect(
      within(baseRow as HTMLTableRowElement).getByRole('button', {
        name: 'share_case_1 協力薬局 の修正依頼対象にする',
      }),
    ).toBeTruthy();

    fireEvent.click(
      within(baseRow as HTMLTableRowElement).getByRole('button', {
        name: 'share_case_1 協力薬局 の患者リンクを基幹承認',
      }),
    );
    expect(
      findFetchCall(
        (input, init) =>
          String(input) === '/api/patient-share-cases/share_case_1/patient-link' &&
          init?.method === 'PATCH',
      ),
    ).toBeUndefined();
    expect(screen.getByRole('heading', { name: '患者リンクを基幹承認します' })).toBeTruthy();
    expect(screen.getByText('共有ケース: share_case_1')).toBeTruthy();
    expect(screen.getByText('協力薬局: 協力薬局')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '基幹承認する' }));
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

    fireEvent.change(
      within(baseRow as HTMLTableRowElement).getByLabelText('share_case_1 の患者リンク辞退理由'),
      {
        target: { value: '同一患者として扱えません' },
      },
    );
    fireEvent.click(
      within(baseRow as HTMLTableRowElement).getByRole('button', {
        name: 'share_case_1 協力薬局 の患者リンクを辞退',
      }),
    );
    expect(
      findFetchCall(
        (input, init) =>
          String(input) === '/api/patient-share-cases/share_case_1/patient-link' &&
          init?.method === 'PATCH' &&
          JSON.parse(String(init.body)).decision === 'decline',
      ),
    ).toBeUndefined();
    expect(screen.getByRole('heading', { name: '患者リンクを辞退します' })).toBeTruthy();
    expect(screen.getByText('共有ケース: share_case_1')).toBeTruthy();
    expect(screen.getByText('協力薬局: 協力薬局')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '辞退する' }));
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

    fireEvent.change(
      within(acceptReadyRow as HTMLTableRowElement).getByLabelText(
        'share_case_accept_ready の協力側ID',
      ),
      {
        target: { value: 'partner_patient_1' },
      },
    );
    fireEvent.change(
      within(acceptReadyRow as HTMLTableRowElement).getByLabelText(
        'share_case_accept_ready の協力側氏名',
      ),
      {
        target: { value: '佐藤 花子' },
      },
    );
    fireEvent.change(
      within(acceptReadyRow as HTMLTableRowElement).getByLabelText(
        'share_case_accept_ready の協力側生年月日',
      ),
      {
        target: { value: '1940-01-02' },
      },
    );
    fireEvent.click(
      within(acceptReadyRow as HTMLTableRowElement).getByRole('button', {
        name: 'share_case_accept_ready 協力薬局 の患者リンクを協力受諾',
      }),
    );
    expect(
      findFetchCall(
        (input, init) =>
          String(input) === '/api/patient-share-cases/share_case_accept_ready/patient-link' &&
          init?.method === 'PATCH',
      ),
    ).toBeUndefined();
    expect(screen.getByRole('heading', { name: '患者リンクを協力受諾します' })).toBeTruthy();
    expect(screen.getByText('共有ケース: share_case_accept_ready')).toBeTruthy();
    expect(screen.getByText('協力側ID: partner_patient_1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '協力受諾する' }));

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

  it('requires confirmation before declining a requested pharmacy visit request', async () => {
    renderContent();

    const visitRequestsTable = await screen.findByRole('table', {
      name: '協力薬局訪問依頼一覧',
    });
    const requestedRow = within(visitRequestsTable).getByText('visit_request_1').closest('tr');
    expect(requestedRow).toBeTruthy();

    fireEvent.change(
      within(requestedRow as HTMLTableRowElement).getByLabelText('visit_request_1 の辞退理由'),
      {
        target: { value: '協力薬局の訪問枠が不足しています' },
      },
    );
    fireEvent.click(
      within(requestedRow as HTMLTableRowElement).getByRole('button', {
        name: 'visit_request_1 協力薬局 の訪問依頼を辞退',
      }),
    );
    expect(
      findFetchCall(
        (input, init) =>
          String(input) === '/api/pharmacy-visit-requests/visit_request_1/decision' &&
          init?.method === 'POST',
      ),
    ).toBeUndefined();
    expect(screen.getByRole('heading', { name: '訪問依頼を辞退します' })).toBeTruthy();
    expect(screen.getByText('訪問依頼: visit_request_1')).toBeTruthy();
    expect(screen.getByText('協力薬局: 協力薬局')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '辞退する' }));

    await waitFor(() => {
      const declineCall = findFetchCall(
        (input, init) =>
          String(input) === '/api/pharmacy-visit-requests/visit_request_1/decision' &&
          init?.method === 'POST',
      );
      expect(declineCall).toBeTruthy();
      expect(JSON.parse(String(declineCall?.[1]?.body))).toEqual({
        decision: 'decline',
        expected_updated_at: '2026-06-18T00:00:00.000Z',
        decline_reason: '協力薬局の訪問枠が不足しています',
      });
    });
  });

  it('creates a pharmacy visit request with contract-estimate fields and no raw clinical text in the list', async () => {
    renderContent();

    await screen.findAllByText('share_case_active');

    const createButton = screen.getByRole('button', { name: /訪問依頼を作成/ });
    expect((createButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole('combobox', { name: '訪問依頼作成の共有ケース' }), {
      target: { value: 'share_case_active' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '訪問依頼の緊急度' }), {
      target: { value: 'emergency' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '訪問依頼の訪問区分' }), {
      target: { value: 'physician_co_visit' },
    });
    fireEvent.change(screen.getByLabelText('訪問依頼の希望開始'), {
      target: { value: '2026-06-20T10:30' },
    });
    fireEvent.change(screen.getByLabelText('訪問依頼の希望終了'), {
      target: { value: '2026-06-20T11:30' },
    });
    fireEvent.change(screen.getByLabelText('訪問依頼の依頼理由'), {
      target: { value: '  退院直後の服薬確認が必要です  ' },
    });
    fireEvent.change(screen.getByLabelText('訪問依頼の医師指示'), {
      target: { value: '  血圧と副作用を確認  ' },
    });
    fireEvent.change(screen.getByLabelText('訪問依頼の持参薬・物品'), {
      target: { value: '分包済み一包\n\n残薬バッグ' },
    });
    fireEvent.change(screen.getByLabelText('訪問依頼の居宅注意事項'), {
      target: { value: '  玄関暗証番号は家族へ確認  ' },
    });

    expect((createButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(createButton);

    await waitFor(() => {
      const createVisitRequestCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/pharmacy-visit-requests' && init?.method === 'POST',
        );
      expect(createVisitRequestCall).toBeTruthy();
      expect(createVisitRequestCall?.[1]?.headers).toEqual(
        expect.objectContaining({
          'content-type': 'application/json',
          'x-org-id': 'org_1',
        }),
      );
      expect(JSON.parse(String(createVisitRequestCall?.[1]?.body))).toEqual({
        share_case_id: 'share_case_active',
        urgency: 'emergency',
        visit_type: 'physician_co_visit',
        desired_start_at: new Date('2026-06-20T10:30').toISOString(),
        desired_end_at: new Date('2026-06-20T11:30').toISOString(),
        request_reason: '退院直後の服薬確認が必要です',
        physician_instruction: '血圧と副作用を確認',
        carry_items: ['分包済み一包', '残薬バッグ'],
        patient_home_notes: '玄関暗証番号は家族へ確認',
      });
    });

    expect(document.body.textContent).not.toContain('退院直後の服薬確認が必要です');
    expect(document.body.textContent).not.toContain('血圧と副作用を確認');
    expect(document.body.textContent).not.toContain('玄関暗証番号');
    expect(screen.getAllByText(/契約 contract_1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1訪問固定/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/単価 5,500円/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/見積済み/).length).toBeGreaterThan(0);
  });

  it('creates and lists correction requests without rendering raw reason or proposed value', async () => {
    renderContent();

    const correctionTable = await screen.findByRole('table', { name: '修正依頼一覧' });
    expect(within(correctionTable).getByText('correction_1')).toBeTruthy();
    expect(screen.getByLabelText('修正依頼内検索')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '列' }).length).toBeGreaterThanOrEqual(1);
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

  it('rejects malformed correction request create success payloads before showing success', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (
        url === '/api/patient-share-cases/share_case_active/correction-requests' &&
        init?.method === 'POST'
      ) {
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
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findByRole('table', { name: '修正依頼一覧' });
    fireEvent.change(screen.getByRole('combobox', { name: '修正依頼の項目' }), {
      target: { value: 'notes' },
    });
    fireEvent.change(screen.getByLabelText('修正依頼の理由'), {
      target: { value: '共有内容の確認が必要です' },
    });
    fireEvent.click(screen.getByRole('button', { name: /修正依頼を作成/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('修正依頼の作成に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalledWith('修正依頼を作成しました');
  });

  it('rejects malformed patient share consent create success before clearing the consent form', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-share-cases/share_case_1/consents' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'share_consent_created' }), { status: 201 });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findAllByText('share_consent_1');
    fireEvent.change(screen.getByLabelText('患者共有同意日'), {
      target: { value: '2026-06-19' },
    });
    fireEvent.change(screen.getByLabelText('患者共有同意者'), {
      target: { value: '患者家族 山田花子' },
    });
    fireEvent.click(screen.getByRole('button', { name: /同意登録/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('患者共有同意の登録に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalledWith('患者共有同意を登録しました');
    expect(screen.getByLabelText<HTMLInputElement>('患者共有同意者').value).toBe(
      '患者家族 山田花子',
    );
  });

  it('rejects malformed pharmacy visit request create success before clearing raw clinical fields', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-visit-requests' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'visit_request_2', status: 'requested' }), {
          status: 201,
        });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findAllByText('share_case_active');
    fireEvent.change(screen.getByRole('combobox', { name: '訪問依頼作成の共有ケース' }), {
      target: { value: 'share_case_active' },
    });
    fireEvent.change(screen.getByLabelText('訪問依頼の希望開始'), {
      target: { value: '2026-06-20T10:30' },
    });
    fireEvent.change(screen.getByLabelText('訪問依頼の依頼理由'), {
      target: { value: '退院直後の服薬確認が必要です' },
    });
    fireEvent.change(screen.getByLabelText('訪問依頼の医師指示'), {
      target: { value: '血圧と副作用を確認' },
    });
    fireEvent.change(screen.getByLabelText('訪問依頼の居宅注意事項'), {
      target: { value: '玄関暗証番号は家族へ確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: /訪問依頼を作成/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('訪問依頼の作成に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalledWith('訪問依頼を作成しました');
    expect(screen.getByLabelText<HTMLTextAreaElement>('訪問依頼の依頼理由').value).toBe(
      '退院直後の服薬確認が必要です',
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>('訪問依頼の医師指示').value).toBe(
      '血圧と副作用を確認',
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>('訪問依頼の居宅注意事項').value).toBe(
      '玄関暗証番号は家族へ確認',
    );
  });

  it('rejects malformed pharmacy cooperation message create success before clearing message text', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-cooperation-message-threads' && init?.method === 'POST') {
        return new Response(JSON.stringify({ thread: { id: 'message_thread_created' } }), {
          status: 201,
        });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findByText('確認事項があります');
    fireEvent.change(screen.getByLabelText('薬局間連携メッセージ本文'), {
      target: { value: '服薬状況を共有します' },
    });
    fireEvent.click(screen.getByRole('button', { name: /メッセージ送信/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('メッセージの送信に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalledWith('メッセージを送信しました');
    expect(screen.getByLabelText<HTMLTextAreaElement>('薬局間連携メッセージ本文').value).toBe(
      '服薬状況を共有します',
    );
  });

  it('rejects malformed partner visit record draft success before clearing record fields', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    expect(originalFetch).toBeTruthy();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/partner-visit-records' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'partner_record_draft', status: 'draft' }), {
          status: 201,
        });
      }
      return originalFetch!(input, init);
    });

    renderContent();

    await screen.findAllByText('visit_request_record_ready');
    fireEvent.change(screen.getByLabelText('協力訪問記録の訪問日時'), {
      target: { value: '2026-06-20T10:30' },
    });
    fireEvent.change(screen.getByLabelText('協力訪問記録の服薬状況'), {
      target: { value: '服薬確認済み' },
    });
    fireEvent.change(screen.getByLabelText('協力訪問記録の残薬'), {
      target: { value: '残薬なし' },
    });
    fireEvent.change(screen.getByLabelText('協力訪問記録の提案'), {
      target: { value: '継続確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: /下書き保存/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('協力訪問記録の保存に失敗しました');
    });
    expect(toast.success).not.toHaveBeenCalledWith('協力訪問記録の下書きを保存しました');
    expect(screen.getByLabelText<HTMLTextAreaElement>('協力訪問記録の服薬状況').value).toBe(
      '服薬確認済み',
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>('協力訪問記録の残薬').value).toBe('残薬なし');
    expect(screen.getByLabelText<HTMLTextAreaElement>('協力訪問記録の提案').value).toBe('継続確認');
  });

  it('lists and posts pharmacy cooperation messages for visit request contexts', async () => {
    renderContent();

    expect(await screen.findByText('確認事項があります')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'メッセージの対象' }), {
      target: { value: 'visit_request_record_ready' },
    });

    expect(await screen.findByText('訪問依頼の確認事項です')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('薬局間連携メッセージ本文'), {
      target: { value: '  服薬状況を共有します  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /メッセージ送信/ }));

    await waitFor(() => {
      const messageCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) === '/api/pharmacy-cooperation-message-threads' &&
            init?.method === 'POST',
        );
      expect(messageCall).toBeTruthy();
      expect(messageCall?.[1]?.headers).toEqual(
        expect.objectContaining({
          'content-type': 'application/json',
          'x-org-id': 'org_1',
        }),
      );
      expect(JSON.parse(String(messageCall?.[1]?.body))).toEqual({
        share_case_id: 'share_case_active',
        visit_request_id: 'visit_request_record_ready',
        body: '服薬状況を共有します',
      });
    });
  });

  it('saves a partner visit record draft for an accepted visit request', async () => {
    renderContent();

    await screen.findAllByText('visit_request_record_ready');
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

  it('requires confirmation before submitting and confirming partner visit records', async () => {
    renderContent();

    const recordsTable = await screen.findByRole('table', { name: '協力訪問記録一覧' });
    const draftRow = within(recordsTable).getByText('partner_record_draft').closest('tr');
    const submittedRow = within(recordsTable).getByText('partner_record_submitted').closest('tr');
    expect(draftRow).toBeTruthy();
    expect(submittedRow).toBeTruthy();

    fireEvent.click(
      within(draftRow as HTMLTableRowElement).getByRole('button', {
        name: 'partner_record_draft 協力薬局 の協力訪問記録を提出',
      }),
    );
    expect(
      findFetchCall(
        (input, init) =>
          String(input) === '/api/partner-visit-records/partner_record_draft/submit' &&
          init?.method === 'POST',
      ),
    ).toBeUndefined();
    expect(screen.getByRole('heading', { name: '協力訪問記録を提出します' })).toBeTruthy();
    expect(screen.getByText('訪問記録: partner_record_draft')).toBeTruthy();
    expect(screen.getByText('版: rev.1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '提出する' }));

    await waitFor(() => {
      const submitCall = findFetchCall(
        (input, init) =>
          String(input) === '/api/partner-visit-records/partner_record_draft/submit' &&
          init?.method === 'POST',
      );
      expect(submitCall).toBeTruthy();
      expect(JSON.parse(String(submitCall?.[1]?.body))).toEqual({
        expected_updated_at: '2026-06-20T01:30:00.000Z',
      });
    });

    fireEvent.click(
      within(submittedRow as HTMLTableRowElement).getByRole('button', {
        name: 'partner_record_submitted 協力薬局 の協力訪問記録を確認',
      }),
    );
    const reviewCallsBeforeConfirm = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) =>
          String(input) === '/api/partner-visit-records/partner_record_submitted/review' &&
          init?.method === 'POST',
      );
    expect(reviewCallsBeforeConfirm).toHaveLength(0);
    expect(screen.getByRole('heading', { name: '協力訪問記録を確認します' })).toBeTruthy();
    expect(screen.getByText('訪問記録: partner_record_submitted')).toBeTruthy();
    expect(screen.getByText('医師向け報告書ドラフト: 作成しない')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確認する' }));

    await waitFor(() => {
      const confirmCall = findFetchCall(
        (input, init) =>
          String(input) === '/api/partner-visit-records/partner_record_submitted/review' &&
          init?.method === 'POST',
      );
      expect(confirmCall).toBeTruthy();
      expect(JSON.parse(String(confirmCall?.[1]?.body))).toMatchObject({
        decision: 'confirm',
        expected_updated_at: '2026-06-20T03:00:00.000Z',
        doctor_report_required: false,
      });
    });
  });

  it('requires confirmation before confirming a submitted partner record with a report draft flag', async () => {
    renderContent();

    const recordsTable = await screen.findByRole('table', { name: '協力訪問記録一覧' });
    const submittedRow = within(recordsTable).getByText('partner_record_submitted').closest('tr');
    expect(submittedRow).toBeTruthy();

    fireEvent.click(
      within(submittedRow as HTMLTableRowElement).getByRole('button', {
        name: 'partner_record_submitted 協力薬局 の協力訪問記録を確認して報告書ドラフトを作成',
      }),
    );
    expect(
      findFetchCall(
        (input, init) =>
          String(input) === '/api/partner-visit-records/partner_record_submitted/review' &&
          init?.method === 'POST',
      ),
    ).toBeUndefined();
    expect(
      screen.getByRole('heading', {
        name: '協力訪問記録を確認し報告書ドラフトを作成します',
      }),
    ).toBeTruthy();
    expect(screen.getByText('訪問記録: partner_record_submitted')).toBeTruthy();
    expect(screen.getByText('医師向け報告書ドラフト: 作成する')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確認+報告する' }));

    await waitFor(() => {
      const confirmCall = findFetchCall(
        (input, init) =>
          String(input) === '/api/partner-visit-records/partner_record_submitted/review' &&
          init?.method === 'POST',
      );
      expect(confirmCall).toBeTruthy();
      expect(JSON.parse(String(confirmCall?.[1]?.body))).toMatchObject({
        decision: 'confirm',
        expected_updated_at: '2026-06-20T03:00:00.000Z',
        doctor_report_required: true,
      });
    });
  });

  it('returns a submitted partner record with reason and creates a report draft for confirmed records', async () => {
    renderContent();

    const recordsTable = await screen.findByRole('table', { name: '協力訪問記録一覧' });
    const submittedRow = within(recordsTable).getByText('partner_record_submitted').closest('tr');
    const confirmedRow = within(recordsTable).getByText('partner_record_confirmed').closest('tr');
    expect(submittedRow).toBeTruthy();
    expect(confirmedRow).toBeTruthy();
    fireEvent.change(
      within(submittedRow as HTMLTableRowElement).getByLabelText(
        'partner_record_submitted の差戻し理由',
      ),
      {
        target: { value: '記録の確認が必要です' },
      },
    );
    fireEvent.click(
      within(submittedRow as HTMLTableRowElement).getByRole('button', {
        name: 'partner_record_submitted 協力薬局 の協力訪問記録を差戻し',
      }),
    );
    expect(
      findFetchCall(
        (input, init) =>
          String(input) === '/api/partner-visit-records/partner_record_submitted/review' &&
          init?.method === 'POST',
      ),
    ).toBeUndefined();
    expect(screen.getByRole('heading', { name: '協力訪問記録を差戻しします' })).toBeTruthy();
    expect(screen.getByText('訪問記録: partner_record_submitted')).toBeTruthy();
    expect(screen.getByText('協力薬局: 協力薬局')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '差戻しする' }));

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
        expected_updated_at: '2026-06-20T03:00:00.000Z',
        return_reason: '記録の確認が必要です',
      });
    });

    fireEvent.click(
      within(confirmedRow as HTMLTableRowElement).getByRole('button', {
        name: 'partner_record_confirmed 協力薬局 の報告書ドラフトを作成',
      }),
    );
    expect(
      findFetchCall(
        (input, init) =>
          String(input) ===
            '/api/partner-visit-records/partner_record_confirmed/physician-report-draft' &&
          init?.method === 'POST',
      ),
    ).toBeUndefined();
    expect(
      screen.getByRole('heading', { name: '医師向け報告書ドラフトを作成します' }),
    ).toBeTruthy();
    expect(screen.getByText('訪問記録: partner_record_confirmed')).toBeTruthy();
    expect(screen.getByText('現在の状態: 確認済み')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '報告書ドラフトを作成する' }));

    await waitFor(() => {
      const reportCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([input, init]) =>
            String(input) ===
              '/api/partner-visit-records/partner_record_confirmed/physician-report-draft' &&
            init?.method === 'POST',
        );
      expect(reportCall).toBeTruthy();
    });

    expect(await screen.findByTestId('pharmacy-cooperation-report-result')).toBeTruthy();
    expect(screen.getByRole('link', { name: /報告書を開く/ }).getAttribute('href')).toBe(
      '/reports/care_report_1',
    );
  });
});
