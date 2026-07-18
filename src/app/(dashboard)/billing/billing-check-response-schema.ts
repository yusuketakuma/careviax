import { z } from 'zod';
import { apiDataSchema } from '@/lib/api/response-schemas';
import type { BillingCheckResponse } from '@/types/billing-check';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const nonNegativeCount = z.number().finite().int().nonnegative();
const internalHref = z
  .string()
  .max(2_000)
  .refine((value) => value.startsWith('/') && !value.startsWith('//'), {
    message: 'Expected an internal application path',
  });
const billingEvidenceHref = z.union([
  internalHref,
  z
    .url()
    .max(2_000)
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'www.mhlw.go.jp';
    }, 'Expected an internal path or an official MHLW HTTPS URL'),
]);

const billingCheckReviewRowSchema = z
  .object({
    id: nonEmptyText(200),
    patient_label: nonEmptyText(500),
    patient_href: internalHref.nullable(),
    billing_name: nonEmptyText(500),
    confirm_text: nonEmptyText(4_000),
    evidence_label: nonEmptyText(500),
    evidence_href: billingEvidenceHref,
    action_label: nonEmptyText(200),
    action_href: internalHref,
  })
  .strip();

const todayOpsRailSchema = z
  .object({
    next_action: z
      .object({
        label: nonEmptyText(500),
        description: nonEmptyText(4_000),
        href: internalHref,
      })
      .strip(),
    blocked_reasons: z
      .array(
        z
          .object({
            id: nonEmptyText(200),
            label: nonEmptyText(4_000),
            severity: z.enum(['critical', 'warning']),
            category: nonEmptyText(200),
            age_minutes: nonNegativeCount,
            action_label: nonEmptyText(200),
            action_href: internalHref,
          })
          .strip(),
      )
      .max(3),
  })
  .strip();

const billingCheckDataSchema: z.ZodType<BillingCheckResponse> = z
  .object({
    generated_at: z.string().datetime({ offset: true }),
    month: z.enum(['current', 'previous']),
    month_label: nonEmptyText(100),
    month_short_label: nonEmptyText(50),
    passed_count: nonNegativeCount,
    review_count: nonNegativeCount,
    today_pending_count: nonNegativeCount,
    review_rows: z.array(billingCheckReviewRowSchema).max(10),
    records: z
      .object({
        rule_revision_label: nonEmptyText(100),
        rejection_count: nonNegativeCount,
        summary_template_kind_count: nonNegativeCount,
      })
      .strip(),
    rail: todayOpsRailSchema,
  })
  .strip()
  .superRefine((value, context) => {
    if (value.review_count < value.review_rows.length) {
      context.addIssue({
        code: 'custom',
        path: ['review_count'],
        message: 'Review count cannot be smaller than the displayed review rows',
      });
    }

    const reviewIds = new Set<string>();
    for (const [index, row] of value.review_rows.entries()) {
      if (reviewIds.has(row.id)) {
        context.addIssue({
          code: 'custom',
          path: ['review_rows', index, 'id'],
          message: 'Duplicate billing review row identity',
        });
      }
      reviewIds.add(row.id);
    }

    const blockedReasonIds = new Set<string>();
    for (const [index, reason] of value.rail.blocked_reasons.entries()) {
      if (blockedReasonIds.has(reason.id)) {
        context.addIssue({
          code: 'custom',
          path: ['rail', 'blocked_reasons', index, 'id'],
          message: 'Duplicate blocked reason identity',
        });
      }
      blockedReasonIds.add(reason.id);
    }
  });

export const billingCheckResponseSchema = apiDataSchema(billingCheckDataSchema);
