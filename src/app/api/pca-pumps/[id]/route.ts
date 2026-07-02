import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { pcaPumpOpenRentalStatuses, updatePcaPumpSchema } from '@/lib/validations/pca-pump-rental';
import { serializePcaPump } from '@/server/services/pca-pump-serialization';

const ROUTE = '/api/pca-pumps/[id]';

function inferMaintenanceEvent(payload: {
  status?: 'available' | 'rented' | 'maintenance' | 'retired';
  maintenance_event_type?:
    | 'manual_status_change'
    | 'return_inspection'
    | 'maintenance_completed'
    | 'repair_required';
  maintenance_result?: 'available' | 'maintenance_continues' | 'retired';
}) {
  if (!payload.status || payload.status === 'rented') return null;

  if (payload.maintenance_event_type && payload.maintenance_result) {
    return {
      event_type: payload.maintenance_event_type,
      result: payload.maintenance_result,
    };
  }

  if (payload.status === 'available') {
    return { event_type: 'maintenance_completed' as const, result: 'available' as const };
  }
  if (payload.status === 'maintenance') {
    return {
      event_type: 'manual_status_change' as const,
      result: 'maintenance_continues' as const,
    };
  }
  return { event_type: 'manual_status_change' as const, result: 'retired' as const };
}

async function authenticatedPATCH(req: NextRequest, params: Promise<{ id: string }>) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'PCAポンプ台帳の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  return runWithRequestAuthContext(ctx, async () => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('PCAポンプIDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updatePcaPumpSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const existing = await tx.pcaPump.findFirst({
          where: { id, org_id: ctx.orgId },
          select: {
            id: true,
            status: true,
            updated_at: true,
            rentals: {
              where: {
                status: 'returned',
                return_inspection_status: 'pending',
              },
              select: { id: true },
              take: 1,
            },
            _count: {
              select: {
                rentals: {
                  where: { status: { in: [...pcaPumpOpenRentalStatuses] } },
                },
              },
            },
          },
        });
        if (!existing) return { kind: 'not_found' as const };
        if (parsed.data.status && parsed.data.status !== 'rented' && existing._count.rentals > 0) {
          return { kind: 'open_rental' as const };
        }
        if (parsed.data.status === 'available' && existing.rentals.length > 0) {
          return { kind: 'pending_return_inspection' as const };
        }
        const maintenance_notes = parsed.data.maintenance_notes;
        const pumpUpdatePayload = {
          asset_code: parsed.data.asset_code,
          serial_number: parsed.data.serial_number,
          model_name: parsed.data.model_name,
          manufacturer: parsed.data.manufacturer,
          status: parsed.data.status,
          maintenance_due_at: parsed.data.maintenance_due_at,
          notes: parsed.data.notes,
        };
        const maintenanceEvent = inferMaintenanceEvent(parsed.data);
        const shouldCreateMaintenanceEvent =
          maintenanceEvent !== null && parsed.data.status !== existing.status;
        const pumpAuditChanges = Object.fromEntries(
          Object.entries(pumpUpdatePayload).filter(([, value]) => value !== undefined),
        );
        const pumpUpdateData: Prisma.PcaPumpUncheckedUpdateManyInput = {
          ...(pumpUpdatePayload.asset_code !== undefined
            ? { asset_code: pumpUpdatePayload.asset_code }
            : {}),
          ...(pumpUpdatePayload.serial_number !== undefined
            ? { serial_number: pumpUpdatePayload.serial_number || null }
            : {}),
          ...(pumpUpdatePayload.model_name !== undefined
            ? { model_name: pumpUpdatePayload.model_name }
            : {}),
          ...(pumpUpdatePayload.manufacturer !== undefined
            ? { manufacturer: pumpUpdatePayload.manufacturer || null }
            : {}),
          ...(pumpUpdatePayload.status !== undefined ? { status: pumpUpdatePayload.status } : {}),
          ...(pumpUpdatePayload.maintenance_due_at !== undefined
            ? {
                maintenance_due_at: pumpUpdatePayload.maintenance_due_at
                  ? new Date(pumpUpdatePayload.maintenance_due_at)
                  : null,
              }
            : {}),
          ...(pumpUpdatePayload.notes !== undefined
            ? { notes: pumpUpdatePayload.notes || null }
            : {}),
        };
        const disallowedRentalClauses: Prisma.PcaPumpRentalWhereInput[] = [];
        if (parsed.data.status && parsed.data.status !== 'rented') {
          disallowedRentalClauses.push({
            status: { in: [...pcaPumpOpenRentalStatuses] },
          });
        }
        if (parsed.data.status === 'available') {
          disallowedRentalClauses.push({
            status: 'returned',
            return_inspection_status: 'pending',
          });
        }
        const claim = await tx.pcaPump.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
            status: existing.status,
            updated_at: existing.updated_at,
            ...(disallowedRentalClauses.length > 0
              ? {
                  rentals: {
                    none:
                      disallowedRentalClauses.length === 1
                        ? disallowedRentalClauses[0]
                        : { OR: disallowedRentalClauses },
                  },
                }
              : {}),
          },
          data: pumpUpdateData,
        });
        if (claim.count !== 1) return { kind: 'stale_update' as const };

        const pump = await tx.pcaPump.findFirst({ where: { id, org_id: ctx.orgId } });
        if (!pump) return { kind: 'not_found' as const };

        if (shouldCreateMaintenanceEvent) {
          await tx.pcaPumpMaintenanceEvent.create({
            data: {
              org_id: ctx.orgId,
              pump_id: id,
              event_type: maintenanceEvent.event_type,
              result: maintenanceEvent.result,
              previous_status: existing.status,
              next_status: parsed.data.status,
              performed_by: ctx.userId,
              notes: maintenance_notes || null,
              next_maintenance_due_at: parsed.data.maintenance_due_at
                ? new Date(parsed.data.maintenance_due_at)
                : null,
            },
          });
        }
        await createAuditLogEntry(tx, ctx, {
          action: 'pca_pump_updated',
          targetType: 'PcaPump',
          targetId: id,
          changes: {
            ...pumpAuditChanges,
            ...(shouldCreateMaintenanceEvent
              ? {
                  maintenance_event_type: maintenanceEvent?.event_type,
                  maintenance_result: maintenanceEvent?.result,
                }
              : {}),
            ...(maintenance_notes !== undefined ? { maintenance_notes } : {}),
          },
        });
        return { kind: 'pump' as const, pump };
      },
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    if (result.kind === 'not_found') return notFound('PCAポンプが見つかりません');
    if (result.kind === 'open_rental') {
      return validationError('未完了の貸出があるPCAポンプは利用可能・点検・退役へ変更できません');
    }
    if (result.kind === 'pending_return_inspection') {
      return validationError('返却検品が未完了のPCAポンプは利用可能にできません');
    }
    if (result.kind === 'stale_update') {
      return conflict('PCAポンプが他の操作で更新されています。最新の状態を再読み込みしてください');
    }

    return success({ data: serializePcaPump(result.pump) });
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPATCH(req, params));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'route_handler_unhandled_error',
          route: ROUTE,
          method: 'PATCH',
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}

async function authenticatedDELETE(req: NextRequest, params: Promise<{ id: string }>) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'PCAポンプ台帳の削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  return runWithRequestAuthContext(ctx, async () => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('PCAポンプIDが不正です');

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const existing = await tx.pcaPump.findFirst({
          where: { id, org_id: ctx.orgId },
          select: { id: true, _count: { select: { rentals: true } } },
        });
        if (!existing) return { kind: 'not_found' as const };
        if (existing._count.rentals > 0) return { kind: 'has_rental_history' as const };

        await tx.pcaPump.delete({ where: { id } });
        await createAuditLogEntry(tx, ctx, {
          action: 'pca_pump_deleted',
          targetType: 'PcaPump',
          targetId: id,
          changes: { id },
        });
        return { kind: 'deleted' as const };
      },
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    if (result.kind === 'not_found') return notFound('PCAポンプが見つかりません');
    if (result.kind === 'has_rental_history') {
      return validationError('貸出履歴があるPCAポンプは削除できません。退役に変更してください');
    }

    return success({ data: { id } });
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedDELETE(req, params));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'route_handler_unhandled_error',
          route: ROUTE,
          method: 'DELETE',
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
