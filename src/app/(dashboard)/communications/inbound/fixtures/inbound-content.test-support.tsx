import { vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const clientLogWarnMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
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

import { InboundCommunicationsContent } from '../inbound-content';

setupDomTestEnv();

function buildInboxData() {
  return {
    data: {
      summary: {
        total_visible_count: 2,
        filtered_count: 2,
        needs_review_count: 2,
        reviewed_pending_action_count: 0,
        urgent_count: 1,
        channel_counts: { phone: 1, fax: 1, email: 0, mcs: 0, manual: 0 },
      },
      items: [
        {
          id: 'inbound_communication:event_1',
          title: '電話連絡を受信',
          summary: '他職種または関係者からの受信情報があります。内容は連絡履歴で確認してください。',
          channel: 'phone',
          status: 'needs_review',
          priority: 'high',
          patient_name: '佐藤花子',
          due_at: '2026-07-07T01:00:00.000Z',
          action_href: '/patients/patient_1/collaboration',
          action_label: '受信情報を確認',
        },
        {
          id: 'inbound_communication:event_2',
          title: 'FAX連絡を受信',
          summary: '他職種または関係者からの受信情報があります。内容は連絡履歴で確認してください。',
          channel: 'fax',
          status: 'needs_review',
          priority: 'urgent',
          patient_name: '高橋一郎',
          due_at: '2026-07-07T02:00:00.000Z',
          action_href: '/communications/requests',
          action_label: '受信情報を確認',
        },
      ],
      filters: { channel: null, status: 'needs_review', priority: null },
    },
    meta: {
      generated_at: '2026-07-07T03:00:00.000Z',
      limit: 50,
      count_basis: 'visible_window',
    },
  };
}

function buildSignalData() {
  return {
    data: {
      summary: {
        source_event_count: 2,
        events_with_signals_count: 2,
        signal_count: 3,
        urgent_count: 1,
        domain_counts: {
          medication_stock: 1,
          medication_safety: 1,
          schedule: 0,
          urgent: 1,
        },
      },
      items: [
        {
          candidate_key: 'inbound_signal:signal_1',
          inbound_event_id: 'event_1',
          signal_id: 'signal_1',
          channel: 'phone',
          occurred_at: '2026-07-07T01:00:00.000Z',
          patient_linked: true,
          case_linked: true,
          signal: {
            domain: 'medication_stock',
            type: 'observed_quantity',
            has_quantity: true,
            unit: '枚',
            quantity_effect: 'observed_absolute',
            source_confidence: 'text_parsed_high',
            review_status: 'needs_review',
            action_status: 'not_linked',
            evidence_code: 'remaining_quantity_expression',
            requires_pharmacist_review: true,
            stock_review: {
              action: 'stage_for_pharmacist_review',
              target_label: '残数レビュー',
              observation_kind: 'remaining_quantity',
              ledger_write_policy: 'never_direct_from_external',
              review_priority: 'medium',
              warning_codes: ['medication_identity_missing'],
              has_medication_identity: false,
              has_observed_quantity: true,
              has_usage_quantity: false,
              direct_ledger_write_allowed: false,
            },
          },
        },
        {
          candidate_key: 'inbound_signal:signal_2',
          inbound_event_id: 'event_2',
          signal_id: 'signal_2',
          channel: 'fax',
          occurred_at: '2026-07-07T02:00:00.000Z',
          patient_linked: false,
          case_linked: false,
          signal: {
            domain: 'urgent',
            type: 'urgent_review_required',
            has_quantity: false,
            unit: null,
            quantity_effect: null,
            source_confidence: 'text_parsed_low',
            review_status: 'needs_review',
            action_status: 'not_linked',
            evidence_code: 'urgent_expression',
            requires_pharmacist_review: true,
            stock_review: null,
          },
        },
      ],
      filters: { channel: null, domain: null, type: null },
    },
    meta: {
      generated_at: '2026-07-07T03:00:00.000Z',
      limit: 50,
      count_basis: 'visible_window',
      source: 'inbound_communication_event',
      classifier_version: 'inbound_signal_classifier_v1',
    },
  };
}

function buildDetailData() {
  return {
    data: {
      id: 'event_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      source_channel: 'phone',
      sender_role: 'nurse',
      sender_name: '訪問看護師A',
      sender_contact: '090-1234-5678',
      sender_organization_name: '訪問看護ステーションA',
      event_type: 'medication_stock_report',
      received_at: '2026-07-07T01:00:00.000Z',
      occurred_at: '2026-07-07T00:55:00.000Z',
      raw_text: '湿布は残り4枚です。storageKey=secret token=secret',
      normalized_summary: '外用薬の残数確認',
      attachment_count: 1,
      processing_status: 'signals_extracted',
    },
    meta: {
      generated_at: '2026-07-07T03:00:00.000Z',
      request_id: 'inbound_review:event_1',
      purpose: 'care_coordination',
      read_reason: 'review_inbound_detail',
      raw_text_included: true,
    },
  };
}

function buildMedicationStockData() {
  return {
    data: {
      patient_id: 'patient_1',
      summary: {
        total_item_count: 1,
        visible_item_count: 1,
        active_item_count: 1,
        urgent_count: 0,
        shortage_expected_count: 0,
        watch_count: 0,
        unknown_risk_count: 1,
        usage_unknown_count: 0,
        equivalence_review_count: 0,
        pending_external_observation_count: 0,
        last_observed_at: null,
      },
      items: [
        {
          id: 'stock_item_1',
          display_id: 'MS-001',
          patient_id: 'patient_1',
          case_id: 'case_1',
          display_name: '経皮鎮痛貼付剤',
          normalized_name: '経皮鎮痛貼付剤',
          ingredient_name: null,
          strength: null,
          dosage_form: '貼付剤',
          route: 'external',
          unit: '枚',
          source_type: 'manual',
          medication_category: 'topical',
          managing_party: 'pharmacy',
          equivalence_review_status: 'not_required',
          equivalence_confidence: null,
          active: true,
          snapshot_status: 'missing',
          snapshot: null,
        },
      ],
      recent_events: [],
    },
    meta: {
      generated_at: '2026-07-07T03:00:00.000Z',
      item_limit: 20,
      event_limit: 0,
      visible_count: 1,
      hidden_count: 0,
      count_basis: 'limited_items',
      partial_failures: [],
    },
  };
}

export function getInboundContentTestSupport() {
  return {
    buildDetailData,
    buildInboxData,
    buildMedicationStockData,
    buildSignalData,
    clientLogWarnMock,
    InboundCommunicationsContent,
    invalidateQueriesMock,
    mutateMock,
    toastErrorMock,
    toastSuccessMock,
    useMutationMock,
    useOrgIdMock,
    useQueryMock,
  };
}
