import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1).max(500);

const communityFollowupSchema = z
  .object({
    id: nonEmptyText,
    title: nonEmptyText,
    activity_type: nonEmptyText,
    partner_name: z.string().trim().max(500).nullable(),
    follow_up_required: z.literal(true),
    referrals_generated: z.number().finite().int().nonnegative().nullable(),
    activity_date: z.string().datetime({ offset: true }),
  })
  .strip();

export const communityFollowupsResponseSchema = z
  .object({
    data: z.array(communityFollowupSchema).max(8),
    meta: z
      .object({
        limit: z.literal(8),
        has_more: z.boolean(),
        next_cursor: z.string().trim().min(1).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    if (meta.has_more !== (meta.next_cursor != null)) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'next_cursor'],
        message: 'Community follow-up cursor and has_more must agree',
      });
    }

    const ids = new Set<string>();
    for (const [index, activity] of data.entries()) {
      if (ids.has(activity.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Community follow-up identities must be unique',
        });
      }
      ids.add(activity.id);
    }
  });

export type CommunityFollowupsResponse = z.infer<typeof communityFollowupsResponseSchema>;
export type CommunityFollowup = CommunityFollowupsResponse['data'][number];
