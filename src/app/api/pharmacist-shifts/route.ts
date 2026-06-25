import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { success, validationError } from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import {
  createPharmacistShiftSchema,
  pharmacistShiftQuerySchema,
  toShiftTimeValue,
} from '@/lib/validations/pharmacist-shift';

const DEFAULT_PHARMACIST_SHIFT_LIMIT = 400;
const MAX_PHARMACIST_SHIFT_LIMIT = 500;

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const userId = searchParams.get('user_id');
    const siteId = searchParams.get('site_id');
    const rawLimit = searchParams.get('limit');
    const limit =
      rawLimit === null
        ? undefined
        : parseBoundedInteger(
            rawLimit,
            DEFAULT_PHARMACIST_SHIFT_LIMIT,
            1,
            MAX_PHARMACIST_SHIFT_LIMIT,
          );

    const parsed = pharmacistShiftQuerySchema.safeParse({
      ...(month !== null ? { month } : {}),
      ...(dateFrom !== null ? { date_from: dateFrom } : {}),
      ...(dateTo !== null ? { date_to: dateTo } : {}),
      ...(userId !== null ? { user_id: userId } : {}),
      ...(siteId !== null ? { site_id: siteId } : {}),
    });
    if (!parsed.success) {
      return validationError('検索条件が不正です', parsed.error.flatten().fieldErrors);
    }

    const monthDate = parsed.data.month ? new Date(parsed.data.month) : null;
    const resolvedDateFrom = monthDate
      ? new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
      : parsed.data.date_from
        ? new Date(parsed.data.date_from)
        : null;
    const resolvedDateTo = monthDate
      ? new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)
      : parsed.data.date_to
        ? new Date(parsed.data.date_to)
        : null;

    const shifts = await prisma.pharmacistShift.findMany({
      where: {
        org_id: ctx.orgId,
        ...(resolvedDateFrom || resolvedDateTo
          ? {
              date: {
                ...(resolvedDateFrom ? { gte: resolvedDateFrom } : {}),
                ...(resolvedDateTo ? { lte: resolvedDateTo } : {}),
              },
            }
          : {}),
        ...(parsed.data.user_id ? { user_id: parsed.data.user_id } : {}),
        ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
      },
      orderBy: [{ date: 'asc' }, { available_from: 'asc' }],
      ...(limit === undefined ? {} : { take: limit + 1 }),
      include: {
        user: { select: { id: true, name: true, name_kana: true } },
        site: { select: { id: true, name: true } },
      },
    });

    const hasMore = limit === undefined ? false : shifts.length > limit;
    const data = limit === undefined ? shifts : shifts.slice(0, limit);

    return success({
      data,
      ...(limit === undefined ? {} : { meta: { limit, has_more: hasMore } }),
    });
  },
  {
    permission: 'canVisit',
    message: 'シフト情報の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPharmacistShiftSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { date, available_from, available_to, ...rest } = parsed.data;
    const availableFromValue = toShiftTimeValue(available_from);
    const availableToValue = toShiftTimeValue(available_to);

    const refResult = await validateOrgReferences(ctx.orgId, {
      site_id: rest.site_id,
      pharmacist_id: rest.user_id,
    });
    if (!refResult.ok) return refResult.response;

    const shift = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.pharmacistShift.upsert({
        where: { user_id_date: { user_id: rest.user_id, date: new Date(date) } },
        create: {
          org_id: ctx.orgId,
          date: new Date(date),
          ...(availableFromValue !== undefined ? { available_from: availableFromValue } : {}),
          ...(availableToValue !== undefined ? { available_to: availableToValue } : {}),
          ...rest,
        },
        update: {
          site_id: rest.site_id,
          ...(availableFromValue !== undefined ? { available_from: availableFromValue } : {}),
          ...(availableToValue !== undefined ? { available_to: availableToValue } : {}),
          available: rest.available,
          note: rest.note,
        },
      });
    });

    return success(shift, 201);
  },
  {
    permission: 'canVisit',
    message: 'シフト情報の作成権限がありません',
  },
);
