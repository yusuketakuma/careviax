import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const timestampSchema = z.string().datetime({ offset: true });

const prescriptionSummaryItemSchema = z
  .object({
    id: nonEmptyText(255),
    prescribed_date: timestampSchema,
    prescriber_name: z.string().trim().min(1).max(500).nullable(),
    lines: z
      .array(
        z
          .object({
            drug_name: nonEmptyText(500),
            dose: z.string().max(500).nullable().optional(),
          })
          .strip(),
      )
      .max(500),
  })
  .strip();

export const patientHistoryPrescriptionsResponseSchema = z
  .object({
    data: z
      .object({
        data: z.array(prescriptionSummaryItemSchema).max(5),
        hasMore: z.boolean(),
        nextCursor: z.string().trim().min(1).max(4_000).optional(),
      })
      .strip(),
  })
  .strict()
  .superRefine(({ data }, context) => {
    addPageIssues(data.data, context, 'prescribed_date');
    if (data.hasMore !== (data.nextCursor !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'nextCursor'],
        message: 'Prescription cursor metadata is inconsistent',
      });
    }
    if (data.hasMore && data.data.length !== 5) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'hasMore'],
        message: 'A truncated prescription summary page must be full',
      });
    }
  })
  .transform((payload) => ({ data: payload.data.data }));

const visitSummaryItemSchema = z
  .object({
    id: nonEmptyText(255),
    visit_date: timestampSchema,
    outcome_status: z.enum([
      'completed',
      'revisit_needed',
      'postponed',
      'cancelled',
      'delivery_only',
      'completed_with_issue',
    ]),
    soap_assessment: z.string().max(8_000).nullable(),
    next_visit_suggestion_date: timestampSchema.nullable(),
  })
  .strip();

export const patientHistoryVisitsResponseSchema = z
  .object({
    data: z.array(visitSummaryItemSchema).max(5),
    meta: z
      .object({
        has_more: z.boolean(),
        next_cursor: z.string().trim().min(1).max(4_000).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((payload, context) => {
    addPageIssues(payload.data, context, 'visit_date');
    if (payload.meta.has_more !== (payload.meta.next_cursor !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'next_cursor'],
        message: 'Visit cursor metadata is inconsistent',
      });
    }
    if (payload.meta.has_more && payload.data.length !== 5) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'has_more'],
        message: 'A truncated visit summary page must be full',
      });
    }
  })
  .transform((payload) => ({ data: payload.data }));

function addPageIssues<T extends { id: string }>(
  data: T[],
  context: z.RefinementCtx,
  dateKey: keyof T,
) {
  const identities = new Set<string>();
  for (const [index, item] of data.entries()) {
    if (identities.has(item.id)) {
      context.addIssue({
        code: 'custom',
        path: ['data', index, 'id'],
        message: 'Duplicate patient history identity',
      });
    }
    identities.add(item.id);

    const currentDate = item[dateKey];
    const previousDate = data[index - 1]?.[dateKey];
    if (
      index > 0 &&
      typeof currentDate === 'string' &&
      typeof previousDate === 'string' &&
      Date.parse(currentDate) > Date.parse(previousDate)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['data', index, String(dateKey)],
        message: 'Patient history must be newest first',
      });
    }
  }
}

export type PatientHistoryPrescriptionsResponse = z.infer<
  typeof patientHistoryPrescriptionsResponseSchema
>;
export type PatientHistoryVisitsResponse = z.infer<typeof patientHistoryVisitsResponseSchema>;
