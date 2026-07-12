import { z } from 'zod';

export const voiceMemoVisitRecordDetailResponseSchema = z
  .object({
    data: z
      .object({
        version: z.number().int().positive(),
        soap_subjective: z.string().max(100_000).nullable(),
      })
      .strip(),
  })
  .strict()
  .transform((payload) => payload.data);
