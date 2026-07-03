import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { withOrgContext } from '@/lib/db/rls';
import { acquireAdvisoryTxLock } from '@/lib/db/advisory-lock';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { createBusinessHolidaySchema } from '@/lib/validations/business-holiday';
import { dateKeySchema } from '@/lib/validations/date-key';
import { z } from 'zod';

const DEFAULT_BUSINESS_HOLIDAY_LIMIT = 100;
const MAX_BUSINESS_HOLIDAY_LIMIT = 400;

const businessHolidayQuerySchema = z
  .object({
    date_from: dateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
    date_to: dateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
    site_id: z.string().trim().min(1, 'site_id が不正です').max(100).optional(),
  })
  .refine((value) => !value.date_from || !value.date_to || value.date_to >= value.date_from, {
    path: ['date_to'],
    message: 'date_to は date_from 以降を指定してください',
  });

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsed = businessHolidayQuerySchema.safeParse({
      ...(searchParams.has('date_from') ? { date_from: searchParams.get('date_from') } : {}),
      ...(searchParams.has('date_to') ? { date_to: searchParams.get('date_to') } : {}),
      ...(searchParams.has('site_id') ? { site_id: searchParams.get('site_id') } : {}),
    });
    if (!parsed.success) {
      return validationError('検索条件が不正です', parsed.error.flatten().fieldErrors);
    }
    const limit = parseBoundedInteger(
      searchParams.get('limit'),
      DEFAULT_BUSINESS_HOLIDAY_LIMIT,
      1,
      MAX_BUSINESS_HOLIDAY_LIMIT,
    );

    const holidays = await prisma.businessHoliday.findMany({
      where: {
        org_id: ctx.orgId,
        ...(parsed.data.date_from || parsed.data.date_to
          ? {
              date: {
                ...(parsed.data.date_from ? { gte: new Date(parsed.data.date_from) } : {}),
                ...(parsed.data.date_to ? { lte: new Date(parsed.data.date_to) } : {}),
              },
            }
          : {}),
        ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
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
      take: limit,
    });

    return success({ data: holidays });
  },
  {
    permission: 'canAdmin',
    message: '休日設定の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

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

    // 一意性 (org, date, site, holiday_type) は DB partial-unique 未整備のため、
    // tx 内で advisory lock → 再存在チェック → create の順に直列化して
    // 同時作成でも重複行が生まれない形にする（本質解決は W1-7 の DB 制約）。
    const dedupKey = `${ctx.orgId}:${parsed.data.site_id ?? ''}:${parsed.data.date}:${parsed.data.holiday_type}`;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      await acquireAdvisoryTxLock(tx, 'business_holiday_dedup', dedupKey);

      const existing = await tx.businessHoliday.findFirst({
        where: {
          org_id: ctx.orgId,
          date: new Date(parsed.data.date),
          site_id: parsed.data.site_id ?? null,
          holiday_type: parsed.data.holiday_type,
        },
        select: { id: true },
      });
      if (existing) {
        return { duplicate: true as const };
      }

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

      return { duplicate: false as const, holiday: created };
    });

    if (result.duplicate) {
      return validationError('同じ日の休日設定が既に存在します');
    }

    return success(result.holiday, 201);
  },
  {
    permission: 'canAdmin',
    message: '休日設定の作成権限がありません',
  },
);
