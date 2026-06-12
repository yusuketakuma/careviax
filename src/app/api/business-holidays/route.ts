import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { createBusinessHolidaySchema } from '@/lib/validations/business-holiday';

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const siteId = searchParams.get('site_id');

    const holidays = await prisma.businessHoliday.findMany({
      where: {
        org_id: ctx.orgId,
        ...(dateFrom || dateTo
          ? {
              date: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {}),
              },
            }
          : {}),
        ...(siteId ? { site_id: siteId } : {}),
      },
      include: {
        site: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ date: 'asc' }],
    });

    return success({ data: holidays });
  },
  {
    permission: 'canAdmin',
    message: '休日設定の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createBusinessHolidaySchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const refResult = await validateOrgReferences(ctx.orgId, {
      ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
    });
    if (!refResult.ok) return refResult.response;

    const existing = await prisma.businessHoliday.findFirst({
      where: {
        org_id: ctx.orgId,
        date: new Date(parsed.data.date),
        site_id: parsed.data.site_id ?? null,
        holiday_type: parsed.data.holiday_type,
      },
      select: { id: true },
    });
    if (existing) {
      return validationError('同じ日の休日設定が既に存在します');
    }

    const holiday = await withOrgContext(ctx.orgId, async (tx) => {
      const created = await tx.businessHoliday.create({
        data: {
          org_id: ctx.orgId,
          site_id: parsed.data.site_id ?? null,
          date: new Date(parsed.data.date),
          name: parsed.data.name,
          holiday_type: parsed.data.holiday_type,
          is_closed: parsed.data.is_closed,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'business_holiday_created',
        targetType: 'BusinessHoliday',
        targetId: created.id,
        changes: {
          date: parsed.data.date,
          site_id: parsed.data.site_id ?? null,
          holiday_type: parsed.data.holiday_type,
          is_closed: parsed.data.is_closed,
        },
      });

      return created;
    });

    return success(holiday, 201);
  },
  {
    permission: 'canAdmin',
    message: '休日設定の作成権限がありません',
  },
);
