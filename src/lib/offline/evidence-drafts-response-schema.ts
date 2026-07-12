import { z } from 'zod';

const attachmentReferenceSchema = z
  .object({
    file_id: z.string().trim().min(1).max(255),
  })
  .strip();

export const evidenceDraftVisitRecordDetailResponseSchema = z
  .object({
    data: z
      .object({
        version: z.number().int().nonnegative(),
        attachments: z.array(attachmentReferenceSchema).max(500),
      })
      .strip(),
  })
  .strict()
  .transform((payload) => payload.data);
