import { z } from 'zod';

const countSchema = z.number().finite().int().nonnegative();
const rateSchema = z.number().finite().int().min(0).max(100);
const monthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);
const nonEmptyText = z.string().trim().min(1).max(500);

const monthlyTrendRowSchema = z
  .object({
    month: monthSchema,
    total_candidates: countSchema,
    review_pending: countSchema,
    confirmed: countSchema,
    excluded: countSchema,
    exported: countSchema,
    claimable_evidence: countSchema,
    unclaimable_evidence: countSchema,
  })
  .strip()
  .superRefine((row, context) => {
    if (row.total_candidates !== row.review_pending + row.confirmed + row.excluded + row.exported) {
      context.addIssue({
        code: 'custom',
        path: ['total_candidates'],
        message: 'Candidate total must equal the monthly status counts',
      });
    }
  });

function expectedNextMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return next.toISOString().slice(0, 7);
}

export const billingEvidenceAnalyticsResponseSchema = z
  .object({
    data: z
      .object({
        summary: z
          .object({
            ssot_rule_count: countSchema,
            current_month: monthSchema,
            current_month_candidates: countSchema,
            current_month_review_pending: countSchema,
            current_month_claimable_rate: rateSchema,
            current_month_close_rate: rateSchema,
            current_month_exported: countSchema,
          })
          .strip(),
        monthly_trend: z.array(monthlyTrendRowSchema).length(6),
        blocker_reasons: z
          .array(z.object({ reason: nonEmptyText, count: countSchema }).strip())
          .max(5),
        top_codes: z
          .array(
            z
              .object({
                billing_code: nonEmptyText,
                billing_name: nonEmptyText,
                count: countSchema,
              })
              .strip(),
          )
          .max(5),
      })
      .strip(),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const months = new Set<string>();
    for (const [index, row] of data.monthly_trend.entries()) {
      if (months.has(row.month)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'monthly_trend', index, 'month'],
          message: 'Monthly trend identities must be unique',
        });
      }
      months.add(row.month);
      if (index > 0 && row.month !== expectedNextMonth(data.monthly_trend[index - 1].month)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'monthly_trend', index, 'month'],
          message: 'Monthly trend must contain consecutive ascending months',
        });
      }
    }

    const summaryRow = data.monthly_trend.find((row) => row.month === data.summary.current_month);
    if (!summaryRow) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'summary', 'current_month'],
        message: 'Summary month must exist in the monthly trend',
      });
      return;
    }

    const evidenceTotal = summaryRow.claimable_evidence + summaryRow.unclaimable_evidence;
    const expectedClaimableRate =
      evidenceTotal === 0 ? 0 : Math.round((summaryRow.claimable_evidence / evidenceTotal) * 100);
    const expectedCloseRate =
      summaryRow.total_candidates === 0
        ? 0
        : Math.round(
            ((summaryRow.confirmed + summaryRow.exported + summaryRow.excluded) /
              summaryRow.total_candidates) *
              100,
          );
    const summaryChecks = [
      ['current_month_candidates', summaryRow.total_candidates],
      ['current_month_review_pending', summaryRow.review_pending],
      ['current_month_claimable_rate', expectedClaimableRate],
      ['current_month_close_rate', expectedCloseRate],
      ['current_month_exported', summaryRow.exported],
    ] as const;
    for (const [field, expected] of summaryChecks) {
      if (data.summary[field] !== expected) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'summary', field],
          message: `${field} must match the selected monthly trend bucket`,
        });
      }
    }
  });

export type BillingEvidenceAnalyticsResponse = z.infer<
  typeof billingEvidenceAnalyticsResponseSchema
>;
