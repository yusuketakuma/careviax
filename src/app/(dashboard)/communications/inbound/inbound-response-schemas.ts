import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(200);
const textSchema = z.string().max(10_000);
const nullableTextSchema = textSchema.nullable();
const timestampSchema = z.string().datetime({ offset: true });
const countSchema = z.number().int().nonnegative();
const channelSchema = z.enum(['phone', 'fax', 'email', 'mcs', 'manual']);
const prioritySchema = z.enum(['urgent', 'high', 'normal']);
const emptyFailuresSchema = z.tuple([]);

const internalHrefSchema = z
  .string()
  .startsWith('/')
  .refine((href) => !href.startsWith('//'))
  .refine((href) => !/(?:token|storage_?key|x-amz-|signature)=/i.test(href));

const metaTimestampSchema = z.object({ generated_at: timestampSchema }).strict();

export function buildInboundInboxResponseSchema(expected: {
  channel: string;
  priority: string;
  status: string;
  limit: number;
}) {
  const itemSchema = z
    .object({
      id: idSchema,
      title: z.string().trim().min(1).max(500),
      summary: z.string().max(2_000),
      channel: channelSchema,
      status: idSchema,
      priority: prioritySchema,
      patient_name: z.string().max(500).nullable(),
      due_at: timestampSchema.nullable(),
      action_href: internalHrefSchema,
      action_label: z.string().trim().min(1).max(200),
    })
    .strict();
  return z
    .object({
      data: z
        .object({
          summary: z
            .object({
              total_visible_count: countSchema,
              filtered_count: countSchema,
              needs_review_count: countSchema,
              reviewed_pending_action_count: countSchema,
              urgent_count: countSchema,
              channel_counts: z
                .object({
                  phone: countSchema,
                  fax: countSchema,
                  email: countSchema,
                  mcs: countSchema,
                  manual: countSchema,
                })
                .strict(),
            })
            .strict(),
          items: z.array(itemSchema).max(expected.limit),
          filters: z
            .object({
              channel: expected.channel ? z.literal(expected.channel) : z.null(),
              status: expected.status ? z.literal(expected.status) : z.null(),
              priority: expected.priority ? z.literal(expected.priority) : z.null(),
            })
            .strict(),
        })
        .strict(),
      meta: z
        .object({
          generated_at: timestampSchema,
          limit: z.literal(expected.limit),
          visible_count: countSchema,
          hidden_count: countSchema,
          count_basis: z.literal('visible_window'),
          partial_failures: emptyFailuresSchema,
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      const { summary, items } = data;
      const channelTotal = Object.values(summary.channel_counts).reduce(
        (sum, value) => sum + value,
        0,
      );
      if (
        summary.filtered_count !== items.length ||
        meta.visible_count !== items.length ||
        summary.total_visible_count !== meta.visible_count + meta.hidden_count ||
        channelTotal !== summary.total_visible_count ||
        summary.urgent_count > summary.total_visible_count ||
        summary.needs_review_count + summary.reviewed_pending_action_count >
          summary.total_visible_count
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'summary'],
          message: 'inbox counts mismatch',
        });
      }
      const ids = new Set<string>();
      items.forEach((item, index) => {
        if (ids.has(item.id))
          context.addIssue({
            code: 'custom',
            path: ['data', 'items', index, 'id'],
            message: 'duplicate inbox item',
          });
        ids.add(item.id);
        if (expected.channel && item.channel !== expected.channel)
          context.addIssue({
            code: 'custom',
            path: ['data', 'items', index, 'channel'],
            message: 'channel mismatch',
          });
        if (expected.priority && item.priority !== expected.priority)
          context.addIssue({
            code: 'custom',
            path: ['data', 'items', index, 'priority'],
            message: 'priority mismatch',
          });
        if (expected.status && item.status !== expected.status)
          context.addIssue({
            code: 'custom',
            path: ['data', 'items', index, 'status'],
            message: 'status mismatch',
          });
      });
    });
}

const signalDomainSchema = z.enum([
  'medication_stock',
  'medication_safety',
  'adherence',
  'symptom',
  'schedule',
  'report',
  'care_coordination',
  'urgent',
  'other',
]);
const signalTypeSchema = z.enum([
  'observed_quantity',
  'usage_delta',
  'usage_frequency',
  'low_stock_text',
  'out_of_stock_text',
  'refill_request',
  'side_effect_suspected',
  'medication_not_taken',
  'medication_overuse',
  'medication_lost',
  'storage_issue',
  'schedule_change_request',
  'visit_request',
  'urgent_review_required',
  'unknown',
]);

const stockReviewSchema = z
  .object({
    action: z.enum([
      'stage_for_pharmacist_review',
      'ignore_non_stock_signal',
      'reject_unsafe_payload',
    ]),
    target_label: z.string().trim().min(1).max(200),
    observation_kind: nullableTextSchema,
    ledger_write_policy: nullableTextSchema,
    review_priority: z.enum(['low', 'medium', 'high']).nullable(),
    warning_codes: z.array(z.string().trim().min(1).max(200)),
    has_medication_identity: z.boolean().nullable(),
    has_observed_quantity: z.boolean().nullable(),
    has_usage_quantity: z.boolean().nullable(),
    direct_ledger_write_allowed: z.literal(false),
  })
  .strict();

export function buildInboundSignalCandidatesResponseSchema(expected: {
  channel: string;
  limit: number;
}) {
  const itemSchema = z
    .object({
      candidate_key: idSchema,
      inbound_event_id: idSchema,
      signal_id: idSchema,
      channel: channelSchema,
      occurred_at: timestampSchema,
      patient_linked: z.boolean(),
      case_linked: z.boolean(),
      signal: z
        .object({
          domain: signalDomainSchema,
          type: signalTypeSchema,
          has_quantity: z.boolean(),
          unit: nullableTextSchema,
          quantity_effect: nullableTextSchema,
          source_confidence: idSchema,
          review_status: idSchema,
          action_status: idSchema,
          evidence_code: idSchema,
          requires_pharmacist_review: z.boolean(),
          stock_review: stockReviewSchema.nullable(),
        })
        .strict(),
    })
    .strict();
  return z
    .object({
      data: z
        .object({
          summary: z
            .object({
              source_event_count: countSchema,
              events_with_signals_count: countSchema,
              signal_count: countSchema,
              urgent_count: countSchema,
              domain_counts: z
                .object({
                  medication_stock: countSchema,
                  medication_safety: countSchema,
                  schedule: countSchema,
                  urgent: countSchema,
                })
                .strict(),
            })
            .strict(),
          items: z.array(itemSchema).max(expected.limit),
          filters: z
            .object({
              channel: expected.channel ? z.literal(expected.channel) : z.null(),
              domain: z.string().nullable(),
              type: z.string().nullable(),
            })
            .strict(),
        })
        .strict(),
      meta: z
        .object({
          generated_at: timestampSchema,
          limit: z.literal(expected.limit),
          visible_count: countSchema,
          hidden_count: countSchema,
          count_basis: z.literal('visible_window'),
          partial_failures: emptyFailuresSchema,
          source: z.literal('inbound_communication_event'),
          classifier_version: idSchema,
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      const { items, summary } = data;
      const eventCount = new Set(items.map((item) => item.inbound_event_id)).size;
      const derivedDomains = Object.fromEntries(
        Object.keys(summary.domain_counts).map((key) => [key, 0]),
      ) as Record<string, number>;
      items.forEach((item, index) => {
        derivedDomains[item.signal.domain] = (derivedDomains[item.signal.domain] ?? 0) + 1;
        if (item.candidate_key !== `inbound_signal:${item.signal_id}`)
          context.addIssue({
            code: 'custom',
            path: ['data', 'items', index, 'candidate_key'],
            message: 'candidate identity mismatch',
          });
        if (expected.channel && item.channel !== expected.channel)
          context.addIssue({
            code: 'custom',
            path: ['data', 'items', index, 'channel'],
            message: 'channel mismatch',
          });
        if ((item.signal.domain === 'medication_stock') !== (item.signal.stock_review !== null))
          context.addIssue({
            code: 'custom',
            path: ['data', 'items', index, 'signal', 'stock_review'],
            message: 'stock review mismatch',
          });
      });
      if (
        summary.signal_count !== items.length ||
        summary.events_with_signals_count !== eventCount ||
        summary.events_with_signals_count > summary.source_event_count ||
        summary.urgent_count !== derivedDomains.urgent ||
        meta.visible_count !== items.length ||
        Object.entries(summary.domain_counts).some(([key, value]) => derivedDomains[key] !== value)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'summary'],
          message: 'signal counts mismatch',
        });
      }
    });
}

export function buildInboundCreateResponseSchema(expected: {
  channel: 'fax' | 'email' | 'manual';
  eventType: string;
}) {
  return z
    .object({
      data: z
        .object({
          id: idSchema,
          channel: z.literal(expected.channel),
          event_type: z.literal(expected.eventType),
          status: z.literal('needs_review'),
          action_href: internalHrefSchema,
        })
        .strict(),
      meta: metaTimestampSchema,
    })
    .strict();
}

export const inboundSignalTaskResponseSchema = z
  .object({
    data: z
      .object({
        task_id: idSchema,
        task_type: idSchema,
        status: z.literal('pending'),
        action_href: internalHrefSchema,
      })
      .strict(),
    meta: metaTimestampSchema,
  })
  .strict();

export function buildInboundSignalReviewResponseSchema(expectedSignalId: string) {
  return z
    .object({
      data: z
        .object({
          signal_id: z.literal(expectedSignalId),
          inbound_event_id: idSchema,
          review_status: idSchema,
          action_status: idSchema,
          reviewed_at: timestampSchema.nullable(),
          review_task_closure_count: countSchema.optional(),
        })
        .strict(),
      meta: metaTimestampSchema,
    })
    .strict();
}

export function buildInboundDetailResponseSchema(expected: { eventId: string; requestId: string }) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(expected.eventId),
          patient_id: idSchema.nullable(),
          case_id: idSchema.nullable(),
          source_channel: idSchema,
          sender_role: idSchema,
          sender_name: nullableTextSchema,
          sender_contact: nullableTextSchema,
          sender_organization_name: nullableTextSchema,
          event_type: idSchema,
          received_at: timestampSchema,
          occurred_at: timestampSchema.nullable(),
          raw_text: textSchema,
          normalized_summary: nullableTextSchema,
          attachment_count: countSchema,
          processing_status: idSchema,
        })
        .strict(),
      meta: z
        .object({
          generated_at: timestampSchema,
          request_id: z.literal(expected.requestId),
          purpose: z.literal('care_coordination'),
          read_reason: z.literal('review_inbound_detail'),
          raw_text_included: z.literal(true),
        })
        .strict(),
    })
    .strict();
}

export function buildInboundStockApplyResponseSchema(expected: {
  signalId: string;
  stockItemId: string;
}) {
  return z
    .object({
      data: z
        .object({
          signal_id: z.literal(expected.signalId),
          inbound_event_id: idSchema,
          stock_item_id: z.literal(expected.stockItemId),
          stock_event_id: idSchema,
          external_observation_id: idSchema.nullable(),
          review_status: idSchema,
          action_status: idSchema,
          review_task_closure_count: countSchema,
          idempotent_replay: z.boolean(),
        })
        .strict(),
      meta: metaTimestampSchema,
    })
    .strict();
}

export function buildInboundSourceMappingResponseSchema(expected: {
  eventId: string;
  patientId: string;
  caseId?: string;
  confidence: 'exact' | 'probable' | 'manual' | 'unknown';
  mappingStatus: 'active' | 'needs_review' | 'inactive';
}) {
  return z
    .object({
      data: z
        .object({
          mapping_id: idSchema,
          inbound_event_id: z.literal(expected.eventId),
          patient_id: z.literal(expected.patientId),
          case_id: expected.caseId ? z.literal(expected.caseId) : z.null(),
          source_system: idSchema,
          mapping_status: z.literal(expected.mappingStatus),
          confidence: z.literal(expected.confidence),
          created_at: timestampSchema,
          reviewed_at: timestampSchema.nullable(),
        })
        .strict(),
      meta: metaTimestampSchema,
    })
    .strict();
}
