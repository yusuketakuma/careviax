import { withAuthContext } from '@/lib/auth/context';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const createCommunityActivitySchema = z.object({
  activity_type: z.string().trim().min(1, '活動種別は必須です').max(100),
  title: z.string().trim().min(1, 'タイトルは必須です').max(200),
  description: z.string().trim().max(4000).optional(),
  partner_name: z.string().trim().max(200).optional(),
  activity_date: z.string().datetime(),
  target_population: z.string().trim().max(200).optional(),
  attendee_count: z.number().int().min(0).optional(),
  referrals_generated: z.number().int().min(0).optional(),
  follow_up_required: z.boolean().default(false),
  outcome_summary: z.string().trim().max(4000).optional(),
});

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const activityType = searchParams.get('activity_type') ?? undefined;
    const followUpRequired = searchParams.get('follow_up_required');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const items = await prisma.communityActivity.findMany({
      where: {
        org_id: ctx.orgId,
        ...(activityType ? { activity_type: activityType } : {}),
        ...(followUpRequired === null ? {} : { follow_up_required: followUpRequired === 'true' }),
        ...(from || to
          ? {
              activity_date: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ activity_date: 'desc' }, { id: 'desc' }],
    });

    return success(buildCursorPage(items, limit, (item) => item.id));
  },
  {
    permission: 'canReport',
    message: '地域活動の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCommunityActivitySchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await withOrgContext(ctx.orgId, (tx) =>
      tx.communityActivity.create({
        data: {
          org_id: ctx.orgId,
          activity_type: parsed.data.activity_type,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          partner_name: parsed.data.partner_name ?? null,
          activity_date: new Date(parsed.data.activity_date),
          target_population: parsed.data.target_population ?? null,
          attendee_count: parsed.data.attendee_count ?? null,
          referrals_generated: parsed.data.referrals_generated ?? null,
          follow_up_required: parsed.data.follow_up_required,
          outcome_summary: parsed.data.outcome_summary ?? null,
          created_by: ctx.userId,
        },
      }),
    );

    return success({ data: created }, 201);
  },
  {
    permission: 'canReport',
    message: '地域活動の登録権限がありません',
  },
);
