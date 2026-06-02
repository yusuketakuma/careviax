import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, notFound, validationError } from '@/lib/api/response';
import { optionalBoundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';

const stockQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  drug_master_id: z.string().trim().optional(),
  q: z.string().trim().optional(),
  limit: optionalBoundedIntegerSearchParam('limit', 1, 200),
  review_due: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  missing_reorder_point: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|[+-]\d{2}:\d{2})$/;

function buildValidUtcDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
) {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }
  return date;
}

function parseFollowUpDueDate(value: string) {
  const dateKeyMatch = value.match(DATE_KEY_PATTERN);
  if (dateKeyMatch) {
    const [, year, month, day] = dateKeyMatch;
    return buildValidUtcDate(Number(year), Number(month), Number(day));
  }

  const dateTimeMatch = value.match(ISO_DATE_TIME_PATTERN);
  if (!dateTimeMatch) return null;

  const [, year, month, day, hour, minute, second, millisecond = '000', offset] = dateTimeMatch;
  const localDate = buildValidUtcDate(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond),
  );
  if (!localDate) return null;

  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

const followUpDueDateSchema = z
  .unknown()
  .optional()
  .transform((value, ctx) => {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'follow_up_due_date は YYYY-MM-DD または ISO日時で指定してください',
      });
      return z.NEVER;
    }

    const normalized = value.trim();
    if (normalized.length === 0) return null;

    const parsed = parseFollowUpDueDate(normalized);
    if (!parsed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'follow_up_due_date は YYYY-MM-DD または ISO日時で指定してください',
      });
      return z.NEVER;
    }

    return parsed;
  });

const upsertStockSchema = z.object({
  site_id: z.string().min(1, 'site_id は必須です'),
  drug_master_id: z.string().min(1, 'drug_master_id は必須です'),
  is_stocked: z.boolean().default(true),
  reorder_point: z.number().int().min(0).nullable().optional(),
  preferred_generic_id: z.string().trim().nullable().optional(),
  adoption_source: z.enum(['manual', 'csv', 'demo_seed', 'mhlw_review']).default('manual'),
  adoption_note: z.string().trim().max(500).nullable().optional(),
  mark_reviewed: z.boolean().default(false),
  follow_up_status: z
    .enum(['active', 'needs_review', 'planned_switch', 'monitoring', 'resolved'])
    .nullable()
    .optional(),
  follow_up_reason: z.string().trim().max(500).nullable().optional(),
  follow_up_due_date: followUpDueDateSchema,
});

const STOCK_REVIEW_INTERVAL_DAYS = 180;

const stockSelect = {
  id: true,
  site_id: true,
  drug_master_id: true,
  is_stocked: true,
  stock_qty: true,
  reorder_point: true,
  preferred_generic_id: true,
  adoption_source: true,
  adoption_note: true,
  last_reviewed_at: true,
  reviewed_by_id: true,
  follow_up_status: true,
  follow_up_reason: true,
  follow_up_due_date: true,
  follow_up_resolved_at: true,
  updated_at: true,
  preferred_generic: {
    select: {
      id: true,
      drug_name: true,
      yj_code: true,
    },
  },
} as const;

export const GET = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const { searchParams } = new URL(req.url);
    const parsed = parseSearchParams(stockQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const site = await prisma.pharmacySite.findFirst({
      where: {
        id: parsed.data.site_id,
        org_id: authCtx.orgId,
      },
      select: {
        id: true,
        name: true,
      },
    });
    if (!site) return notFound('対象の薬局拠点が見つかりません');

    if (parsed.data.drug_master_id) {
      const stock = await prisma.pharmacyDrugStock.findFirst({
        where: {
          org_id: authCtx.orgId,
          site_id: site.id,
          drug_master_id: parsed.data.drug_master_id,
        },
        select: stockSelect,
      });

      return success({
        site,
        data: stock,
      });
    }

    const reviewCutoff = new Date();
    reviewCutoff.setDate(reviewCutoff.getDate() - STOCK_REVIEW_INTERVAL_DAYS);
    const stocked = await prisma.pharmacyDrugStock.findMany({
      where: {
        org_id: authCtx.orgId,
        site_id: site.id,
        is_stocked: true,
        ...(parsed.data.missing_reorder_point ? { reorder_point: null } : {}),
        ...(parsed.data.review_due
          ? {
              OR: [{ last_reviewed_at: null }, { last_reviewed_at: { lt: reviewCutoff } }],
            }
          : {}),
        ...(parsed.data.q
          ? {
              drug_master: {
                OR: [
                  { drug_name: { contains: parsed.data.q } },
                  { generic_name: { contains: parsed.data.q } },
                  { tall_man_name: { contains: parsed.data.q } },
                  { manufacturer: { contains: parsed.data.q } },
                  { yj_code: { startsWith: parsed.data.q } },
                  { receipt_code: { startsWith: parsed.data.q } },
                  { hot_code: { startsWith: parsed.data.q } },
                  { jan_code: { startsWith: parsed.data.q } },
                ],
              },
            }
          : {}),
      },
      orderBy: [{ updated_at: 'desc' }],
      take: parsed.data.limit ?? 50,
      select: {
        id: true,
        site_id: true,
        drug_master_id: true,
        is_stocked: true,
        stock_qty: true,
        reorder_point: true,
        preferred_generic_id: true,
        adoption_source: true,
        adoption_note: true,
        last_reviewed_at: true,
        reviewed_by_id: true,
        follow_up_status: true,
        follow_up_reason: true,
        follow_up_due_date: true,
        follow_up_resolved_at: true,
        updated_at: true,
        drug_master: {
          select: {
            id: true,
            drug_name: true,
            yj_code: true,
            drug_price: true,
            unit: true,
            is_generic: true,
            is_narcotic: true,
            is_psychotropic: true,
            is_high_risk: true,
            is_lasa_risk: true,
            transitional_expiry_date: true,
          },
        },
        preferred_generic: {
          select: {
            id: true,
            drug_name: true,
            yj_code: true,
          },
        },
      },
    });

    return success({
      site,
      data: stocked,
    });
  },
  { permission: 'canAdmin' },
);

export const POST = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = upsertStockSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      site_id,
      drug_master_id,
      is_stocked,
      reorder_point,
      preferred_generic_id,
      adoption_source,
      adoption_note,
      mark_reviewed,
      follow_up_status,
      follow_up_reason,
      follow_up_due_date,
    } = parsed.data;

    const [site, targetDrug, preferredGeneric] = await Promise.all([
      prisma.pharmacySite.findFirst({
        where: {
          id: site_id,
          org_id: authCtx.orgId,
        },
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.drugMaster.findFirst({
        where: { id: drug_master_id },
        select: {
          id: true,
          drug_name: true,
          generic_name: true,
          is_generic: true,
        },
      }),
      preferred_generic_id
        ? prisma.drugMaster.findFirst({
            where: { id: preferred_generic_id },
            select: {
              id: true,
              drug_name: true,
              yj_code: true,
              is_generic: true,
              generic_name: true,
            },
          })
        : Promise.resolve(null),
    ]);

    if (!site) return notFound('対象の薬局拠点が見つかりません');
    if (!targetDrug) return notFound('対象の医薬品が見つかりません');

    if (preferred_generic_id && !preferredGeneric) {
      return validationError('採用後発薬が見つかりません', {
        preferred_generic_id: ['存在する後発品を選択してください'],
      });
    }

    if (preferredGeneric && preferredGeneric.id === targetDrug.id) {
      return validationError('採用後発薬に対象薬自身は指定できません', {
        preferred_generic_id: ['対象薬とは別の後発品を選択してください'],
      });
    }

    if (preferredGeneric && !preferredGeneric.is_generic) {
      return validationError('採用後発薬には後発品のみ指定できます', {
        preferred_generic_id: ['後発品を選択してください'],
      });
    }

    if (
      preferredGeneric &&
      targetDrug.generic_name &&
      preferredGeneric.generic_name &&
      targetDrug.generic_name !== preferredGeneric.generic_name
    ) {
      return validationError('採用後発薬は同一一般名から選択してください', {
        preferred_generic_id: ['同じ一般名の後発品を選択してください'],
      });
    }

    const existingStock = await prisma.pharmacyDrugStock.findFirst({
      where: {
        org_id: authCtx.orgId,
        site_id,
        drug_master_id,
      },
      select: {
        id: true,
        is_stocked: true,
        reorder_point: true,
        preferred_generic_id: true,
        adoption_source: true,
        adoption_note: true,
        last_reviewed_at: true,
        follow_up_status: true,
        follow_up_reason: true,
        follow_up_due_date: true,
        follow_up_resolved_at: true,
      },
    });
    const reviewedAt = mark_reviewed ? new Date() : undefined;
    const resolvedAt = follow_up_status === 'resolved' ? new Date() : null;

    const stock = await prisma.$transaction(async (tx) => {
      const saved = await tx.pharmacyDrugStock.upsert({
        where: {
          site_id_drug_master_id: {
            site_id,
            drug_master_id,
          },
        },
        create: {
          org_id: authCtx.orgId,
          site_id,
          drug_master_id,
          is_stocked,
          reorder_point: reorder_point ?? null,
          preferred_generic_id: preferredGeneric?.id ?? null,
          adoption_source,
          adoption_note: adoption_note ?? null,
          last_reviewed_at: reviewedAt,
          reviewed_by_id: reviewedAt ? authCtx.userId : null,
          follow_up_status: follow_up_status ?? null,
          follow_up_reason: follow_up_reason ?? null,
          follow_up_due_date: follow_up_due_date ?? null,
          follow_up_resolved_at: resolvedAt,
        },
        update: {
          is_stocked,
          reorder_point: reorder_point ?? null,
          preferred_generic_id: preferredGeneric?.id ?? null,
          adoption_source,
          adoption_note: adoption_note ?? null,
          ...(follow_up_status !== undefined
            ? {
                follow_up_status,
                follow_up_reason: follow_up_reason ?? null,
                follow_up_due_date: follow_up_due_date ?? null,
                follow_up_resolved_at: resolvedAt,
              }
            : {}),
          ...(reviewedAt
            ? {
                last_reviewed_at: reviewedAt,
                reviewed_by_id: authCtx.userId,
              }
            : {}),
        },
        select: stockSelect,
      });

      await tx.auditLog.create({
        data: {
          org_id: authCtx.orgId,
          actor_id: authCtx.userId,
          action: existingStock ? 'pharmacy_drug_stock_updated' : 'pharmacy_drug_stock_created',
          target_type: 'PharmacyDrugStock',
          target_id: saved.id,
          changes: {
            site_id,
            drug_master_id,
            before: existingStock,
            after: {
              is_stocked,
              reorder_point: reorder_point ?? null,
              preferred_generic_id: preferredGeneric?.id ?? null,
              adoption_source,
              adoption_note: adoption_note ?? null,
              mark_reviewed,
              follow_up_status: follow_up_status ?? null,
              follow_up_reason: follow_up_reason ?? null,
              follow_up_due_date: follow_up_due_date?.toISOString() ?? null,
            },
          },
          ip_address: authCtx.ipAddress,
          user_agent: authCtx.userAgent,
        },
      });

      return saved;
    });

    return success({
      site,
      data: stock,
    });
  },
  { permission: 'canAdmin' },
);
