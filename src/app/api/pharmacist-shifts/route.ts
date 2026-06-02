import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { createPharmacistShiftSchema, toShiftTimeValue } from '@/lib/validations/pharmacist-shift';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const userId = searchParams.get('user_id');
    const siteId = searchParams.get('site_id');

    const monthDate = month ? new Date(month) : null;
    const resolvedDateFrom =
      monthDate && !Number.isNaN(monthDate.getTime())
        ? new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
        : dateFrom
          ? new Date(dateFrom)
          : null;
    const resolvedDateTo =
      monthDate && !Number.isNaN(monthDate.getTime())
        ? new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)
        : dateTo
          ? new Date(dateTo)
          : null;

    const shifts = await prisma.pharmacistShift.findMany({
      where: {
        org_id: req.orgId,
        ...(resolvedDateFrom || resolvedDateTo
          ? {
              date: {
                ...(resolvedDateFrom ? { gte: resolvedDateFrom } : {}),
                ...(resolvedDateTo ? { lte: resolvedDateTo } : {}),
              },
            }
          : {}),
        ...(userId ? { user_id: userId } : {}),
        ...(siteId ? { site_id: siteId } : {}),
      },
      orderBy: [{ date: 'asc' }, { available_from: 'asc' }],
      include: {
        user: { select: { id: true, name: true, name_kana: true } },
        site: { select: { id: true, name: true } },
      },
    });

    return success({ data: shifts });
  },
  {
    permission: 'canVisit',
    message: 'シフト情報の閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPharmacistShiftSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { date, available_from, available_to, ...rest } = parsed.data;
    const availableFromValue = toShiftTimeValue(available_from);
    const availableToValue = toShiftTimeValue(available_to);

    const refResult = await validateOrgReferences(req.orgId, {
      site_id: rest.site_id,
      pharmacist_id: rest.user_id,
    });
    if (!refResult.ok) return refResult.response;

    const shift = await withOrgContext(req.orgId, async (tx) => {
      return tx.pharmacistShift.upsert({
        where: { user_id_date: { user_id: rest.user_id, date: new Date(date) } },
        create: {
          org_id: req.orgId,
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
