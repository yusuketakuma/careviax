import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const timestampSchema = z.string().datetime({ offset: true });

const structuredCareItemSchema = z
  .object({
    id: nonEmptyText(255),
    kind: nonEmptyText(200),
    is_active: z.literal(true),
    start_date: timestampSchema.nullable(),
    end_date: z.null(),
    source: nonEmptyText(200),
    confirmed_by: nonEmptyText(255).nullable(),
    confirmed_by_name: nonEmptyText(500).nullable(),
    confirmed_at: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.confirmed_by_name !== null && item.confirmed_by === null) {
      context.addIssue({
        code: 'custom',
        path: ['confirmed_by_name'],
        message: 'Confirmed actor name requires an actor identity',
      });
    }
  });

function addUniqueIdentityIssues(
  items: ReadonlyArray<{ id: string }>,
  path: 'procedures' | 'narcotics',
  context: z.RefinementCtx,
) {
  const identities = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (identities.has(item.id)) {
      context.addIssue({
        code: 'custom',
        path: [path, index, 'id'],
        message: 'Duplicate structured-care identity',
      });
    }
    identities.add(item.id);
  }
}

export const patientStructuredCareResponseSchema = z
  .object({
    data: z
      .object({
        procedures: z.array(structuredCareItemSchema).max(500),
        narcotics: z.array(structuredCareItemSchema).max(500),
      })
      .strict()
      .superRefine((data, context) => {
        addUniqueIdentityIssues(data.procedures, 'procedures', context);
        addUniqueIdentityIssues(data.narcotics, 'narcotics', context);
      }),
  })
  .strict();

export type PatientStructuredCareResponse = z.infer<typeof patientStructuredCareResponseSchema>;
