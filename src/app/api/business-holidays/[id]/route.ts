import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { notFound, success, validationError } from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { updateBusinessHolidaySchema } from '@/lib/validations/business-holiday';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '休日設定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateBusinessHolidaySchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const holidayId = normalizeRequiredRouteParam(id);
  if (!holidayId) return validationError('休日設定IDが不正です');

  const existing = await prisma.businessHoliday.findFirst({
    where: { id: holidayId, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('休日設定が見つかりません');

  const refResult = await validateOrgReferences(ctx.orgId, {
    ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
  });
  if (!refResult.ok) return refResult.response;

  const duplicate = await prisma.businessHoliday.findFirst({
    where: {
      org_id: ctx.orgId,
      id: { not: holidayId },
      date: new Date(parsed.data.date),
      site_id: parsed.data.site_id ?? null,
      holiday_type: parsed.data.holiday_type,
    },
    select: { id: true },
  });
  if (duplicate) {
    return validationError('同じ日の休日設定が既に存在します');
  }

  const holiday = await withOrgContext(ctx.orgId, async (tx) => {
    const updated = await tx.businessHoliday.update({
      where: { id: holidayId },
      data: {
        site_id: parsed.data.site_id ?? null,
        date: new Date(parsed.data.date),
        name: parsed.data.name,
        holiday_type: parsed.data.holiday_type,
        is_closed: parsed.data.is_closed,
      },
    });

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'business_holiday_updated',
        target_type: 'BusinessHoliday',
        target_id: holidayId,
        changes: {
          date: parsed.data.date,
          site_id: parsed.data.site_id ?? null,
          holiday_type: parsed.data.holiday_type,
          is_closed: parsed.data.is_closed,
        },
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });

    return updated;
  });

  return success({ data: holiday });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '休日設定の削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;
  const holidayId = normalizeRequiredRouteParam(id);
  if (!holidayId) return validationError('休日設定IDが不正です');

  const existing = await prisma.businessHoliday.findFirst({
    where: { id: holidayId, org_id: ctx.orgId },
    select: { id: true, name: true },
  });
  if (!existing) return notFound('休日設定が見つかりません');

  await withOrgContext(ctx.orgId, async (tx) => {
    await tx.businessHoliday.delete({
      where: { id: holidayId },
    });

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'business_holiday_deleted',
        target_type: 'BusinessHoliday',
        target_id: holidayId,
        changes: {
          name: existing.name,
        },
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });
  });

  return success({ ok: true });
}
