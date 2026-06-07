import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { updatePcaPumpRentalSchema } from '@/lib/validations/pca-pump-rental';

function serializeRental(item: {
  rented_at: Date;
  due_at: Date | null;
  returned_at: Date | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    ...item,
    rented_at: item.rented_at.toISOString().slice(0, 10),
    due_at: item.due_at?.toISOString().slice(0, 10) ?? null,
    returned_at: item.returned_at?.toISOString().slice(0, 10) ?? null,
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}

function toDateKey(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'PCAポンプレンタルの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('PCAポンプレンタルIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePcaPumpRentalSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.pcaPumpRental.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      pump_id: true,
      status: true,
      rented_at: true,
      due_at: true,
      returned_at: true,
    },
  });
  if (!existing) return notFound('PCAポンプレンタルが見つかりません');

  const effectiveRentedAt = parsed.data.rented_at ?? toDateKey(existing.rented_at);
  if (!effectiveRentedAt) {
    return validationError('貸出日が不正です', {
      rented_at: ['貸出日が不正です'],
    });
  }
  const effectiveDueAt =
    parsed.data.due_at !== undefined ? parsed.data.due_at : toDateKey(existing.due_at);
  const effectiveReturnedAt =
    parsed.data.returned_at !== undefined
      ? parsed.data.returned_at
      : toDateKey(existing.returned_at);
  if (effectiveDueAt && effectiveRentedAt > effectiveDueAt) {
    return validationError('返却予定日は貸出日以降の日付を指定してください', {
      due_at: ['返却予定日は貸出日以降の日付を指定してください'],
    });
  }
  if (effectiveReturnedAt && effectiveRentedAt > effectiveReturnedAt) {
    return validationError('返却日は貸出日以降の日付を指定してください', {
      returned_at: ['返却日は貸出日以降の日付を指定してください'],
    });
  }

  if (parsed.data.institution_id) {
    const institution = await prisma.prescriberInstitution.findFirst({
      where: { id: parsed.data.institution_id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!institution) return notFound('貸出先医療機関が見つかりません');
  }

  const updated = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const nextStatus = parsed.data.status;
      if (nextStatus === 'active' || nextStatus === 'scheduled' || nextStatus === 'overdue') {
        const conflictingRental = await tx.pcaPumpRental.findFirst({
          where: {
            org_id: ctx.orgId,
            pump_id: existing.pump_id,
            id: { not: existing.id },
            status: { in: ['scheduled', 'active', 'overdue'] },
          },
          select: { id: true, status: true },
        });
        if (conflictingRental) {
          return {
            kind: 'error' as const,
            error: 'pump_already_has_open_rental' as const,
          };
        }
      }

      const rental = await tx.pcaPumpRental.update({
        where: { id },
        data: {
          ...(parsed.data.institution_id !== undefined
            ? { institution_id: parsed.data.institution_id }
            : {}),
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
          ...(parsed.data.rented_at !== undefined
            ? { rented_at: new Date(parsed.data.rented_at) }
            : {}),
          ...(parsed.data.due_at !== undefined
            ? { due_at: parsed.data.due_at ? new Date(parsed.data.due_at) : null }
            : {}),
          ...(parsed.data.returned_at !== undefined
            ? {
                returned_at: parsed.data.returned_at ? new Date(parsed.data.returned_at) : null,
              }
            : {}),
          ...(parsed.data.contact_name !== undefined
            ? { contact_name: parsed.data.contact_name || null }
            : {}),
          ...(parsed.data.contact_phone !== undefined
            ? { contact_phone: parsed.data.contact_phone || null }
            : {}),
          ...(parsed.data.rental_fee_yen !== undefined
            ? { rental_fee_yen: parsed.data.rental_fee_yen ?? null }
            : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
        },
        include: {
          pump: true,
          institution: true,
        },
      });

      if (nextStatus === 'returned' || nextStatus === 'cancelled') {
        const remainingOpenRental = await tx.pcaPumpRental.findFirst({
          where: {
            org_id: ctx.orgId,
            pump_id: existing.pump_id,
            id: { not: existing.id },
            status: { in: ['scheduled', 'active', 'overdue'] },
          },
          select: { id: true },
        });
        if (!remainingOpenRental) {
          await tx.pcaPump.update({
            where: { id: existing.pump_id },
            data: { status: 'available' },
          });
        }
      } else if (
        nextStatus === 'active' ||
        nextStatus === 'scheduled' ||
        nextStatus === 'overdue'
      ) {
        await tx.pcaPump.update({
          where: { id: existing.pump_id },
          data: { status: 'rented' },
        });
      }

      return { kind: 'rental' as const, rental };
    },
    { requestContext: ctx },
  );

  if (updated.kind === 'error') {
    return validationError('このPCAポンプには未完了の貸出があるため状態を変更できません');
  }

  return success({ data: serializeRental(updated.rental) });
}
