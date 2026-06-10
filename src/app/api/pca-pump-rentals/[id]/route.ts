import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import {
  isCompletePassingPcaPumpAccessoryChecklist,
  updatePcaPumpRentalSchema,
} from '@/lib/validations/pca-pump-rental';
import { syncPcaRentalAccessoriesFromReturnInspection } from '@/server/services/pca-rental-accessories';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { serializePcaPumpRental, toDateKey } from '@/server/services/pca-pump-rental-serialization';

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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

  const existing = await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.pcaPumpRental.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          pump_id: true,
          status: true,
          rented_at: true,
          due_at: true,
          returned_at: true,
          return_inspection_status: true,
          pump: {
            select: {
              status: true,
            },
          },
        },
      }),
    { requestContext: ctx },
  );
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
  const effectiveStatus = parsed.data.status ?? existing.status;
  if (
    (effectiveStatus === 'scheduled' ||
      effectiveStatus === 'active' ||
      effectiveStatus === 'overdue') &&
    !effectiveDueAt
  ) {
    return validationError('貸出中・予定・延滞のPCAポンプには返却予定日が必須です', {
      due_at: ['貸出中・予定・延滞のPCAポンプには返却予定日が必須です'],
    });
  }
  if (effectiveStatus === 'returned' && !effectiveReturnedAt) {
    return validationError('返却済みにする場合は返却日が必須です', {
      returned_at: ['返却済みにする場合は返却日が必須です'],
    });
  }
  if (effectiveReturnedAt && effectiveStatus !== 'returned') {
    return validationError('返却日は返却済み状態でのみ指定できます', {
      returned_at: ['返却日は返却済み状態でのみ指定できます'],
      status: ['返却日を指定する場合は状態を返却済みにしてください'],
    });
  }
  const hasReturnInspectionPayload =
    parsed.data.return_inspection_status !== undefined ||
    parsed.data.return_inspection_notes !== undefined ||
    parsed.data.accessory_checklist !== undefined;
  if (hasReturnInspectionPayload && effectiveStatus !== 'returned') {
    return validationError('返却検品は返却済みレンタルにのみ記録できます', {
      return_inspection_status: ['返却検品は返却済みレンタルにのみ記録できます'],
      status: ['返却検品を記録する場合は状態を返却済みにしてください'],
    });
  }
  if (
    parsed.data.return_inspection_status === 'passed' &&
    !isCompletePassingPcaPumpAccessoryChecklist(parsed.data.accessory_checklist)
  ) {
    return validationError(
      '検品合格には全ての付属品チェックがOKまたは該当なしである必要があります',
      {
        accessory_checklist: [
          '検品合格には全ての付属品チェックがOKまたは該当なしである必要があります',
        ],
      },
    );
  }

  if (parsed.data.institution_id) {
    const institution = await withOrgContext(
      ctx.orgId,
      (tx) =>
        tx.prescriberInstitution.findFirst({
          where: { id: parsed.data.institution_id, org_id: ctx.orgId },
          select: { id: true },
        }),
      { requestContext: ctx },
    );
    if (!institution) return notFound('貸出先医療機関が見つかりません');
  }

  let updated;
  try {
    updated = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const nextStatus = parsed.data.status;
        const returningNow = nextStatus === 'returned' && existing.status !== 'returned';
        const nextInspectionStatus =
          parsed.data.return_inspection_status ?? (returningNow ? 'pending' : undefined);
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

        const rentalUpdateData: Prisma.PcaPumpRentalUncheckedUpdateInput = {
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
          ...(nextInspectionStatus !== undefined
            ? {
                return_inspection_status: nextInspectionStatus,
                ...(nextInspectionStatus === 'passed' ||
                nextInspectionStatus === 'needs_maintenance'
                  ? {
                      inspected_at: new Date(),
                      inspected_by: ctx.userId,
                    }
                  : {
                      inspected_at: null,
                      inspected_by: null,
                    }),
              }
            : {}),
          ...(parsed.data.status !== undefined && parsed.data.status !== 'returned'
            ? {
                return_inspection_status: null,
                return_inspection_notes: null,
                accessory_checklist: Prisma.DbNull,
                inspected_at: null,
                inspected_by: null,
              }
            : {}),
          ...(parsed.data.return_inspection_notes !== undefined
            ? { return_inspection_notes: parsed.data.return_inspection_notes || null }
            : {}),
          ...(parsed.data.accessory_checklist !== undefined
            ? {
                accessory_checklist:
                  parsed.data.accessory_checklist === null
                    ? Prisma.DbNull
                    : toPrismaJson(parsed.data.accessory_checklist),
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
        };

        const rental = await tx.pcaPumpRental.update({
          where: { id },
          data: rentalUpdateData,
          include: {
            accessories: {
              orderBy: [{ created_at: 'asc' }],
            },
            pump: true,
            institution: true,
          },
        });
        if (nextInspectionStatus === 'passed' || nextInspectionStatus === 'needs_maintenance') {
          if (parsed.data.accessory_checklist) {
            await syncPcaRentalAccessoriesFromReturnInspection(tx, {
              orgId: ctx.orgId,
              rentalId: existing.id,
              checklist: parsed.data.accessory_checklist,
            });
          }
          await tx.pcaPumpMaintenanceEvent.create({
            data: {
              org_id: ctx.orgId,
              pump_id: existing.pump_id,
              rental_id: existing.id,
              event_type: 'return_inspection',
              result: nextInspectionStatus === 'passed' ? 'available' : 'maintenance_continues',
              previous_status: existing.pump.status,
              next_status: nextInspectionStatus === 'passed' ? 'available' : 'maintenance',
              performed_by: ctx.userId,
              checklist:
                parsed.data.accessory_checklist === undefined ||
                parsed.data.accessory_checklist === null
                  ? Prisma.DbNull
                  : toPrismaJson(parsed.data.accessory_checklist),
              notes: parsed.data.return_inspection_notes || null,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            org_id: ctx.orgId,
            actor_id: ctx.userId,
            action: 'pca_pump_rental_updated',
            target_type: 'PcaPumpRental',
            target_id: id,
            changes: {
              previous_status: existing.status,
              ...(returningNow && parsed.data.return_inspection_status === undefined
                ? { return_inspection_status: 'pending' }
                : {}),
              ...parsed.data,
            },
            ip_address: req.headers.get('x-forwarded-for') ?? null,
            user_agent: req.headers.get('user-agent') ?? null,
          },
        });

        if (
          nextStatus === 'returned' ||
          nextStatus === 'cancelled' ||
          nextInspectionStatus === 'passed' ||
          nextInspectionStatus === 'needs_maintenance' ||
          nextInspectionStatus === 'pending'
        ) {
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
              data: {
                status:
                  nextStatus === 'cancelled' || nextInspectionStatus === 'passed'
                    ? 'available'
                    : 'maintenance',
              },
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
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      return validationError('このPCAポンプには未完了の貸出があるため状態を変更できません');
    }
    throw error;
  }

  if (updated.kind === 'error') {
    return validationError('このPCAポンプには未完了の貸出があるため状態を変更できません');
  }

  return success({ data: serializePcaPumpRental(updated.rental) });
}
