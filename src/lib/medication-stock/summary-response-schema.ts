import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
const nullableFiniteNumber = z.number().finite().nullable();
const offsetDateTime = z.string().datetime({ offset: true });
const riskLevelSchema = z.enum(['ok', 'watch', 'shortage_expected', 'urgent', 'unknown']);

const snapshotSchema = z
  .object({
    current_quantity: nullableFiniteNumber,
    last_observed_quantity: nullableFiniteNumber,
    last_observed_at: offsetDateTime.nullable(),
    estimated_daily_usage: nullableFiniteNumber,
    usage_confidence: nonEmptyText(100),
    estimated_stockout_date: offsetDateTime.nullable(),
    days_until_stockout: z.number().int().nullable(),
    stock_risk_level: riskLevelSchema,
    risk_reason_code: nullableText(200),
    calculated_at: offsetDateTime.nullable(),
  })
  .strict();

const stockItemSchema = z
  .object({
    id: nonEmptyText(200),
    display_id: nullableText(200),
    patient_id: nonEmptyText(200),
    case_id: nullableText(200),
    display_name: nonEmptyText(1_000),
    normalized_name: nullableText(1_000),
    ingredient_name: nullableText(1_000),
    strength: nullableText(500),
    dosage_form: nullableText(500),
    route: nullableText(500),
    unit: nonEmptyText(32),
    source_type: nonEmptyText(100),
    medication_category: nonEmptyText(100),
    managing_party: nonEmptyText(100),
    equivalence_review_status: z.enum(['not_required', 'needs_review', 'reviewed', 'uncertain']),
    equivalence_confidence: z
      .enum(['exact_code', 'ingredient_strength_form', 'ingredient_only', 'manual', 'uncertain'])
      .nullable(),
    active: z.boolean(),
    snapshot_status: z.enum(['available', 'missing', 'unit_mismatch']),
    snapshot: snapshotSchema.nullable(),
  })
  .strict();

const stockEventSchema = z
  .object({
    id: nonEmptyText(200),
    stock_item_id: nonEmptyText(200),
    event_type: nonEmptyText(100),
    event_at: offsetDateTime,
    recorded_at: offsetDateTime,
    quantity_kind: nonEmptyText(100),
    quantity_delta: nullableFiniteNumber,
    observed_quantity: nullableFiniteNumber,
    usage_quantity: nullableFiniteNumber,
    usage_period_days: z.number().int().nullable(),
    unit: nonEmptyText(32),
    source_entity_type: nonEmptyText(100),
    has_source_entity: z.boolean(),
  })
  .strict();

export function buildPatientMedicationStockSummaryResponseSchema(args: {
  patientId: string;
  itemLimit: number;
  eventLimit: number;
}) {
  return z
    .object({
      data: z
        .object({
          patient_id: z.literal(args.patientId),
          summary: z
            .object({
              total_item_count: z.number().int().nonnegative(),
              visible_item_count: z.number().int().nonnegative(),
              active_item_count: z.number().int().nonnegative(),
              urgent_count: z.number().int().nonnegative(),
              shortage_expected_count: z.number().int().nonnegative(),
              watch_count: z.number().int().nonnegative(),
              unknown_risk_count: z.number().int().nonnegative(),
              usage_unknown_count: z.number().int().nonnegative(),
              equivalence_review_count: z.number().int().nonnegative(),
              pending_external_observation_count: z.number().int().nonnegative(),
              last_observed_at: offsetDateTime.nullable(),
            })
            .strict(),
          items: z.array(stockItemSchema).max(args.itemLimit),
          recent_events: z.array(stockEventSchema).max(args.eventLimit),
        })
        .strict(),
      meta: z
        .object({
          generated_at: offsetDateTime,
          item_limit: z.literal(args.itemLimit),
          event_limit: z.literal(args.eventLimit),
          visible_count: z.number().int().nonnegative(),
          hidden_count: z.number().int().nonnegative(),
          count_basis: z.literal('limited_items'),
          partial_failures: z.tuple([]),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      const { summary, items, recent_events: events } = data;
      if (
        summary.visible_item_count !== items.length ||
        meta.visible_count !== items.length ||
        summary.total_item_count !== summary.active_item_count ||
        meta.hidden_count !== summary.total_item_count - items.length
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'summary'],
          message: 'Medication stock summary counts are inconsistent',
        });
      }

      const itemIds = new Set<string>();
      const displayIds = new Set<string>();
      const derived = {
        urgent_count: 0,
        shortage_expected_count: 0,
        watch_count: 0,
        unknown_risk_count: 0,
        usage_unknown_count: 0,
        equivalence_review_count: 0,
      };
      let lastObservedAt: string | null = null;
      for (const [index, item] of items.entries()) {
        if (item.patient_id !== args.patientId)
          context.addIssue({
            code: 'custom',
            path: ['data', 'items', index, 'patient_id'],
            message: 'Medication stock item belongs to another patient',
          });
        if (itemIds.has(item.id))
          context.addIssue({
            code: 'custom',
            path: ['data', 'items', index, 'id'],
            message: 'Duplicate medication stock item identity',
          });
        itemIds.add(item.id);
        if (item.display_id) {
          if (displayIds.has(item.display_id))
            context.addIssue({
              code: 'custom',
              path: ['data', 'items', index, 'display_id'],
              message: 'Duplicate medication stock display identity',
            });
          displayIds.add(item.display_id);
        }
        const usableSnapshot = item.snapshot_status === 'available' ? item.snapshot : null;
        const risk = usableSnapshot?.stock_risk_level ?? 'unknown';
        if (risk === 'urgent') derived.urgent_count += 1;
        if (risk === 'shortage_expected') derived.shortage_expected_count += 1;
        if (risk === 'watch') derived.watch_count += 1;
        if (risk === 'unknown') derived.unknown_risk_count += 1;
        if (usableSnapshot?.usage_confidence === 'unknown') derived.usage_unknown_count += 1;
        if (
          item.equivalence_review_status === 'needs_review' ||
          item.equivalence_review_status === 'uncertain'
        )
          derived.equivalence_review_count += 1;
        if (
          usableSnapshot?.last_observed_at &&
          (!lastObservedAt || usableSnapshot.last_observed_at > lastObservedAt)
        )
          lastObservedAt = usableSnapshot.last_observed_at;
      }
      for (const key of Object.keys(derived) as Array<keyof typeof derived>) {
        if (summary[key] !== derived[key])
          context.addIssue({
            code: 'custom',
            path: ['data', 'summary', key],
            message: 'Medication stock summary aggregate drift',
          });
      }
      if (summary.last_observed_at !== lastObservedAt)
        context.addIssue({
          code: 'custom',
          path: ['data', 'summary', 'last_observed_at'],
          message: 'Latest medication observation timestamp drift',
        });

      const eventIds = new Set<string>();
      let previousEventAt: string | null = null;
      for (const [index, event] of events.entries()) {
        if (!itemIds.has(event.stock_item_id))
          context.addIssue({
            code: 'custom',
            path: ['data', 'recent_events', index, 'stock_item_id'],
            message: 'Medication stock event references a hidden item',
          });
        if (eventIds.has(event.id))
          context.addIssue({
            code: 'custom',
            path: ['data', 'recent_events', index, 'id'],
            message: 'Duplicate medication stock event identity',
          });
        eventIds.add(event.id);
        if (previousEventAt && event.event_at > previousEventAt)
          context.addIssue({
            code: 'custom',
            path: ['data', 'recent_events', index, 'event_at'],
            message: 'Medication stock events are not newest first',
          });
        previousEventAt = event.event_at;
      }
    });
}
