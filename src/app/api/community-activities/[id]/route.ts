import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const patchCommunityActivitySchema = z.object({
  activity_type: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  partner_name: z.string().trim().max(200).nullable().optional(),
  activity_date: z.string().datetime().optional(),
  target_population: z.string().trim().max(200).nullable().optional(),
  attendee_count: z.number().int().min(0).nullable().optional(),
  referrals_generated: z.number().int().min(0).nullable().optional(),
  follow_up_required: z.boolean().optional(),
  outcome_summary: z.string().trim().max(4000).nullable().optional(),
});

export const PATCH = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext) => {
    const { id } = await routeContext.params;
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = patchCommunityActivitySchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.communityActivity.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!existing) return notFound('地域活動が見つかりません');

    const updated = await withOrgContext(ctx.orgId, (tx) =>
      tx.communityActivity.update({
        where: { id },
        data: {
          ...parsed.data,
          ...(parsed.data.activity_date
            ? { activity_date: new Date(parsed.data.activity_date) }
            : {}),
        },
      }),
    );

    return success({ data: updated });
  },
  {
    permission: 'canReport',
    message: '地域活動の更新権限がありません',
  },
);
