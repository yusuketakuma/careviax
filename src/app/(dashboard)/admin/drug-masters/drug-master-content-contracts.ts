import { z } from 'zod';
import {
  drugMasterImportRunStatusSchema,
  drugMasterImportSourceSchema,
} from '@/types/drug-master-import-status';

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

const apiDateSchema = z.union([z.string().date(), z.string().datetime()]);
const nullableApiNumberSchema = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value) => Number(value))
  .pipe(z.number().finite().nonnegative())
  .nullable();

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

export type DrugMasterDetail = z.infer<typeof drugMasterDetailSchema>;
export type FormularyTemplateItem = z.infer<typeof formularyTemplateItemSchema>;
export type GenericCandidateOption = z.infer<typeof genericCandidateSchema>;
export type GenericRecommendation = z.infer<typeof genericRecommendationSchema>;
export type IngredientGroupResponse = z.infer<typeof ingredientGroupResponseSchema>['data'];
export type PharmacySiteOption = z.infer<typeof pharmacySiteReferenceSchema>;
