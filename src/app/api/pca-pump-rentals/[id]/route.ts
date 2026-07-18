import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { allocateDisplayId } from '@/lib/db/display-id';
import { withOrgContext } from '@/lib/db/rls';
import { runSequentially } from '@/lib/utils/concurrency';
import {
  isCompletePassingPcaPumpAccessoryChecklist,
  pcaPumpOpenRentalStatuses,
  updatePcaPumpRentalSchema,
} from '@/lib/validations/pca-pump-rental';
import { syncPcaRentalAccessoriesFromReturnInspection } from '@/server/services/pca-rental-accessories';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { serializePcaPumpRental, toDateKey } from '@/server/services/pca-pump-rental-serialization';

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function findPcaPumpRentalProjection(
  tx: Prisma.TransactionClient,
  args: { orgId: string; rentalId: string },
) {
  const rental = await tx.pcaPumpRental.findFirst({
    where: { id: args.rentalId, org_id: args.orgId },
  });
  if (!rental) return null;

  const [accessories, pump, institution] = await runSequentially([
    () =>
      tx.pcaPumpRentalAccessory.findMany({
        where: { org_id: args.orgId, rental_id: rental.id },
        orderBy: [{ created_at: 'asc' }],
      }),
    () =>
      tx.pcaPump.findFirst({
        where: { id: rental.pump_id, org_id: args.orgId },
      }),
    () =>
      tx.prescriberInstitution.findFirst({
        where: { id: rental.institution_id, org_id: args.orgId },
      }),
  ]);
  if (!pump || !institution) {
    throw new Error('PCA rental relation projection is incomplete');
  }

  return { ...rental, accessories, pump, institution };
}

async function authenticatedPATCHHandler(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
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
    async (tx) => {
      const rental = await tx.pcaPumpRental.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          pump_id: true,
          status: true,
          rented_at: true,
          due_at: true,
          returned_at: true,
          return_inspection_status: true,
          updated_at: true,
        },
      });
      if (!rental) return null;
      const pump = await tx.pcaPump.findFirst({
        where: { id: rental.pump_id, org_id: ctx.orgId },
        select: { status: true },
      });
      if (!pump) throw new Error('PCA rental pump projection is incomplete');
      return { ...rental, pump };
    },
    { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
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
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );
    if (!institution) {
      return validationError('入力値が不正です', {
        institution_id: ['指定された貸出先医療機関を確認できません'],
      });
    }
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
              status: { in: [...pcaPumpOpenRentalStatuses] },
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

        const claim = await tx.pcaPumpRental.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
            status: existing.status,
            updated_at: existing.updated_at,
          },
          data: rentalUpdateData,
        });
        if (claim.count !== 1) {
          return {
            kind: 'error' as const,
            error: 'rental_stale_update' as const,
          };
        }

        const rental = await findPcaPumpRentalProjection(tx, {
          orgId: ctx.orgId,
          rentalId: id,
        });
        if (!rental) {
          return {
            kind: 'error' as const,
            error: 'rental_not_found_after_update' as const,
          };
        }
        if (nextInspectionStatus === 'passed' || nextInspectionStatus === 'needs_maintenance') {
          if (parsed.data.accessory_checklist) {
            await syncPcaRentalAccessoriesFromReturnInspection(tx, {
              orgId: ctx.orgId,
              rentalId: existing.id,
              checklist: parsed.data.accessory_checklist,
            });
          }
          const maintenanceEventDisplayId = await allocateDisplayId(
            tx,
            'PcaPumpMaintenanceEvent',
            ctx.orgId,
          );
          await tx.pcaPumpMaintenanceEvent.create({
            data: {
              org_id: ctx.orgId,
              display_id: maintenanceEventDisplayId,
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
        await createAuditLogEntry(tx, ctx, {
          action: 'pca_pump_rental_updated',
          targetType: 'PcaPumpRental',
          targetId: id,
          changes: {
            previous_status: existing.status,
            ...(returningNow && parsed.data.return_inspection_status === undefined
              ? { return_inspection_status: 'pending' }
              : {}),
            ...parsed.data,
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
              status: { in: [...pcaPumpOpenRentalStatuses] },
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
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      return validationError('このPCAポンプには未完了の貸出があるため状態を変更できません');
    }
    throw error;
  }

  if (updated.kind === 'error') {
    if (updated.error === 'rental_stale_update') {
      return conflict(
        'PCAポンプレンタルが他の操作で更新されています。最新の状態を再読み込みしてください',
      );
    }
    if (updated.error === 'rental_not_found_after_update') {
      return notFound('PCAポンプレンタルが見つかりません');
    }
    return validationError('このPCAポンプには未完了の貸出があるため状態を変更できません');
  }

  return success({ data: serializePcaPumpRental(updated.rental) });
}

const authenticatedPATCH = withAuthContext(authenticatedPATCHHandler, {
  permission: 'canAdmin',
  message: 'PCAポンプレンタルの更新権限がありません',
});

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
