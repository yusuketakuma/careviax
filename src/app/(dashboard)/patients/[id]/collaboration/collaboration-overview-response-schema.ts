import { z } from 'zod';

export const collaborationOverviewResponseSchema = z
  .object({
    data: z
      .object({
        name: z.string().trim().min(1).max(500),
      })
      .strip(),
  })
  .strict()
  .transform((payload) => payload.data);

export type CollaborationOverview = z.infer<typeof collaborationOverviewResponseSchema>;
