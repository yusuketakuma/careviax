import { z } from 'zod';
import {
  drugMasterImportRunStatusSchema,
  drugMasterImportSourceSchema,
} from '@/types/drug-master-import-status';

const apiDateSchema = z.union([z.string().date(), z.string().datetime()]);
const nullableApiNumberSchema = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value) => Number(value))
  .pipe(z.number().finite().nonnegative())
  .nullable();

export const drugMasterImportLogSchema = z
  .object({
    id: z.string().trim().min(1),
    source: drugMasterImportSourceSchema,
    imported_at: z.string().datetime(),
    record_count: z.number().int().nonnegative(),
    status: drugMasterImportRunStatusSchema,
    error_log: z.string().nullable(),
    source_url: z.string().trim().min(1).nullable(),
    source_file_hash: z.string().trim().min(1).nullable(),
    source_published_at: z.string().datetime().nullable(),
    import_mode: z.string().trim().min(1).nullable(),
    change_summary: z.unknown().nullable(),
  })
  .strip();

export const drugMasterImportLogsResponseSchema = z
  .object({ data: z.array(drugMasterImportLogSchema) })
  .strict()
  .superRefine((payload, context) => {
    const ids = new Set<string>();
    for (const [index, log] of payload.data.entries()) {
      if (ids.has(log.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate drug master import log id',
        });
      }
      ids.add(log.id);
    }
  });

export type DrugMasterImportLog = z.infer<typeof drugMasterImportLogSchema>;

export const pharmacySiteReferenceSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    address: z.string().trim().min(1),
  })
  .strip();

export const pharmacySiteReferencesResponseSchema = z
  .object({ data: z.array(pharmacySiteReferenceSchema) })
  .strict()
  .superRefine((payload, context) => {
    const ids = new Set<string>();
    for (const [index, site] of payload.data.entries()) {
      if (ids.has(site.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate pharmacy site id',
        });
      }
      ids.add(site.id);
    }
  });

export const formularyTemplateItemSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    item_count: z.number().int().nonnegative(),
  })
  .strip();

export const formularyTemplateListResponseSchema = z
  .object({ data: z.array(formularyTemplateItemSchema) })
  .strict()
  .superRefine((payload, context) => {
    const ids = new Set<string>();
    for (const [index, template] of payload.data.entries()) {
      if (ids.has(template.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate formulary template id',
        });
      }
      ids.add(template.id);
    }
  });

export const impactQueueKeySchema = z.enum([
  'action_required',
  'recently_changed',
  'transitional_expiry',
  'missing_reorder_point',
  'safety_flagged',
  'high_risk',
  'lasa_risk',
  'controlled',
  'review_due',
]);

const impactDrugSchema = z
  .object({
    id: z.string().trim().min(1),
    yj_code: z.string().trim().min(1),
    drug_name: z.string().trim().min(1),
    generic_name: z.string().nullable(),
    drug_price: nullableApiNumberSchema,
    unit: z.string().nullable(),
    is_generic: z.boolean(),
    is_narcotic: z.boolean(),
    is_psychotropic: z.boolean(),
    is_high_risk: z.boolean(),
    is_lasa_risk: z.boolean(),
    transitional_expiry_date: apiDateSchema.nullable(),
  })
  .strip();

export const formularyImpactStockSchema = z
  .object({
    id: z.string().trim().min(1),
    drug_master_id: z.string().trim().min(1),
    reorder_point: z.number().int().nonnegative().nullable(),
    last_reviewed_at: z.string().datetime().nullable(),
    follow_up_status: z.string().nullable(),
    follow_up_reason: z.string().nullable(),
    follow_up_due_date: apiDateSchema.nullable(),
    follow_up_resolved_at: z.string().datetime().nullable(),
    updated_at: z.string().datetime(),
    drug_master: impactDrugSchema,
  })
  .strip()
  .superRefine((stock, context) => {
    if (stock.drug_master_id !== stock.drug_master.id) {
      context.addIssue({
        code: 'custom',
        path: ['drug_master_id'],
        message: 'Impact stock drug identity mismatch',
      });
    }
  });

export const formularyRecentChangeSchema = z
  .object({
    id: z.string().trim().min(1),
    yj_code: z.string().trim().min(1),
    change_type: z.string().trim().min(1),
    previous_value: z.unknown(),
    current_value: z.unknown(),
    created_at: z.string().datetime(),
  })
  .strip();

const impactTotalsSchema = z
  .object({
    stocked_count: z.number().int().nonnegative(),
    review_due_count: z.number().int().nonnegative(),
    missing_reorder_point_count: z.number().int().nonnegative(),
    safety_flagged_count: z.number().int().nonnegative(),
    high_risk_count: z.number().int().nonnegative(),
    lasa_risk_count: z.number().int().nonnegative(),
    controlled_count: z.number().int().nonnegative(),
    transitional_expiry_count: z.number().int().nonnegative(),
    transitional_expiry_within_30_count: z.number().int().nonnegative(),
    transitional_expiry_within_60_count: z.number().int().nonnegative(),
    transitional_expiry_within_90_count: z.number().int().nonnegative(),
    action_required_count: z.number().int().nonnegative(),
    recent_master_change_count: z.number().int().nonnegative(),
  })
  .strict();

const masterChangeReportSchema = z
  .object({
    cutoff: z.string().datetime(),
    total_count: z.number().int().nonnegative(),
    sampled_count: z.number().int().nonnegative(),
    is_truncated: z.boolean(),
    change_type_counts: z.array(
      z
        .object({
          change_type: z.string().trim().min(1),
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    rows: z.array(
      z
        .object({
          stock: formularyImpactStockSchema,
          changes: z.array(formularyRecentChangeSchema),
        })
        .strict(),
    ),
    price_impact: z
      .object({
        usage_window_days: z.number().int().positive(),
        scanned_draft_count: z.number().int().nonnegative(),
        estimated_total_delta: z.number().finite(),
        rows: z.array(
          z
            .object({
              stock: formularyImpactStockSchema,
              previous_price: nullableApiNumberSchema,
              current_price: nullableApiNumberSchema,
              unit_price_delta: z.number().finite().nullable(),
              usage_count: z.number().int().nonnegative(),
              estimated_total_delta: z.number().finite().nullable(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.sampled_count !== report.rows.length ||
      report.sampled_count > report.total_count ||
      report.is_truncated !== report.total_count > report.sampled_count
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sampled_count'],
        message: 'Master-change report counts are inconsistent',
      });
    }
  });

const impactSamplesSchema = z.object({
  review_due: z.array(formularyImpactStockSchema),
  missing_reorder_point: z.array(formularyImpactStockSchema),
  safety_flagged: z.array(formularyImpactStockSchema),
  high_risk: z.array(formularyImpactStockSchema),
  lasa_risk: z.array(formularyImpactStockSchema),
  controlled: z.array(formularyImpactStockSchema),
  transitional_expiry: z.array(formularyImpactStockSchema),
  action_required: z.array(formularyImpactStockSchema),
  recently_changed: z.array(formularyImpactStockSchema),
});

const formularyImpactDataSchema = z
  .object({
    site: z.object({ id: z.string().min(1), name: z.string().min(1) }).strip(),
    checked_at: z.string().datetime(),
    thresholds: z
      .object({
        expiry_within_days: z.number().int().positive(),
        review_overdue_days: z.number().int().positive(),
        price_impact_days: z.number().int().positive(),
        price_impact_draft_limit: z.number().int().positive(),
      })
      .strict(),
    selected_queue: z
      .object({
        key: impactQueueKeySchema,
        rows: z.array(formularyImpactStockSchema),
        total_count: z.number().int().nonnegative(),
      })
      .strict(),
    totals: impactTotalsSchema,
    master_change_report: masterChangeReportSchema.optional(),
    follow_up_summary: z
      .object({
        unresolved_count: z.number().int().nonnegative(),
        overdue_count: z.number().int().nonnegative(),
        missing_due_date_count: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    recent_changes: z.array(formularyRecentChangeSchema),
    samples: impactSamplesSchema.strict(),
  })
  .strip()
  .superRefine((impact, context) => {
    const totals = impact.totals;
    if (
      totals.transitional_expiry_within_30_count > totals.transitional_expiry_within_60_count ||
      totals.transitional_expiry_within_60_count > totals.transitional_expiry_within_90_count ||
      totals.transitional_expiry_within_90_count > totals.transitional_expiry_count
    ) {
      context.addIssue({
        code: 'custom',
        path: ['totals', 'transitional_expiry_within_30_count'],
        message: 'Transitional expiry buckets are inconsistent',
      });
    }
    const totalByQueue = {
      action_required: totals.action_required_count,
      recently_changed: totals.recent_master_change_count,
      transitional_expiry: totals.transitional_expiry_count,
      missing_reorder_point: totals.missing_reorder_point_count,
      safety_flagged: totals.safety_flagged_count,
      high_risk: totals.high_risk_count,
      lasa_risk: totals.lasa_risk_count,
      controlled: totals.controlled_count,
      review_due: totals.review_due_count,
    } satisfies Record<z.infer<typeof impactQueueKeySchema>, number>;
    if (
      impact.selected_queue.rows.length > impact.selected_queue.total_count ||
      impact.selected_queue.total_count !== totalByQueue[impact.selected_queue.key]
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selected_queue', 'total_count'],
        message: 'Selected impact queue count is inconsistent',
      });
    }
    if (
      impact.follow_up_summary &&
      (impact.follow_up_summary.overdue_count > impact.follow_up_summary.unresolved_count ||
        impact.follow_up_summary.missing_due_date_count > impact.follow_up_summary.unresolved_count)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['follow_up_summary'],
        message: 'Follow-up summary counts are inconsistent',
      });
    }
  });

export const formularyImpactResponseSchema = z
  .object({ data: formularyImpactDataSchema })
  .strict()
  .transform(({ data }) => ({
    siteId: data.site.id,
    data: {
      recent_changes: data.recent_changes,
      totals: data.totals,
      selected_queue: data.selected_queue,
      ...(data.master_change_report ? { master_change_report: data.master_change_report } : {}),
      ...(data.follow_up_summary ? { follow_up_summary: data.follow_up_summary } : {}),
      samples: data.samples,
    },
  }));

const mismatchDrugSchema = z
  .object({
    id: z.string().trim().min(1),
    yj_code: z.string().trim().min(1),
    drug_name: z.string().trim().min(1),
    generic_name: z.string().nullable(),
    drug_price: nullableApiNumberSchema,
    unit: z.string().nullable(),
    is_generic: z.boolean(),
  })
  .strip();

const usageMismatchListCountSchema = z
  .object({
    total_count: z.number().int().nonnegative(),
    visible_count: z.number().int().nonnegative(),
    hidden_count: z.number().int().nonnegative(),
    truncated: z.boolean(),
    count_basis: z.string().trim().min(1),
    sort_basis: z.string().trim().min(1),
  })
  .strict()
  .superRefine((counts, context) => {
    if (
      counts.total_count !== counts.visible_count + counts.hidden_count ||
      counts.truncated !== counts.hidden_count > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['total_count'],
        message: 'Usage-mismatch list counts are inconsistent',
      });
    }
  });

const frequentUnstockedSchema = z
  .object({
    drug_code: z.string().nullable(),
    drug_name: z.string().nullable(),
    count: z.number().int().positive(),
    last_seen_at: z.string().datetime(),
    matched_drug: mismatchDrugSchema.nullable(),
  })
  .strip()
  .superRefine((row, context) => {
    if (!row.drug_code?.trim() && !row.drug_name?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['drug_name'],
        message: 'Usage mismatch row requires a drug code or name',
      });
    }
  });

const unusedStockSchema = z
  .object({
    id: z.string().trim().min(1),
    drug_master_id: z.string().trim().min(1),
    reorder_point: z.number().int().nonnegative().nullable(),
    updated_at: z.string().datetime(),
    drug_master: mismatchDrugSchema,
  })
  .strip()
  .superRefine((stock, context) => {
    if (stock.drug_master_id !== stock.drug_master.id) {
      context.addIssue({
        code: 'custom',
        path: ['drug_master_id'],
        message: 'Unused stock drug identity mismatch',
      });
    }
  });

const unmatchedPrescriptionSchema = z
  .object({
    drug_code: z.string().nullable(),
    drug_name: z.string().nullable(),
    count: z.number().int().positive(),
    last_seen_at: z.string().datetime(),
  })
  .strip();

const usageMismatchTotalsSchema = z
  .object({
    scanned_draft_count: z.number().int().nonnegative(),
    used_drug_count: z.number().int().nonnegative(),
    medication_line_count: z.number().int().nonnegative(),
    matched_drug_count: z.number().int().nonnegative(),
    unmatched_drug_count: z.number().int().nonnegative(),
    stocked_count: z.number().int().nonnegative(),
    frequent_unstocked_count: z.number().int().nonnegative(),
    unused_stocked_count: z.number().int().nonnegative(),
    possibly_used_stocked_count: z.number().int().nonnegative(),
    displayed_frequent_unstocked_count: z.number().int().nonnegative(),
    displayed_unused_stocked_count: z.number().int().nonnegative(),
    displayed_possibly_used_stocked_count: z.number().int().nonnegative(),
  })
  .strict();

const usageMismatchDataSchema = z
  .object({
    site: z.object({ id: z.string().min(1), name: z.string().min(1) }).strip(),
    checked_at: z.string().datetime(),
    period: z.object({ since: z.string().datetime(), until: z.string().datetime() }).strict(),
    thresholds: z
      .object({
        days: z.number().int().positive(),
        frequent_threshold: z.number().int().positive(),
        draft_limit: z.number().int().positive(),
        limit: z.number().int().positive(),
      })
      .strict(),
    totals: usageMismatchTotalsSchema,
    list_counts: z
      .object({
        frequent_unstocked: usageMismatchListCountSchema,
        unused_stocked: usageMismatchListCountSchema,
        possibly_used_stocked: usageMismatchListCountSchema,
        unmatched_prescribed: usageMismatchListCountSchema,
      })
      .strict(),
    frequent_unstocked: z.array(frequentUnstockedSchema),
    unused_stocked: z.array(unusedStockSchema),
    possibly_used_stocked: z.array(z.unknown()),
    unmatched_prescribed: z.array(unmatchedPrescriptionSchema),
  })
  .strip()
  .superRefine((mismatch, context) => {
    const totals = mismatch.totals;
    if (new Date(mismatch.period.since).getTime() > new Date(mismatch.period.until).getTime()) {
      context.addIssue({
        code: 'custom',
        path: ['period'],
        message: 'Usage-mismatch period is reversed',
      });
    }
    if (
      totals.matched_drug_count + totals.unmatched_drug_count !== totals.used_drug_count ||
      totals.medication_line_count < totals.used_drug_count ||
      totals.displayed_frequent_unstocked_count !== mismatch.frequent_unstocked.length ||
      totals.displayed_unused_stocked_count !== mismatch.unused_stocked.length ||
      totals.displayed_possibly_used_stocked_count !== mismatch.possibly_used_stocked.length ||
      totals.frequent_unstocked_count < mismatch.frequent_unstocked.length ||
      totals.unused_stocked_count < mismatch.unused_stocked.length ||
      totals.unmatched_drug_count < mismatch.unmatched_prescribed.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['totals'],
        message: 'Usage-mismatch totals disagree with returned rows',
      });
    }
    const listPairs = [
      ['frequent_unstocked', mismatch.frequent_unstocked.length],
      ['unused_stocked', mismatch.unused_stocked.length],
      ['possibly_used_stocked', mismatch.possibly_used_stocked.length],
      ['unmatched_prescribed', mismatch.unmatched_prescribed.length],
    ] as const;
    for (const [key, visibleLength] of listPairs) {
      if (mismatch.list_counts[key].visible_count !== visibleLength) {
        context.addIssue({
          code: 'custom',
          path: ['list_counts', key, 'visible_count'],
          message: 'Usage-mismatch visible count disagrees with returned rows',
        });
      }
    }
  });

export const formularyUsageMismatchResponseSchema = z
  .object({ data: usageMismatchDataSchema })
  .strict()
  .transform(({ data }) => ({
    siteId: data.site.id,
    data: {
      period: data.period,
      thresholds: data.thresholds,
      totals: {
        scanned_draft_count: data.totals.scanned_draft_count,
        used_drug_count: data.totals.used_drug_count,
        medication_line_count: data.totals.medication_line_count,
        matched_drug_count: data.totals.matched_drug_count,
        unmatched_drug_count: data.totals.unmatched_drug_count,
        stocked_count: data.totals.stocked_count,
        frequent_unstocked_count: data.totals.frequent_unstocked_count,
        unused_stocked_count: data.totals.unused_stocked_count,
        displayed_frequent_unstocked_count: data.totals.displayed_frequent_unstocked_count,
        displayed_unused_stocked_count: data.totals.displayed_unused_stocked_count,
      },
      frequent_unstocked: data.frequent_unstocked,
      unused_stocked: data.unused_stocked,
      unmatched_prescribed: data.unmatched_prescribed,
    },
  }));

const drugIdentitySchema = z.object({
  id: z.string().trim().min(1),
  yj_code: z.string().trim().min(1),
  drug_name: z.string().trim().min(1),
});

export const genericCandidateSchema = drugIdentitySchema.strip();

export const genericCandidatePageSchema = z
  .object({
    data: z.array(genericCandidateSchema),
    meta: z
      .object({
        has_more: z.boolean(),
        next_cursor: z.string().trim().min(1).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.meta.has_more !== Boolean(page.meta.next_cursor)) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'next_cursor'],
        message: 'Candidate cursor must match has_more',
      });
    }
  })
  .transform(({ data, meta }) => ({
    data,
    hasMore: meta.has_more,
    ...(meta.next_cursor ? { nextCursor: meta.next_cursor } : {}),
  }));

const packageInsertSchema = z
  .object({
    id: z.string().trim().min(1),
    contraindications: z.unknown(),
    interactions: z.unknown(),
    adverse_effects: z.unknown(),
    dosage_adjustment_renal: z.unknown(),
    precautions_elderly: z.unknown(),
    document_version: z.string().nullable(),
    revised_at: apiDateSchema.nullable(),
  })
  .strip();

const relatedDrugSchema = drugIdentitySchema.strict();
const interactionBaseFields = {
  id: z.string().trim().min(1),
  severity: z.enum(['contraindicated', 'caution', 'minor']),
  mechanism: z.string().nullable(),
  clinical_effect: z.string().nullable(),
  source: z.enum(['pmda_xml', 'kegg', 'manual']),
};

const interactionAsASchema = z
  .object({ ...interactionBaseFields, drug_b: relatedDrugSchema })
  .strip();
const interactionAsBSchema = z
  .object({ ...interactionBaseFields, drug_a: relatedDrugSchema })
  .strip();

export const drugMasterDetailSchema = z
  .object({
    ...drugIdentitySchema.shape,
    receipt_code: z.string().nullable(),
    jan_code: z.string().nullable(),
    drug_name_kana: z.string().nullable(),
    generic_name: z.string().nullable(),
    drug_price: nullableApiNumberSchema,
    unit: z.string().nullable(),
    dosage_form: z.string().nullable(),
    therapeutic_category: z.string().nullable(),
    manufacturer: z.string().nullable(),
    is_generic: z.boolean(),
    is_narcotic: z.boolean(),
    is_psychotropic: z.boolean(),
    is_high_risk: z.boolean(),
    outpatient_injection_eligible: z.boolean(),
    outpatient_injection_note: z.string().nullable(),
    is_lasa_risk: z.boolean(),
    tall_man_name: z.string().nullable(),
    lasa_group_key: z.string().nullable(),
    max_administration_days: z.number().int().positive().nullable(),
    hot_code: z.string().nullable(),
    transitional_expiry_date: apiDateSchema.nullable(),
    package_inserts: z.array(packageInsertSchema),
    interactions_as_a: z.array(interactionAsASchema),
    interactions_as_b: z.array(interactionAsBSchema),
  })
  .strip()
  .superRefine((detail, context) => {
    const interactionIds = new Set<string>();
    for (const [side, interactions] of [
      ['interactions_as_a', detail.interactions_as_a],
      ['interactions_as_b', detail.interactions_as_b],
    ] as const) {
      for (const [index, interaction] of interactions.entries()) {
        if (interactionIds.has(interaction.id)) {
          context.addIssue({
            code: 'custom',
            path: [side, index, 'id'],
            message: 'Duplicate drug interaction id',
          });
        }
        interactionIds.add(interaction.id);
      }
    }
  });

export const drugMasterDetailResponseSchema = z.object({ data: drugMasterDetailSchema }).strict();

const drugComparisonTargetSchema = z
  .object({
    ...drugIdentitySchema.shape,
    generic_name: z.string().nullable(),
    drug_price: nullableApiNumberSchema,
    unit: z.string().nullable(),
    is_generic: z.boolean(),
  })
  .strip();

const siteStockSchema = z
  .object({
    drug_master_id: z.string().trim().min(1),
    is_stocked: z.boolean(),
    preferred_generic_id: z.string().nullable(),
    reorder_point: z.number().int().nonnegative().nullable(),
  })
  .strip();

export const genericRecommendationSchema = z
  .object({
    ...drugIdentitySchema.shape,
    generic_name: z.string().nullable(),
    drug_price: nullableApiNumberSchema,
    unit: z.string().nullable(),
    manufacturer: z.string().nullable(),
    is_generic: z.literal(true),
    transitional_expiry_date: apiDateSchema.nullable(),
    price_delta: z.number().finite().nullable(),
    price_delta_percent: z.number().finite().nullable(),
    site_stock: siteStockSchema.nullable(),
  })
  .strip();

export const genericRecommendationsResponseSchema = z
  .object({
    data: z
      .object({
        site: z.object({ id: z.string(), name: z.string() }).strip().nullable(),
        target: drugComparisonTargetSchema,
        mapping: z.unknown().nullable().optional(),
        recommendations: z.array(genericRecommendationSchema),
        reason: z.literal('generic_name_missing').optional(),
      })
      .strip(),
  })
  .strict()
  .superRefine((payload, context) => {
    const ids = new Set<string>();
    for (const [index, candidate] of payload.data.recommendations.entries()) {
      if (candidate.id === payload.data.target.id || ids.has(candidate.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'recommendations', index, 'id'],
          message: 'Recommendation ids must be unique and differ from the target',
        });
      }
      ids.add(candidate.id);
    }
    if (
      payload.data.reason === 'generic_name_missing' &&
      (payload.data.target.generic_name !== null || payload.data.recommendations.length > 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'reason'],
        message: 'generic_name_missing requires a target without recommendations',
      });
    }
  })
  .transform(({ data }) => ({
    targetId: data.target.id,
    data: { recommendations: data.recommendations },
  }));

const ingredientMemberSchema = z
  .object({
    ...drugComparisonTargetSchema.shape,
    manufacturer: z.string().nullable(),
    transitional_expiry_date: apiDateSchema.nullable(),
    site_stock: siteStockSchema
      .extend({ follow_up_status: z.string().nullable() })
      .strip()
      .nullable(),
  })
  .strip();

const ingredientGroupSummarySchema = z
  .object({
    member_count: z.number().int().nonnegative(),
    brand_count: z.number().int().nonnegative(),
    generic_count: z.number().int().nonnegative(),
    stocked_count: z.number().int().nonnegative(),
    unstocked_count: z.number().int().nonnegative().nullable(),
    lowest_price: nullableApiNumberSchema,
    highest_price: nullableApiNumberSchema,
  })
  .strict();

const ingredientGroupDataSchema = z
  .object({
    site: z.object({ id: z.string(), name: z.string() }).strip().nullable(),
    target: drugComparisonTargetSchema,
    generic_name: z.string().nullable(),
    summary: ingredientGroupSummarySchema.nullable(),
    members: z.array(ingredientMemberSchema),
    reason: z.literal('generic_name_missing').optional(),
  })
  .strip()
  .superRefine((group, context) => {
    const ids = new Set<string>();
    for (const [index, member] of group.members.entries()) {
      if (ids.has(member.id)) {
        context.addIssue({
          code: 'custom',
          path: ['members', index, 'id'],
          message: 'Duplicate ingredient-group member id',
        });
      }
      ids.add(member.id);
    }
    if (group.summary) {
      const summary = group.summary;
      if (
        summary.member_count !== group.members.length ||
        summary.brand_count + summary.generic_count !== summary.member_count ||
        summary.stocked_count > summary.member_count ||
        (summary.unstocked_count !== null &&
          summary.unstocked_count !== summary.member_count - summary.stocked_count) ||
        (summary.lowest_price !== null &&
          summary.highest_price !== null &&
          summary.lowest_price > summary.highest_price)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['summary'],
          message: 'Ingredient-group summary is inconsistent with its members',
        });
      }
    }
    if (
      group.reason === 'generic_name_missing' &&
      (group.generic_name !== null || group.summary !== null || group.members.length > 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'generic_name_missing requires an empty ingredient group',
      });
    }
  });

export const ingredientGroupResponseSchema = z
  .object({ data: ingredientGroupDataSchema })
  .strict()
  .transform(({ data }) => ({
    targetId: data.target.id,
    data: {
      generic_name: data.generic_name,
      summary: data.summary,
      members: data.members,
      ...(data.reason ? { reason: data.reason } : {}),
    },
  }));

const formularyOperationSiteSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
  })
  .strip();

const formularyOperationDrugSchema = z
  .object({
    id: z.string().trim().min(1),
    yj_code: z.string().trim().min(1),
    drug_name: z.string().trim().min(1),
  })
  .strip();

const formularyOperationActionSchema = z.enum(['create', 'update', 'skip_existing']);

const formularyOperationPreviewRowSchema = z
  .object({
    action: formularyOperationActionSchema,
    drug_master_id: z.string().trim().min(1),
    reorder_point: z.number().int().nonnegative().nullable(),
    preferred_generic_id: z.string().trim().min(1).nullable(),
    drug_master: formularyOperationDrugSchema,
  })
  .strip()
  .superRefine((row, context) => {
    if (row.drug_master_id !== row.drug_master.id) {
      context.addIssue({
        code: 'custom',
        path: ['drug_master_id'],
        message: 'Formulary operation drug identity mismatch',
      });
    }
  });

const formularyCopyPreviewSummarySchema = z
  .object({
    source_count: z.number().int().nonnegative(),
    create_count: z.number().int().nonnegative(),
    update_count: z.number().int().nonnegative(),
    skip_existing_count: z.number().int().nonnegative(),
    apply_count: z.number().int().nonnegative(),
  })
  .strict();

function countFormularyActions(rows: Array<z.infer<typeof formularyOperationPreviewRowSchema>>) {
  return {
    create: rows.filter((row) => row.action === 'create').length,
    update: rows.filter((row) => row.action === 'update').length,
    skipExisting: rows.filter((row) => row.action === 'skip_existing').length,
  };
}

function addFormularyOperationPreviewIssues(
  input: {
    itemCount: number;
    appliedCount: number;
    skippedCount: number;
    overwrite: boolean;
    dryRun: boolean;
    summary: z.infer<typeof formularyCopyPreviewSummarySchema>;
    rows: Array<z.infer<typeof formularyOperationPreviewRowSchema>>;
  },
  context: z.RefinementCtx,
) {
  const actions = countFormularyActions(input.rows);
  const ids = new Set<string>();
  for (const [index, row] of input.rows.entries()) {
    if (ids.has(row.drug_master_id)) {
      context.addIssue({
        code: 'custom',
        path: ['preview', 'rows', index, 'drug_master_id'],
        message: 'Duplicate formulary operation drug id',
      });
    }
    ids.add(row.drug_master_id);
  }

  if (
    input.itemCount !== input.rows.length ||
    input.summary.source_count !== input.itemCount ||
    input.summary.create_count !== actions.create ||
    input.summary.update_count !== actions.update ||
    input.summary.skip_existing_count !== actions.skipExisting ||
    input.summary.apply_count !== actions.create + actions.update ||
    input.skippedCount !== input.itemCount - input.summary.apply_count ||
    input.appliedCount !== (input.dryRun ? 0 : input.summary.apply_count) ||
    (input.overwrite && input.summary.skip_existing_count !== 0) ||
    (!input.overwrite && input.summary.update_count !== 0)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['preview', 'summary'],
      message: 'Formulary operation preview counts are inconsistent',
    });
  }
}

const formularyCopyDataSchema = z
  .object({
    sourceSite: formularyOperationSiteSchema,
    targetSite: formularyOperationSiteSchema,
    sourceCount: z.number().int().nonnegative(),
    copiedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    overwrite: z.boolean(),
    dryRun: z.boolean(),
    preview: z
      .object({
        summary: formularyCopyPreviewSummarySchema,
        rows: z.array(formularyOperationPreviewRowSchema),
      })
      .strict(),
  })
  .strip()
  .superRefine((data, context) => {
    if (data.sourceSite.id === data.targetSite.id) {
      context.addIssue({
        code: 'custom',
        path: ['targetSite', 'id'],
        message: 'Formulary copy source and target sites must differ',
      });
    }
    addFormularyOperationPreviewIssues(
      {
        itemCount: data.sourceCount,
        appliedCount: data.copiedCount,
        skippedCount: data.skippedCount,
        overwrite: data.overwrite,
        dryRun: data.dryRun,
        summary: data.preview.summary,
        rows: data.preview.rows,
      },
      context,
    );
  });

export const formularyCopyResponseSchema = z
  .object({ data: formularyCopyDataSchema })
  .strict()
  .transform(({ data }) => ({
    sourceSiteId: data.sourceSite.id,
    targetSiteId: data.targetSite.id,
    data: {
      sourceCount: data.sourceCount,
      copiedCount: data.copiedCount,
      skippedCount: data.skippedCount,
      overwrite: data.overwrite,
      dryRun: data.dryRun,
      preview: data.preview,
    },
  }));

const formularyTemplatePreviewSummarySchema = z
  .object({
    item_count: z.number().int().nonnegative(),
    source_item_count: z.number().int().nonnegative(),
    invalid_item_count: z.number().int().nonnegative(),
    create_count: z.number().int().nonnegative(),
    update_count: z.number().int().nonnegative(),
    skip_existing_count: z.number().int().nonnegative(),
    apply_count: z.number().int().nonnegative(),
  })
  .strict();

const formularyTemplateApplyDataSchema = z
  .object({
    template: z.object({ id: z.string().trim().min(1), name: z.string().trim().min(1) }).strip(),
    targetSite: formularyOperationSiteSchema,
    itemCount: z.number().int().nonnegative(),
    sourceItemCount: z.number().int().nonnegative(),
    invalidItemCount: z.number().int().nonnegative(),
    appliedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    overwrite: z.boolean(),
    dryRun: z.boolean(),
    preview: z
      .object({
        summary: formularyTemplatePreviewSummarySchema,
        rows: z.array(formularyOperationPreviewRowSchema),
      })
      .strict(),
  })
  .strip()
  .superRefine((data, context) => {
    const summary = data.preview.summary;
    if (
      data.itemCount !== summary.item_count ||
      data.sourceItemCount !== summary.source_item_count ||
      data.invalidItemCount !== summary.invalid_item_count ||
      data.sourceItemCount !== data.itemCount + data.invalidItemCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['preview', 'summary'],
        message: 'Formulary template source counts are inconsistent',
      });
    }
    addFormularyOperationPreviewIssues(
      {
        itemCount: data.itemCount,
        appliedCount: data.appliedCount,
        skippedCount: data.skippedCount,
        overwrite: data.overwrite,
        dryRun: data.dryRun,
        summary: {
          source_count: summary.item_count,
          create_count: summary.create_count,
          update_count: summary.update_count,
          skip_existing_count: summary.skip_existing_count,
          apply_count: summary.apply_count,
        },
        rows: data.preview.rows,
      },
      context,
    );
  });

export const formularyTemplateApplyResponseSchema = z
  .object({ data: formularyTemplateApplyDataSchema })
  .strict()
  .transform(({ data }) => ({
    templateId: data.template.id,
    targetSiteId: data.targetSite.id,
    data: {
      itemCount: data.itemCount,
      appliedCount: data.appliedCount,
      skippedCount: data.skippedCount,
      overwrite: data.overwrite,
      dryRun: data.dryRun,
      preview: {
        summary: {
          item_count: data.preview.summary.item_count,
          create_count: data.preview.summary.create_count,
          update_count: data.preview.summary.update_count,
          skip_existing_count: data.preview.summary.skip_existing_count,
          apply_count: data.preview.summary.apply_count,
        },
        rows: data.preview.rows,
      },
    },
  }));

const bulkPreviewCandidateSchema = z
  .object({
    id: z.string().trim().min(1),
    yj_code: z.string().trim().min(1),
    drug_name: z.string().trim().min(1),
    generic_name: z.string().nullable(),
  })
  .strip();

const bulkPreviewStatusSchema = z.enum([
  'create',
  'update',
  'deactivate',
  'no_change',
  'unmatched',
  'invalid',
]);

const bulkPreviewRowSchema = z
  .object({
    rowNumber: z.number().int().positive(),
    status: bulkPreviewStatusSchema,
    yj_code: z.string().optional(),
    drug_name: z.string().optional(),
    reason: z.string().optional(),
    candidates: z.array(bulkPreviewCandidateSchema).optional(),
  })
  .strip();

const bulkUnmatchedRowSchema = z
  .object({
    rowNumber: z.number().int().positive(),
    yj_code: z.string().optional(),
    drug_name: z.string().optional(),
  })
  .strip();

const bulkInvalidRowSchema = z
  .object({
    rowNumber: z.number().int().positive(),
    reason: z.string().trim().min(1),
    candidates: z.array(bulkPreviewCandidateSchema).optional(),
  })
  .strip();

const bulkPreviewSummarySchema = z
  .object({
    totalRows: z.number().int().nonnegative(),
    processableRows: z.number().int().nonnegative(),
    createCount: z.number().int().nonnegative(),
    updateCount: z.number().int().nonnegative(),
    deactivateCount: z.number().int().nonnegative(),
    noChangeCount: z.number().int().nonnegative(),
    unmatchedCount: z.number().int().nonnegative(),
    invalidCount: z.number().int().nonnegative(),
  })
  .strict();

const bulkFormularyDataSchema = z
  .object({
    site: formularyOperationSiteSchema,
    importedCount: z.number().int().nonnegative(),
    unmatchedRows: z.array(bulkUnmatchedRowSchema),
    invalidRows: z.array(bulkInvalidRowSchema),
    preview: z
      .object({
        summary: bulkPreviewSummarySchema,
        rows: z.array(bulkPreviewRowSchema),
      })
      .strict(),
  })
  .strip()
  .superRefine((data, context) => {
    const summary = data.preview.summary;
    const counts = Object.fromEntries(
      bulkPreviewStatusSchema.options.map((status) => [
        status,
        data.preview.rows.filter((row) => row.status === status).length,
      ]),
    ) as Record<z.infer<typeof bulkPreviewStatusSchema>, number>;
    const rowNumbers = new Set<number>();
    for (const [index, row] of data.preview.rows.entries()) {
      if (rowNumbers.has(row.rowNumber)) {
        context.addIssue({
          code: 'custom',
          path: ['preview', 'rows', index, 'rowNumber'],
          message: 'Duplicate bulk preview row number',
        });
      }
      rowNumbers.add(row.rowNumber);
    }
    const unmatchedRowNumbers = data.unmatchedRows
      .map((row) => row.rowNumber)
      .sort((a, b) => a - b);
    const previewUnmatchedRowNumbers = data.preview.rows
      .filter((row) => row.status === 'unmatched')
      .map((row) => row.rowNumber)
      .sort((a, b) => a - b);
    const invalidRowNumbers = data.invalidRows.map((row) => row.rowNumber).sort((a, b) => a - b);
    const previewInvalidRowNumbers = data.preview.rows
      .filter((row) => row.status === 'invalid')
      .map((row) => row.rowNumber)
      .sort((a, b) => a - b);
    const processableCount = counts.create + counts.update + counts.deactivate + counts.no_change;
    if (
      summary.totalRows !== data.preview.rows.length ||
      summary.processableRows !== processableCount ||
      summary.createCount !== counts.create ||
      summary.updateCount !== counts.update ||
      summary.deactivateCount !== counts.deactivate ||
      summary.noChangeCount !== counts.no_change ||
      summary.unmatchedCount !== counts.unmatched ||
      summary.invalidCount !== counts.invalid ||
      summary.totalRows !==
        summary.processableRows + summary.unmatchedCount + summary.invalidCount ||
      summary.unmatchedCount !== data.unmatchedRows.length ||
      summary.invalidCount !== data.invalidRows.length ||
      unmatchedRowNumbers.join(',') !== previewUnmatchedRowNumbers.join(',') ||
      invalidRowNumbers.join(',') !== previewInvalidRowNumbers.join(',') ||
      ![0, summary.processableRows].includes(data.importedCount)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['preview', 'summary'],
        message: 'Bulk formulary preview counts are inconsistent',
      });
    }
  });

export const bulkFormularyResponseSchema = z
  .object({ data: bulkFormularyDataSchema })
  .strict()
  .transform(({ data }) => ({
    siteId: data.site.id,
    data: {
      importedCount: data.importedCount,
      unmatchedRows: data.unmatchedRows,
      invalidRows: data.invalidRows,
      preview: data.preview,
    },
  }));

const formularyDecisionRequestSchema = z
  .object({
    id: z.string().trim().min(1),
    site_id: z.string().trim().min(1),
    drug_master_id: z.string().trim().min(1),
    status: z.enum(['approved', 'rejected']),
  })
  .strip();

const formularyRequestDecisionDataSchema = z
  .object({
    request: formularyDecisionRequestSchema,
    stock: z.unknown().nullable(),
  })
  .strict()
  .superRefine((data, context) => {
    const stockIsObject =
      typeof data.stock === 'object' && data.stock !== null && !Array.isArray(data.stock);
    if (
      (data.request.status === 'approved' && !stockIsObject) ||
      (data.request.status === 'rejected' && data.stock !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['stock'],
        message: 'Formulary decision stock result does not match its status',
      });
    }
  });

export const formularyRequestDecisionResponseSchema = z
  .object({ data: formularyRequestDecisionDataSchema })
  .strict()
  .transform(({ data }) => ({
    requestId: data.request.id,
    siteId: data.request.site_id,
    drugMasterId: data.request.drug_master_id,
    status: data.request.status,
  }));

const formularyReviewDataSchema = z
  .object({
    site: formularyOperationSiteSchema,
    reviewedCount: z.number().int().nonnegative(),
    reviewedAt: z.string().datetime().optional(),
  })
  .strip()
  .superRefine((data, context) => {
    if (data.reviewedCount > 0 && !data.reviewedAt) {
      context.addIssue({
        code: 'custom',
        path: ['reviewedAt'],
        message: 'A non-empty formulary review requires its timestamp',
      });
    }
  });

export const formularyReviewResponseSchema = z
  .object({ data: formularyReviewDataSchema })
  .strict()
  .transform(({ data }) => ({
    siteId: data.site.id,
    data: { reviewedCount: data.reviewedCount },
  }));

const formularySafetyQueueSchema = z.enum(['all', 'high_risk', 'lasa_risk', 'controlled']);

const formularySafetyFollowUpDataSchema = z
  .object({
    site: formularyOperationSiteSchema,
    queue: formularySafetyQueueSchema,
    matchedCount: z.number().int().nonnegative(),
    updatedCount: z.number().int().nonnegative(),
    skippedUnresolvedCount: z.number().int().nonnegative(),
    dueDate: z.string().datetime(),
    dryRun: z.boolean(),
  })
  .strip()
  .superRefine((data, context) => {
    if (data.updatedCount > data.matchedCount || (data.dryRun && data.updatedCount !== 0)) {
      context.addIssue({
        code: 'custom',
        path: ['updatedCount'],
        message: 'Formulary safety follow-up counts are inconsistent',
      });
    }
  });

export const formularySafetyFollowUpResponseSchema = z
  .object({ data: formularySafetyFollowUpDataSchema })
  .strict()
  .transform(({ data }) => ({
    siteId: data.site.id,
    queue: data.queue,
    dryRun: data.dryRun,
    data: {
      matchedCount: data.matchedCount,
      updatedCount: data.updatedCount,
      skippedUnresolvedCount: data.skippedUnresolvedCount,
    },
  }));

export const officialDrugMasterImportResponseSchema = z
  .object({
    data: z.object({ importedCount: z.number().int().nonnegative() }).strip(),
  })
  .strict()
  .transform(({ data }) => ({ data: { importedCount: data.importedCount } }));

const drugMasterJobTypeSchema = z.enum(['drug-master-auto-refresh', 'drug-master-freshness-check']);

export const drugMasterJobResponseSchema = z
  .object({
    data: z
      .object({
        jobType: drugMasterJobTypeSchema,
        processedCount: z.number().int().nonnegative(),
        errors: z.array(z.string()).optional(),
      })
      .strip(),
  })
  .strict()
  .transform(({ data }) => ({
    jobType: data.jobType,
    data: { processedCount: data.processedCount },
  }));

const officialImportPreviewSummarySchema = z
  .object({
    parsed_records: z.number().int().nonnegative(),
    sampled_rows: z.number().int().nonnegative(),
  })
  .catchall(z.number().int().nonnegative());

const officialImportPreviewPayloadSchema = z
  .object({
    summary: officialImportPreviewSummarySchema,
    rows: z.array(z.record(z.string(), z.unknown())).max(5),
  })
  .strict()
  .superRefine((preview, context) => {
    if (
      preview.summary.sampled_rows !== preview.rows.length ||
      preview.summary.sampled_rows > preview.summary.parsed_records
    ) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'sampled_rows'],
        message: 'Official import preview sample counts are inconsistent',
      });
    }
  });

const officialImportPreviewOperationSchema = z.enum(['generic_flags', 'generic_mapping']);

const officialImportPreviewLeafSchema = z
  .object({
    dryRun: z.literal(true),
    operation: officialImportPreviewOperationSchema.optional(),
    sourceFileHash: z.string().trim().min(1).nullable(),
    preview: officialImportPreviewPayloadSchema,
  })
  .strip();

const officialImportPreviewModeSchema = z.enum(['flags', 'mappings', 'all', 'full', 'delta']);

export const officialImportPreviewDataSchema = z
  .object({
    dryRun: z.literal(true),
    mode: officialImportPreviewModeSchema.optional(),
    operation: officialImportPreviewOperationSchema.optional(),
    sourceFileHash: z.string().trim().min(1).nullable().optional(),
    preview: officialImportPreviewPayloadSchema.optional(),
    flags: officialImportPreviewLeafSchema.nullable().optional(),
    mappings: officialImportPreviewLeafSchema.nullable().optional(),
  })
  .strip()
  .superRefine((data, context) => {
    const hasBranches = data.flags !== undefined || data.mappings !== undefined;
    if (data.preview) {
      if (data.sourceFileHash === undefined || hasBranches) {
        context.addIssue({
          code: 'custom',
          path: ['preview'],
          message: 'A direct official import preview requires source identity without branches',
        });
      }
      return;
    }

    const flagsPresent = data.flags !== null && data.flags !== undefined;
    const mappingsPresent = data.mappings !== null && data.mappings !== undefined;
    const branchesMatchMode =
      (data.mode === 'all' && flagsPresent && mappingsPresent) ||
      (data.mode === 'flags' && flagsPresent && !mappingsPresent) ||
      (data.mode === 'mappings' && !flagsPresent && mappingsPresent);
    if (
      !hasBranches ||
      !branchesMatchMode ||
      (flagsPresent && data.flags?.operation !== 'generic_flags') ||
      (mappingsPresent && data.mappings?.operation !== 'generic_mapping')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'Official import preview branches do not match their mode',
      });
    }
  });

export const officialImportPreviewResponseSchema = z
  .object({ data: officialImportPreviewDataSchema })
  .strict();

export type BulkPreviewResponse = z.infer<typeof bulkFormularyResponseSchema>['data'];
export type DrugMasterDetail = z.infer<typeof drugMasterDetailSchema>;
export type FormularyCopyPreviewResponse = z.infer<typeof formularyCopyResponseSchema>['data'];
export type FormularyImpactResponse = z.infer<typeof formularyImpactResponseSchema>['data'];
export type FormularyRecentChange = z.infer<typeof formularyRecentChangeSchema>;
export type FormularyStockSummaryRow = z.infer<typeof formularyImpactStockSchema>;
export type FormularyTemplateItem = z.infer<typeof formularyTemplateItemSchema>;
export type FormularyTemplatePreviewResponse = z.infer<
  typeof formularyTemplateApplyResponseSchema
>['data'];
export type FormularyUsageMismatchResponse = z.infer<
  typeof formularyUsageMismatchResponseSchema
>['data'];
export type GenericCandidateOption = z.infer<typeof genericCandidateSchema>;
export type GenericRecommendation = z.infer<typeof genericRecommendationSchema>;
export type IngredientGroupResponse = z.infer<typeof ingredientGroupResponseSchema>['data'];
export type OfficialImportPreviewData = z.infer<typeof officialImportPreviewDataSchema>;
export type PharmacySiteOption = z.infer<typeof pharmacySiteReferenceSchema>;
