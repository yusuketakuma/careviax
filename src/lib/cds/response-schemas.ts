import { z } from 'zod';

export type { CdsAlert, CdsAlertSeverity } from './alert-contract';

const idSchema = z.string().trim().min(1).max(255);

export const cdsAlertSchema = z
  .object({
    type: idSchema,
    severity: z.enum(['critical', 'warning', 'info']),
    message: z.string().trim().min(1).max(10_000),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** Canonical client contract for POST /api/cds/check. */
export const cdsAlertsResponseSchema = z
  .object({
    data: z.object({ alerts: z.array(cdsAlertSchema) }).strict(),
  })
  .strict()
  .transform(({ data }) => data);

/**
 * The safety-check workspace requests the first medication cycle only.
 * A wider or malformed result is ambiguous and must not become a clean CDS state.
 */
export const medicationCycleForCdsResponseSchema = z
  .object({
    data: z.array(z.object({ id: idSchema }).strict()).max(1),
    meta: z
      .object({
        limit: z.literal(1),
        has_more: z.boolean(),
        next_cursor: idSchema.nullable(),
        total_count: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    const expectedDataLength = meta.total_count === 0 ? 0 : 1;
    if (data.length !== expectedDataLength) {
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'medication cycle page count mismatch',
      });
    }

    if (meta.total_count < data.length) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'total_count'],
        message: 'medication cycle total count is smaller than page data',
      });
    }

    if (meta.has_more !== meta.total_count > data.length) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'has_more'],
        message: 'medication cycle pagination state mismatch',
      });
    }

    if (meta.has_more !== Boolean(meta.next_cursor)) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'next_cursor'],
        message: 'medication cycle cursor state mismatch',
      });
    }
  })
  .transform(({ data }) => data);
