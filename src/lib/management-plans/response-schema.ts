import { z } from 'zod';

const MAX_LEGACY_CONTENT_KEYS = 50;
const MAX_LEGACY_CONTENT_BYTES = 64 * 1024;

export const managementPlanStatusSchema = z.enum(['draft', 'approved', 'superseded', 'archived']);

const legacyContentValueSchema = z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string().max(10_000),
  z.array(z.string().max(1_000)).max(100),
]);

export const managementPlanReadContentSchema = z
  .record(z.string().max(100), legacyContentValueSchema)
  .superRefine((content, ctx) => {
    if (Object.keys(content).length > MAX_LEGACY_CONTENT_KEYS) {
      ctx.addIssue({ code: 'custom', message: 'Management plan content has too many keys' });
    }
    if (new TextEncoder().encode(JSON.stringify(content)).byteLength > MAX_LEGACY_CONTENT_BYTES) {
      ctx.addIssue({ code: 'custom', message: 'Management plan content is too large' });
    }
  });

const nullableTimestamp = z.string().datetime({ offset: true }).nullable();
const timestamp = z.string().datetime({ offset: true });

export const managementPlanListItemSchema = z
  .object({
    id: z.string().min(1),
    case_id: z.string().min(1),
    title: z.string().max(200),
    status: managementPlanStatusSchema,
    version: z.number().int().min(1).max(2_147_483_647),
    effective_from: nullableTimestamp,
    next_review_date: nullableTimestamp,
    approved_at: nullableTimestamp,
    updated_at: timestamp,
  })
  .strict();

export const managementPlanDetailSchema = managementPlanListItemSchema
  .extend({
    summary: z.string().max(4_000).nullable(),
    content: managementPlanReadContentSchema,
  })
  .strict();

export const managementPlanListResponseSchema = z
  .object({
    data: z.array(managementPlanListItemSchema).max(100),
    meta: z
      .object({
        has_more: z.boolean(),
        next_cursor: z.number().int().min(1).max(2_147_483_647).nullable(),
      })
      .strict(),
  })
  .strict();

export const managementPlanDetailResponseSchema = z
  .object({ data: managementPlanDetailSchema })
  .strict();

export type ManagementPlanListItem = z.infer<typeof managementPlanListItemSchema>;
export type ManagementPlanListResponse = z.infer<typeof managementPlanListResponseSchema>;
export type ManagementPlanDetail = z.infer<typeof managementPlanDetailSchema>;
export type ManagementPlanDetailResponse = z.infer<typeof managementPlanDetailResponseSchema>;

type DateLike = Date | string | null;

type ManagementPlanListRecord = {
  id: string;
  case_id: string;
  title: string;
  status: string;
  version: number;
  effective_from: DateLike;
  next_review_date: DateLike;
  approved_at: DateLike;
  updated_at: Exclude<DateLike, null>;
};

type ManagementPlanDetailRecord = ManagementPlanListRecord & {
  summary: string | null;
  content: unknown;
};

function toIsoString(value: Date | string) {
  return new Date(value).toISOString();
}

function toNullableIsoString(value: DateLike) {
  return value == null ? null : toIsoString(value);
}

export function presentManagementPlanListItem(
  plan: ManagementPlanListRecord,
): ManagementPlanListItem {
  return managementPlanListItemSchema.parse({
    id: plan.id,
    case_id: plan.case_id,
    title: plan.title,
    status: plan.status,
    version: plan.version,
    effective_from: toNullableIsoString(plan.effective_from),
    next_review_date: toNullableIsoString(plan.next_review_date),
    approved_at: toNullableIsoString(plan.approved_at),
    updated_at: toIsoString(plan.updated_at),
  });
}

export function presentManagementPlanDetail(
  plan: ManagementPlanDetailRecord,
): ManagementPlanDetail {
  return managementPlanDetailSchema.parse({
    ...presentManagementPlanListItem(plan),
    summary: plan.summary,
    content: plan.content,
  });
}
