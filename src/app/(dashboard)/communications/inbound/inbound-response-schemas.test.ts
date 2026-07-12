import { describe, expect, it } from 'vitest';

import {
  buildInboundCreateResponseSchema,
  buildInboundDetailResponseSchema,
  buildInboundInboxResponseSchema,
  buildInboundSignalCandidatesResponseSchema,
  buildInboundSignalReviewResponseSchema,
  buildInboundSourceMappingResponseSchema,
  buildInboundStockApplyResponseSchema,
  inboundSignalTaskResponseSchema,
} from './inbound-response-schemas';

const generatedAt = '2026-07-13T00:00:00.000Z';

function inboxPayload() {
  return {
    data: {
      summary: {
        total_visible_count: 1,
        filtered_count: 1,
        needs_review_count: 1,
        reviewed_pending_action_count: 0,
        urgent_count: 0,
        channel_counts: { phone: 1, fax: 0, email: 0, mcs: 0, manual: 0 },
      },
      items: [
        {
          id: 'inbound_communication:event_1',
          title: '電話連絡を受信',
          summary: '確認が必要です',
          channel: 'phone',
          status: 'needs_review',
          priority: 'high',
          patient_name: '患者A',
          due_at: null,
          action_href: '/communications/inbound',
          action_label: '確認',
        },
      ],
      filters: { channel: 'phone', status: 'needs_review', priority: null },
    },
    meta: {
      generated_at: generatedAt,
      limit: 50,
      visible_count: 1,
      hidden_count: 0,
      count_basis: 'visible_window',
      partial_failures: [],
    },
  };
}

function signalPayload() {
  return {
    data: {
      summary: {
        source_event_count: 1,
        events_with_signals_count: 1,
        signal_count: 1,
        urgent_count: 0,
        domain_counts: { medication_stock: 1, medication_safety: 0, schedule: 0, urgent: 0 },
      },
      items: [
        {
          candidate_key: 'inbound_signal:signal_1',
          inbound_event_id: 'event_1',
          signal_id: 'signal_1',
          channel: 'phone',
          occurred_at: generatedAt,
          patient_linked: true,
          case_linked: true,
          signal: {
            domain: 'medication_stock',
            type: 'observed_quantity',
            has_quantity: true,
            unit: 'tablet',
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
              warning_codes: [],
              has_medication_identity: true,
              has_observed_quantity: true,
              has_usage_quantity: false,
              direct_ledger_write_allowed: false,
            },
          },
        },
      ],
      filters: { channel: 'phone', domain: null, type: null },
    },
    meta: {
      generated_at: generatedAt,
      limit: 50,
      visible_count: 1,
      hidden_count: 0,
      count_basis: 'visible_window',
      partial_failures: [],
      source: 'inbound_communication_event',
      classifier_version: 'inbound_signal_classifier_v1',
    },
  };
}

describe('inbound response schemas', () => {
  it('accepts a request-matched inbox and rejects count or filter drift', () => {
    const schema = buildInboundInboxResponseSchema({
      channel: 'phone',
      priority: '',
      status: 'needs_review',
      limit: 50,
    });
    expect(schema.safeParse(inboxPayload()).success).toBe(true);
    expect(
      schema.safeParse({
        ...inboxPayload(),
        data: {
          ...inboxPayload().data,
          summary: { ...inboxPayload().data.summary, filtered_count: 2 },
        },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...inboxPayload(),
        data: {
          ...inboxPayload().data,
          filters: { ...inboxPayload().data.filters, channel: 'fax' },
        },
      }).success,
    ).toBe(false);
  });

  it('accepts signal candidates and rejects cross-candidate identity or aggregate drift', () => {
    const schema = buildInboundSignalCandidatesResponseSchema({ channel: 'phone', limit: 50 });
    expect(schema.safeParse(signalPayload()).success).toBe(true);
    const payload = signalPayload();
    payload.data.items[0]!.candidate_key = 'inbound_signal:signal_other';
    expect(schema.safeParse(payload).success).toBe(false);
    const countDrift = signalPayload();
    countDrift.data.summary.signal_count = 2;
    expect(schema.safeParse(countDrift).success).toBe(false);
  });

  it('requires audited detail identity and audit metadata to match the request', () => {
    const schema = buildInboundDetailResponseSchema({
      eventId: 'event_1',
      requestId: 'inbound_review:event_1',
    });
    const payload = {
      data: {
        id: 'event_1',
        patient_id: 'patient_1',
        case_id: null,
        source_channel: 'phone',
        sender_role: 'nurse',
        sender_name: '看護師A',
        sender_contact: null,
        sender_organization_name: null,
        event_type: 'general_note',
        received_at: generatedAt,
        occurred_at: null,
        raw_text: '確認内容',
        normalized_summary: null,
        attachment_count: 0,
        processing_status: 'unprocessed',
      },
      meta: {
        generated_at: generatedAt,
        request_id: 'inbound_review:event_1',
        purpose: 'care_coordination',
        read_reason: 'review_inbound_detail',
        raw_text_included: true,
      },
    };
    expect(schema.safeParse(payload).success).toBe(true);
    expect(
      schema.safeParse({ ...payload, data: { ...payload.data, id: 'event_other' } }).success,
    ).toBe(false);
  });

  it('binds mutation responses to requested identities and live outcome shapes', () => {
    expect(
      buildInboundCreateResponseSchema({ channel: 'fax', eventType: 'general_note' }).safeParse({
        data: {
          id: 'event_1',
          channel: 'fax',
          event_type: 'general_note',
          status: 'needs_review',
          action_href: '/communications/inbound',
        },
        meta: { generated_at: generatedAt },
      }).success,
    ).toBe(true);
    expect(
      inboundSignalTaskResponseSchema.safeParse({
        data: {
          task_id: 'task_1',
          task_type: 'pharmacist_review',
          status: 'pending',
          action_href: '/tasks',
        },
        meta: { generated_at: generatedAt },
      }).success,
    ).toBe(true);
    expect(
      buildInboundSignalReviewResponseSchema('signal_1').safeParse({
        data: {
          signal_id: 'signal_other',
          inbound_event_id: 'event_1',
          review_status: 'accepted',
          action_status: 'not_linked',
          reviewed_at: generatedAt,
          review_task_closure_count: 1,
        },
        meta: { generated_at: generatedAt },
      }).success,
    ).toBe(false);
    expect(
      buildInboundStockApplyResponseSchema({
        signalId: 'signal_1',
        stockItemId: 'stock_1',
      }).safeParse({
        data: {
          signal_id: 'signal_1',
          inbound_event_id: 'event_1',
          stock_item_id: 'stock_other',
          stock_event_id: 'stock_event_1',
          external_observation_id: null,
          review_status: 'accepted',
          action_status: 'linked_to_stock_event',
          review_task_closure_count: 1,
          idempotent_replay: false,
        },
        meta: { generated_at: generatedAt },
      }).success,
    ).toBe(false);
    expect(
      buildInboundSourceMappingResponseSchema({
        eventId: 'event_1',
        patientId: 'patient_1',
        confidence: 'manual',
        mappingStatus: 'active',
      }).safeParse({
        data: {
          mapping_id: 'mapping_1',
          inbound_event_id: 'event_1',
          patient_id: 'patient_other',
          case_id: null,
          source_system: 'manual',
          mapping_status: 'active',
          confidence: 'manual',
          created_at: generatedAt,
          reviewed_at: generatedAt,
        },
        meta: { generated_at: generatedAt },
      }).success,
    ).toBe(false);
  });
});
