import { z } from 'zod';

const residualRecordSchema = z
  .object({
    id: z.string().trim().min(1).max(255),
    drug_name: z.string().trim().min(1).max(500),
    excess_days: z.number().finite().int().nonnegative().nullable(),
    created_at: z.string().datetime({ offset: true }),
  })
  .strip();

export const residualMedicationChartResponseSchema = z
  .object({
    data: z.array(residualRecordSchema).max(100),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const identities = new Set<string>();
    for (const [index, item] of data.entries()) {
      if (identities.has(item.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate residual medication identity',
        });
      }
      identities.add(item.id);

      if (index > 0 && Date.parse(item.created_at) < Date.parse(data[index - 1]!.created_at)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'created_at'],
          message: 'Residual medication records must be chronological',
        });
      }
    }
  });

export type ResidualMedicationChartResponse = z.infer<typeof residualMedicationChartResponseSchema>;
