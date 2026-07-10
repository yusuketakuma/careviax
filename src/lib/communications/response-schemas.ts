import { z } from 'zod';

export const createCommunicationRequestResponseSchema = z
  .object({
    data: z
      .object({
        id: z.string().trim().min(1),
        status: z.string().trim().min(1),
      })
      .passthrough(),
    meta: z
      .object({
        reused_existing_draft: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CreateCommunicationRequestResponse = z.infer<
  typeof createCommunicationRequestResponseSchema
>;
