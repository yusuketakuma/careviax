import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { formatUtcDateKey } from '@/lib/date-key';
import { withOrgContext } from '@/lib/db/rls';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import {
  success,
  validationError,
  notFound,
  forbiddenResponse,
  conflict,
  internalError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import {
  buildVisitScheduleAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';
import { scheduleStatusValues, visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { findVisitRouteOrderConflict } from '@/lib/visits/route-order-conflicts';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { validateScheduleTimeDatesFitShift } from '@/server/services/visit-schedule-shift';
import { createRoadTravelEstimator } from '@/server/services/road-routing';
import { buildVehicleRoutePoint } from '@/server/services/visit-schedule-service';
import {
  estimateVehicleRouteDurationWithCandidate,
  type VehicleRouteDurationPoint,
} from '@/server/services/visit-schedule-planner';
import type { VisitRouteTravelMode } from '@/types/visit-route';

const VISIT_SCHEDULE_REORDER_SERIALIZABLE_RETRY_LIMIT = 3;

const VEHICLE_ASSIGNABLE_STATUSES = new Set([
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
]);
const ROUTE_REORDERABLE_STATUSES = VEHICLE_ASSIGNABLE_STATUSES;

const routeOrderConfirmationContextSchema = z.object({
  source: z.enum([
    'schedule_day_route_preview',
    'schedule_conflict_resolution',
    'route_compare_adoption',
    'emergency_route_interruption',
  ]),
  date: visitScheduleDateKeySchema('確認日付の形式が不正です（YYYY-MM-DD）').optional(),
  pharmacist_id: z.string().trim().min(1).max(100).optional(),
  travel_mode: z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']).optional(),
  target_count: z.number().int().min(1).max(100).optional(),
  route_order_diff_count: z.number().int().min(0).max(100).optional(),
  vehicle_assignment_count: z.number().int().min(0).max(100).optional(),
  released_schedule_id: z.string().trim().min(1).max(100).optional(),
  patient_reconfirmation_required: z.boolean().optional(),
});

type RouteOrderConfirmationContext = z.infer<typeof routeOrderConfirmationContextSchema>;

const visitScheduleReorderSchema = z.object({
  updates: z
    .array(
      z.object({
        schedule_id: z.string().trim().min(1),
        route_order: z.number().int().min(1).optional(),
        expected_route_order: z.number().int().min(1).nullable().optional(),
        scheduled_date: visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
        pharmacist_id: z.string().trim().min(1).optional(),
        vehicle_resource_id: z.string().trim().min(1).nullable().optional(),
      }),
    )
    .default([]),
  vehicle_assignment: z
    .object({
      mode: z.literal('assign_if_unassigned'),
      vehicle_resource_id: z.string().trim().min(1),
      schedule_ids: z.array(z.string().trim().min(1)).min(1).max(100),
      expected_schedule_statuses: z
        .array(
          z.object({
            schedule_id: z.string().trim().min(1),
            schedule_status: z.enum(scheduleStatusValues),
          }),
        )
        .max(100)
        .optional(),
    })
    .optional(),
  confirmation_context: routeOrderConfirmationContextSchema.optional(),
});

type VisitScheduleReorderError =
  | 'not_found'
  | 'pharmacist_change_forbidden'
  | 'invalid_pharmacist'
  | 'confirmed_move'
  | 'confirmed_route_change'
  | 'stale_route_order'
  | 'route_status_locked'
  | 'shift_conflict'
  | 'confirmation_context_mismatch'
  | 'vehicle_not_found'
  | 'vehicle_site_required'
  | 'vehicle_site_mismatch'
  | 'vehicle_capacity_exceeded'
  | 'vehicle_route_duration_exceeded'
  | 'vehicle_status_locked'
  | 'stale_vehicle_schedule_status'
  | 'vehicle_assignment_target_mismatch'
  | 'vehicle_already_assigned'
  | 'duplicate_route_order';
type VisitScheduleReorderResult =
  | {
      error: Exclude<
        VisitScheduleReorderError,
        'shift_conflict' | 'vehicle_capacity_exceeded' | 'vehicle_route_duration_exceeded'
      >;
    }
  | { error: 'shift_conflict'; message: string }
  | { error: 'vehicle_capacity_exceeded'; message: string }
  | { error: 'vehicle_route_duration_exceeded'; message: string }
  | {
      case_ids: string[];
      schedule_ids: string[];
      vehicle_assignment: { vehicle_resource_id: string; assigned_schedule_ids: string[] } | null;
    };

class VisitScheduleReorderConflictError extends Error {
  constructor() {
    super('visit schedule reorder target changed before guarded write');
    this.name = 'VisitScheduleReorderConflictError';
  }
}

class VisitScheduleReorderRetryLimitError extends Error {
  constructor() {
    super('visit schedule reorder transaction retry limit exceeded');
    this.name = 'VisitScheduleReorderRetryLimitError';
  }
}

function buildAuditConfirmationContext(
  ctx: AuthContext,
  confirmationContext: RouteOrderConfirmationContext | null,
): Prisma.InputJsonValue | null {
  if (!confirmationContext) return null;
  if (confirmationContext.patient_reconfirmation_required !== true) {
    return confirmationContext as Prisma.InputJsonValue;
  }

  return {
    ...confirmationContext,
    patient_reconfirmation_acknowledged_by: ctx.userId,
    patient_reconfirmation_acknowledged_at: new Date().toISOString(),
  } as Prisma.InputJsonValue;
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

function buildVisitScheduleReorderSitePoint(
  site:
    | {
        address: string | null;
        lat: number | null;
        lng: number | null;
      }
    | null
    | undefined,
): VehicleRouteDurationPoint | null {
  if (!site) return null;
  return {
    routeOrder: 0,
    lat: site.lat,
    lng: site.lng,
    address: site.address,
    startsAt: null,
  };
}

async function withSerializableVisitScheduleReorderTransaction<T>(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < VISIT_SCHEDULE_REORDER_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === VISIT_SCHEDULE_REORDER_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new VisitScheduleReorderRetryLimitError();
      }
    }
  }

  throw new VisitScheduleReorderRetryLimitError();
}

const authenticatedPATCH = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = visitScheduleReorderSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const dedupedUpdates = Array.from(
      new Map(parsed.data.updates.map((item) => [item.schedule_id, item])).values(),
    );
    if (dedupedUpdates.length !== parsed.data.updates.length) {
      return validationError('同じ訪問予定を複数回指定できません');
    }
    const uniqueScheduleIds = dedupedUpdates.map((item) => item.schedule_id);
    const vehicleAssignment = parsed.data.vehicle_assignment;
    if (!vehicleAssignment && dedupedUpdates.length === 0) {
      return validationError('順路更新または車両反映対象を指定してください');
    }
    if (!vehicleAssignment && dedupedUpdates.some((item) => item.route_order === undefined)) {
      return validationError('順路更新には route_order が必要です');
    }
    if (vehicleAssignment) {
      const duplicateVehicleTargets = new Set<string>();
      const seenVehicleTargets = new Set<string>();
      for (const scheduleId of vehicleAssignment.schedule_ids) {
        if (seenVehicleTargets.has(scheduleId)) duplicateVehicleTargets.add(scheduleId);
        seenVehicleTargets.add(scheduleId);
      }
      if (duplicateVehicleTargets.size > 0) {
        return validationError('同じ訪問予定を複数回指定できません');
      }
      if (vehicleAssignment.expected_schedule_statuses !== undefined) {
        const expectedStatusIds = new Set<string>();
        for (const expected of vehicleAssignment.expected_schedule_statuses) {
          if (expectedStatusIds.has(expected.schedule_id)) {
            return validationError('同じ訪問予定の現在ステータスを複数回指定できません');
          }
          expectedStatusIds.add(expected.schedule_id);
        }
        const missingExpectedStatus = vehicleAssignment.schedule_ids.some(
          (scheduleId) => !expectedStatusIds.has(scheduleId),
        );
        const unexpectedExpectedStatus = vehicleAssignment.expected_schedule_statuses.some(
          (expected) => !seenVehicleTargets.has(expected.schedule_id),
        );
        if (missingExpectedStatus || unexpectedExpectedStatus) {
          return validationError('車両反映対象の現在ステータスが一致しません');
        }
      }
    }
    const targetScheduleIds = Array.from(
      new Set([...uniqueScheduleIds, ...(vehicleAssignment?.schedule_ids ?? [])]),
    );

    let result: VisitScheduleReorderResult;
    try {
      result = await withSerializableVisitScheduleReorderTransaction<VisitScheduleReorderResult>(
        ctx.orgId,
        async (tx) => {
          const assignmentWhere = buildVisitScheduleAssignmentWhere(ctx);
          const confirmationContext = parsed.data.confirmation_context;
          const releasedScheduleId = confirmationContext?.released_schedule_id;
          const scheduleLookupIds = Array.from(
            new Set([...targetScheduleIds, ...(releasedScheduleId ? [releasedScheduleId] : [])]),
          );
          const schedules = await tx.visitSchedule.findMany({
            where: {
              org_id: ctx.orgId,
              id: { in: scheduleLookupIds },
              ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
            },
            select: {
              id: true,
              case_id: true,
              pharmacist_id: true,
              scheduled_date: true,
              time_window_start: true,
              time_window_end: true,
              confirmed_at: true,
              route_order: true,
              site_id: true,
              schedule_status: true,
              vehicle_resource_id: true,
              version: true,
              case_: {
                select: {
                  patient: {
                    select: {
                      residences: {
                        where: { is_primary: true },
                        take: 1,
                        select: {
                          address: true,
                          lat: true,
                          lng: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          });

          if (schedules.length !== scheduleLookupIds.length) {
            return { error: 'not_found' as const };
          }

          const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
          const vehicleAssignmentScheduleIds = new Set(vehicleAssignment?.schedule_ids ?? []);
          const vehicleAssignmentExpectedStatusByScheduleId = new Map(
            vehicleAssignment?.expected_schedule_statuses?.map((expected) => [
              expected.schedule_id,
              expected.schedule_status,
            ]) ?? [],
          );
          const updateByScheduleId = new Map(
            dedupedUpdates.map((item) => [item.schedule_id, item]),
          );
          const effectiveUpdates = targetScheduleIds.map((scheduleId) =>
            vehicleAssignment && vehicleAssignmentScheduleIds.has(scheduleId)
              ? {
                  ...(updateByScheduleId.get(scheduleId) ?? { schedule_id: scheduleId }),
                  vehicle_resource_id: vehicleAssignment.vehicle_resource_id,
                }
              : updateByScheduleId.get(scheduleId)!,
          );
          const staleRouteOrder = effectiveUpdates.find((item) => {
            if (item.expected_route_order === undefined) return false;
            return scheduleById.get(item.schedule_id)?.route_order !== item.expected_route_order;
          });
          if (staleRouteOrder) {
            return { error: 'stale_route_order' as const };
          }
          const staleVehicleScheduleStatus = effectiveUpdates.find((item) => {
            const expectedStatus = vehicleAssignmentExpectedStatusByScheduleId.get(
              item.schedule_id,
            );
            if (expectedStatus === undefined) return false;
            return scheduleById.get(item.schedule_id)?.schedule_status !== expectedStatus;
          });
          if (staleVehicleScheduleStatus) {
            return { error: 'stale_vehicle_schedule_status' as const };
          }

          if (!canBypassVisitScheduleAssignmentAccess(ctx)) {
            const pharmacistChange = effectiveUpdates.find((item) => {
              const schedule = scheduleById.get(item.schedule_id);
              return (
                item.pharmacist_id !== undefined &&
                schedule !== undefined &&
                item.pharmacist_id !== schedule.pharmacist_id
              );
            });
            if (pharmacistChange) {
              return { error: 'pharmacist_change_forbidden' as const };
            }
          }

          const pharmacistIds = Array.from(
            new Set(
              effectiveUpdates
                .map((item) => item.pharmacist_id)
                .filter((value): value is string => Boolean(value)),
            ),
          );

          if (pharmacistIds.length > 0) {
            const memberships = await tx.membership.findMany({
              where: {
                org_id: ctx.orgId,
                user_id: { in: pharmacistIds },
                is_active: true,
                role: {
                  in: ['owner', 'admin', 'pharmacist', 'pharmacist_trainee'],
                },
              },
              select: { user_id: true },
            });
            if (memberships.length !== pharmacistIds.length) {
              return { error: 'invalid_pharmacist' as const };
            }
          }

          const routeCellByKey = effectiveUpdates.reduce((map, item) => {
            if (item.route_order === undefined) return map;
            const schedule = scheduleById.get(item.schedule_id);
            if (!schedule) return map;
            const targetDate = item.scheduled_date ?? formatUtcDateKey(schedule.scheduled_date);
            const targetPharmacistId = item.pharmacist_id ?? schedule.pharmacist_id;
            const key = `${targetPharmacistId}:${targetDate}:${item.route_order}`;
            const current = map.get(key);
            map.set(key, {
              pharmacistId: targetPharmacistId,
              scheduledDate: targetDate,
              routeOrder: item.route_order,
              count: (current?.count ?? 0) + 1,
            });
            return map;
          }, new Map<string, { pharmacistId: string; scheduledDate: string; routeOrder: number; count: number }>());

          const routeCells = Array.from(routeCellByKey.values());
          if (routeCells.some((cell) => cell.count > 1)) {
            return { error: 'duplicate_route_order' as const };
          }

          const routeDates = Array.from(new Set(routeCells.map((cell) => cell.scheduledDate)));
          const routePharmacistIds = Array.from(
            new Set(routeCells.map((cell) => cell.pharmacistId)),
          );
          const releasedSchedule = releasedScheduleId
            ? (scheduleById.get(releasedScheduleId) ?? null)
            : null;
          if (
            confirmationContext &&
            (confirmationContext.patient_reconfirmation_required === true ||
              confirmationContext.released_schedule_id) &&
            (confirmationContext.source !== 'emergency_route_interruption' ||
              !releasedSchedule ||
              !releasedSchedule.confirmed_at ||
              uniqueScheduleIds.includes(releasedSchedule.id) ||
              (confirmationContext.date &&
                confirmationContext.date !== formatUtcDateKey(releasedSchedule.scheduled_date)) ||
              (routePharmacistIds.length === 1 &&
                releasedSchedule.pharmacist_id !== routePharmacistIds[0]))
          ) {
            return { error: 'confirmation_context_mismatch' as const };
          }
          if (
            confirmationContext &&
            ((confirmationContext.target_count &&
              confirmationContext.target_count !== uniqueScheduleIds.length) ||
              (confirmationContext.date &&
                routeDates.length === 1 &&
                confirmationContext.date !== routeDates[0]) ||
              (confirmationContext.pharmacist_id &&
                routePharmacistIds.length === 1 &&
                confirmationContext.pharmacist_id !== routePharmacistIds[0]))
          ) {
            return { error: 'confirmation_context_mismatch' as const };
          }

          const routeOrderConflict = await findVisitRouteOrderConflict(tx, {
            orgId: ctx.orgId,
            cells: routeCells.map((cell) => ({
              pharmacistId: cell.pharmacistId,
              dateKey: cell.scheduledDate,
              routeOrder: cell.routeOrder,
            })),
            excludeScheduleIds: targetScheduleIds,
          });
          if (routeOrderConflict) {
            return { error: 'duplicate_route_order' as const };
          }

          const confirmedDateMoves = effectiveUpdates.find((item) => {
            const schedule = scheduleById.get(item.schedule_id);
            if (!schedule?.confirmed_at) return false;
            const nextDate = item.scheduled_date ?? formatUtcDateKey(schedule.scheduled_date);
            const nextPharmacistId = item.pharmacist_id ?? schedule.pharmacist_id;
            return (
              nextDate !== formatUtcDateKey(schedule.scheduled_date) ||
              nextPharmacistId !== schedule.pharmacist_id
            );
          });
          if (confirmedDateMoves) {
            return { error: 'confirmed_move' as const };
          }

          const moveTargets = effectiveUpdates
            .map((item) => {
              const schedule = scheduleById.get(item.schedule_id);
              if (!schedule) return null;
              const targetDate = item.scheduled_date ?? formatUtcDateKey(schedule.scheduled_date);
              const targetPharmacistId = item.pharmacist_id ?? schedule.pharmacist_id;
              const isMove =
                targetDate !== formatUtcDateKey(schedule.scheduled_date) ||
                targetPharmacistId !== schedule.pharmacist_id;
              return isMove ? { schedule, targetDate, targetPharmacistId } : null;
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));
          const targetShiftKeys = Array.from(
            new Set(moveTargets.map((item) => `${item.targetPharmacistId}:${item.targetDate}`)),
          );
          const targetShifts =
            targetShiftKeys.length === 0
              ? []
              : await tx.pharmacistShift.findMany({
                  where: {
                    org_id: ctx.orgId,
                    OR: targetShiftKeys.map((key) => {
                      const [userId, date] = key.split(':');
                      return {
                        user_id: userId,
                        date: new Date(date),
                      };
                    }),
                  },
                  select: {
                    site_id: true,
                    user_id: true,
                    date: true,
                    available: true,
                    available_from: true,
                    available_to: true,
                  },
                });
          const shiftByTarget = new Map(
            targetShifts.map((shift) => [
              `${shift.user_id}:${formatUtcDateKey(shift.date)}`,
              shift,
            ]),
          );
          const shiftConflict = moveTargets.find((item) => {
            const shift =
              shiftByTarget.get(`${item.targetPharmacistId}:${item.targetDate}`) ?? null;
            return validateScheduleTimeDatesFitShift(
              shift,
              item.schedule.time_window_start,
              item.schedule.time_window_end,
            );
          });
          if (shiftConflict) {
            const shift =
              shiftByTarget.get(
                `${shiftConflict.targetPharmacistId}:${shiftConflict.targetDate}`,
              ) ?? null;
            return {
              error: 'shift_conflict' as const,
              message:
                validateScheduleTimeDatesFitShift(
                  shift,
                  shiftConflict.schedule.time_window_start,
                  shiftConflict.schedule.time_window_end,
                ) ?? '移動先シフトと訪問予定の時間帯が一致しません',
            };
          }

          const routeOrderLocked = effectiveUpdates.find((item) => {
            const schedule = scheduleById.get(item.schedule_id);
            if (!schedule) return false;
            const routeMutationRequested =
              item.route_order !== undefined ||
              item.scheduled_date !== undefined ||
              item.pharmacist_id !== undefined;
            return (
              routeMutationRequested && !ROUTE_REORDERABLE_STATUSES.has(schedule.schedule_status)
            );
          });
          if (routeOrderLocked) return { error: 'route_status_locked' as const };

          const confirmedRouteChange = effectiveUpdates.find((item) => {
            const schedule = scheduleById.get(item.schedule_id);
            if (!schedule?.confirmed_at) return false;
            return item.route_order !== undefined && schedule.route_order !== item.route_order;
          });
          if (confirmedRouteChange) return { error: 'confirmed_route_change' as const };

          const vehicleResourceIds = Array.from(
            new Set(
              effectiveUpdates
                .map((item) => {
                  const schedule = scheduleById.get(item.schedule_id);
                  const routeMutationRequested =
                    item.route_order !== undefined ||
                    item.scheduled_date !== undefined ||
                    item.pharmacist_id !== undefined;
                  if (item.vehicle_resource_id !== undefined) return item.vehicle_resource_id;
                  if (routeMutationRequested) return schedule?.vehicle_resource_id ?? null;
                  return null;
                })
                .filter((value): value is string => typeof value === 'string' && value.length > 0),
            ),
          );
          const vehicleResources =
            vehicleResourceIds.length === 0
              ? []
              : await tx.visitVehicleResource.findMany({
                  where: {
                    org_id: ctx.orgId,
                    id: { in: vehicleResourceIds },
                    available: true,
                  },
                  select: {
                    id: true,
                    site_id: true,
                    label: true,
                    max_stops: true,
                    max_route_duration_minutes: true,
                    travel_mode: true,
                    site: {
                      select: {
                        address: true,
                        lat: true,
                        lng: true,
                      },
                    },
                  },
                });
          if (vehicleResources.length !== vehicleResourceIds.length) {
            return { error: 'vehicle_not_found' as const };
          }
          const vehicleById = new Map(vehicleResources.map((vehicle) => [vehicle.id, vehicle]));

          const vehicleUpdateTargets = effectiveUpdates
            .map((item) => {
              const schedule = scheduleById.get(item.schedule_id);
              if (!schedule) return null;
              const targetDate = item.scheduled_date ?? formatUtcDateKey(schedule.scheduled_date);
              const targetPharmacistId = item.pharmacist_id ?? schedule.pharmacist_id;
              const targetShift = shiftByTarget.get(`${targetPharmacistId}:${targetDate}`) ?? null;
              const targetSiteId = targetShift?.site_id ?? schedule.site_id;
              const routeMutationRequested =
                item.route_order !== undefined ||
                item.scheduled_date !== undefined ||
                item.pharmacist_id !== undefined;
              const vehicleResourceId =
                item.vehicle_resource_id !== undefined
                  ? item.vehicle_resource_id
                  : routeMutationRequested
                    ? schedule.vehicle_resource_id
                    : undefined;
              if (vehicleResourceId === undefined) return null;
              return {
                item,
                schedule,
                targetDate,
                targetSiteId,
                vehicleResourceId,
              };
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

          for (const target of vehicleUpdateTargets) {
            if (target.vehicleResourceId === null) continue;
            if (
              vehicleAssignment &&
              vehicleAssignmentScheduleIds.has(target.schedule.id) &&
              target.schedule.vehicle_resource_id != null
            ) {
              return { error: 'vehicle_already_assigned' as const };
            }
            if (!VEHICLE_ASSIGNABLE_STATUSES.has(target.schedule.schedule_status)) {
              return { error: 'vehicle_status_locked' as const };
            }
            if (!target.targetSiteId) return { error: 'vehicle_site_required' as const };
            const vehicle = vehicleById.get(target.vehicleResourceId);
            if (!vehicle) return { error: 'vehicle_not_found' as const };
            if (vehicle.site_id !== target.targetSiteId) {
              return { error: 'vehicle_site_mismatch' as const };
            }
          }

          const vehicleCapacityCells = new Map<
            string,
            {
              vehicleId: string;
              dateKey: string;
              label: string;
              maxStops: number;
              assignedUpdateCount: number;
            }
          >();
          type VehicleUpdateTarget = (typeof vehicleUpdateTargets)[number];
          const vehicleRouteDurationCells = new Map<
            string,
            {
              vehicleId: string;
              dateKey: string;
              label: string;
              maxRouteDurationMinutes: number;
              travelMode: VisitRouteTravelMode;
              site: {
                address: string | null;
                lat: number | null;
                lng: number | null;
              } | null;
              assignedTargets: VehicleUpdateTarget[];
            }
          >();
          for (const target of vehicleUpdateTargets) {
            if (target.vehicleResourceId === null) continue;
            const vehicle = vehicleById.get(target.vehicleResourceId);
            if (vehicle?.max_route_duration_minutes != null) {
              const key = `${target.vehicleResourceId}:${target.targetDate}`;
              const current =
                vehicleRouteDurationCells.get(key) ??
                ({
                  vehicleId: target.vehicleResourceId,
                  dateKey: target.targetDate,
                  label: vehicle.label,
                  maxRouteDurationMinutes: vehicle.max_route_duration_minutes,
                  travelMode: vehicle.travel_mode as VisitRouteTravelMode,
                  site: vehicle.site,
                  assignedTargets: [],
                } satisfies {
                  vehicleId: string;
                  dateKey: string;
                  label: string;
                  maxRouteDurationMinutes: number;
                  travelMode: VisitRouteTravelMode;
                  site: {
                    address: string | null;
                    lat: number | null;
                    lng: number | null;
                  } | null;
                  assignedTargets: VehicleUpdateTarget[];
                });
              current.assignedTargets.push(target);
              vehicleRouteDurationCells.set(key, current);
            }
            if (!vehicle || vehicle.max_stops == null) continue;
            const key = `${target.vehicleResourceId}:${target.targetDate}`;
            const current =
              vehicleCapacityCells.get(key) ??
              ({
                vehicleId: target.vehicleResourceId,
                dateKey: target.targetDate,
                label: vehicle.label,
                maxStops: vehicle.max_stops,
                assignedUpdateCount: 0,
              } satisfies {
                vehicleId: string;
                dateKey: string;
                label: string;
                maxStops: number;
                assignedUpdateCount: number;
              });
            current.assignedUpdateCount += 1;
            vehicleCapacityCells.set(key, current);
          }

          const vehicleCapacityUpdateScheduleIds = Array.from(
            new Set(vehicleUpdateTargets.map((target) => target.schedule.id)),
          );
          const vehicleConstraintVehicleIds = Array.from(
            new Set([
              ...Array.from(vehicleCapacityCells.values()).map((cell) => cell.vehicleId),
              ...Array.from(vehicleRouteDurationCells.values()).map((cell) => cell.vehicleId),
            ]),
          );
          const vehicleConstraintDates = Array.from(
            new Set([
              ...Array.from(vehicleCapacityCells.values()).map((cell) => cell.dateKey),
              ...Array.from(vehicleRouteDurationCells.values()).map((cell) => cell.dateKey),
            ]),
          ).map((dateKey) => new Date(dateKey));
          const vehicleCapacityRows =
            vehicleConstraintVehicleIds.length === 0 || vehicleConstraintDates.length === 0
              ? []
              : await tx.visitSchedule.findMany({
                  where: {
                    org_id: ctx.orgId,
                    vehicle_resource_id: {
                      in: vehicleConstraintVehicleIds,
                    },
                    scheduled_date: {
                      in: vehicleConstraintDates,
                    },
                    schedule_status: { notIn: ['cancelled', 'rescheduled'] },
                    id: { notIn: vehicleCapacityUpdateScheduleIds },
                  },
                  select: {
                    vehicle_resource_id: true,
                    scheduled_date: true,
                    route_order: true,
                    time_window_start: true,
                    case_: {
                      select: {
                        patient: {
                          select: {
                            residences: {
                              where: { is_primary: true },
                              take: 1,
                              select: {
                                address: true,
                                lat: true,
                                lng: true,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                });
          const existingAssignedCountByCell = new Map<string, number>();
          for (const row of vehicleCapacityRows) {
            if (!row.vehicle_resource_id) continue;
            const key = `${row.vehicle_resource_id}:${formatUtcDateKey(row.scheduled_date)}`;
            existingAssignedCountByCell.set(key, (existingAssignedCountByCell.get(key) ?? 0) + 1);
          }

          for (const [cellKey, cell] of vehicleCapacityCells) {
            const existingAssignedCount = existingAssignedCountByCell.get(cellKey) ?? 0;
            if (existingAssignedCount + cell.assignedUpdateCount > cell.maxStops) {
              return {
                error: 'vehicle_capacity_exceeded' as const,
                message: `${cell.label} で訪問できる件数は最大 ${cell.maxStops} 件です`,
              };
            }
          }

          const existingRoutePointsByVehicleCell = new Map<string, VehicleRouteDurationPoint[]>();
          for (const row of vehicleCapacityRows) {
            if (!row.vehicle_resource_id) continue;
            const key = `${row.vehicle_resource_id}:${formatUtcDateKey(row.scheduled_date)}`;
            if (!vehicleRouteDurationCells.has(key)) continue;
            const points = existingRoutePointsByVehicleCell.get(key) ?? [];
            points.push(
              buildVehicleRoutePoint({
                scheduledDate: row.scheduled_date,
                routeOrder: row.route_order,
                timeWindowStart: row.time_window_start,
                residence: row.case_.patient.residences[0] ?? null,
              }),
            );
            existingRoutePointsByVehicleCell.set(key, points);
          }
          for (const [cellKey, cell] of vehicleRouteDurationCells) {
            const sitePoint = buildVisitScheduleReorderSitePoint(cell.site);
            if (!sitePoint) {
              return {
                error: 'vehicle_route_duration_exceeded' as const,
                message: `${cell.label} の稼働上限 ${cell.maxRouteDurationMinutes}分を検証できません。訪問拠点の住所座標を整備してください`,
              };
            }

            const acceptedTargetPoints: VehicleRouteDurationPoint[] = [];
            const estimateRoadTravel = createRoadTravelEstimator(cell.travelMode);
            for (const target of cell.assignedTargets) {
              const scheduledDate = new Date(target.targetDate);
              const candidatePoint = buildVehicleRoutePoint({
                scheduledDate,
                routeOrder: target.item.route_order ?? target.schedule.route_order,
                timeWindowStart: target.schedule.time_window_start,
                residence: target.schedule.case_.patient.residences[0] ?? null,
              });
              const estimate = await estimateVehicleRouteDurationWithCandidate(
                sitePoint,
                [...(existingRoutePointsByVehicleCell.get(cellKey) ?? []), ...acceptedTargetPoints],
                candidatePoint,
                estimateRoadTravel,
                cell.travelMode,
              );
              if (estimate.durationMinutes == null) {
                return {
                  error: 'vehicle_route_duration_exceeded' as const,
                  message: `${cell.label} の稼働上限 ${cell.maxRouteDurationMinutes}分を検証できません（${estimate.summary}）`,
                };
              }
              if (estimate.durationMinutes > cell.maxRouteDurationMinutes) {
                return {
                  error: 'vehicle_route_duration_exceeded' as const,
                  message: `${cell.label} の候補追加後の推定稼働時間 ${estimate.durationMinutes.toFixed(1)}分 が上限 ${cell.maxRouteDurationMinutes}分を超えます`,
                };
              }
              acceptedTargetPoints.push(candidatePoint);
            }
          }

          await Promise.all(
            effectiveUpdates.map(async (item) => {
              const schedule = scheduleById.get(item.schedule_id);
              const targetDate =
                item.scheduled_date ??
                (schedule ? formatUtcDateKey(schedule.scheduled_date) : undefined);
              const targetPharmacistId = item.pharmacist_id ?? schedule?.pharmacist_id;
              const targetShift =
                targetDate && targetPharmacistId
                  ? (shiftByTarget.get(`${targetPharmacistId}:${targetDate}`) ?? null)
                  : null;

              if (!schedule || !targetDate || !targetPharmacistId) {
                throw new VisitScheduleReorderConflictError();
              }
              const routeMutationRequested =
                item.route_order !== undefined ||
                item.scheduled_date !== undefined ||
                item.pharmacist_id !== undefined;
              const shouldGuardVehicleResource =
                item.vehicle_resource_id !== undefined ||
                (routeMutationRequested && schedule.vehicle_resource_id != null);

              const updateResult = await tx.visitSchedule.updateMany({
                where: {
                  org_id: ctx.orgId,
                  id: item.schedule_id,
                  pharmacist_id: schedule.pharmacist_id,
                  scheduled_date: schedule.scheduled_date,
                  confirmed_at: schedule.confirmed_at,
                  version: schedule.version,
                  ...(item.expected_route_order !== undefined
                    ? { route_order: item.expected_route_order }
                    : {}),
                  ...(vehicleAssignmentExpectedStatusByScheduleId.has(item.schedule_id)
                    ? {
                        schedule_status: vehicleAssignmentExpectedStatusByScheduleId.get(
                          item.schedule_id,
                        ),
                      }
                    : {}),
                  ...(shouldGuardVehicleResource
                    ? { vehicle_resource_id: schedule.vehicle_resource_id }
                    : {}),
                  ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
                },
                data: {
                  ...(item.route_order !== undefined ? { route_order: item.route_order } : {}),
                  ...(item.scheduled_date ? { scheduled_date: new Date(item.scheduled_date) } : {}),
                  ...(item.pharmacist_id ? { pharmacist_id: item.pharmacist_id } : {}),
                  ...(targetShift ? { site_id: targetShift.site_id } : {}),
                  ...(item.vehicle_resource_id !== undefined
                    ? { vehicle_resource_id: item.vehicle_resource_id }
                    : {}),
                  version: { increment: 1 },
                },
              });
              if (updateResult.count !== 1) throw new VisitScheduleReorderConflictError();
            }),
          );

          await createAuditLogEntry(tx, ctx, {
            action: 'visit_schedules_reordered',
            targetType: 'VisitScheduleBatch',
            targetId: targetScheduleIds[0],
            changes: {
              updates: effectiveUpdates.map((item) => ({
                schedule_id: item.schedule_id,
                previous_route_order: scheduleById.get(item.schedule_id)?.route_order ?? null,
                route_order: item.route_order,
                ...(item.expected_route_order !== undefined
                  ? { expected_route_order: item.expected_route_order }
                  : {}),
                ...(vehicleAssignmentExpectedStatusByScheduleId.has(item.schedule_id)
                  ? {
                      expected_schedule_status: vehicleAssignmentExpectedStatusByScheduleId.get(
                        item.schedule_id,
                      ),
                    }
                  : {}),
                scheduled_date: item.scheduled_date ?? null,
                pharmacist_id: item.pharmacist_id ?? null,
                previous_vehicle_resource_id:
                  scheduleById.get(item.schedule_id)?.vehicle_resource_id ?? null,
                vehicle_resource_id: item.vehicle_resource_id ?? null,
                confirmed: scheduleById.get(item.schedule_id)?.confirmed_at != null,
              })),
              vehicle_assignment: parsed.data.vehicle_assignment ?? null,
              confirmation_context: buildAuditConfirmationContext(
                ctx,
                parsed.data.confirmation_context ?? null,
              ),
            },
          });

          return {
            case_ids: Array.from(new Set(schedules.map((schedule) => schedule.case_id))),
            schedule_ids: targetScheduleIds,
            vehicle_assignment: vehicleAssignment
              ? {
                  vehicle_resource_id: vehicleAssignment.vehicle_resource_id,
                  assigned_schedule_ids: vehicleAssignment.schedule_ids,
                }
              : null,
          };
        },
      );
    } catch (cause) {
      if (
        cause instanceof VisitScheduleReorderConflictError ||
        cause instanceof VisitScheduleReorderRetryLimitError
      ) {
        return conflict('route_order の反映対象が同時に更新されました。再読み込みしてください');
      }
      throw cause;
    }

    if ('error' in result) {
      if (result.error === 'not_found') {
        return notFound('対象の訪問予定が見つかりません');
      }
      if (result.error === 'pharmacist_change_forbidden') {
        return forbiddenResponse('訪問予定のケースまたは担当薬剤師を変更する権限がありません');
      }
      if (result.error === 'invalid_pharmacist') {
        return validationError('指定された薬剤師はこの組織に所属していません');
      }
      if (result.error === 'confirmed_move') {
        return validationError('電話確定済みの訪問予定は日付や担当を変更できません');
      }
      if (result.error === 'confirmed_route_change') {
        return validationError('電話確定済みの訪問予定は順路を変更できません');
      }
      if (result.error === 'stale_route_order') {
        return conflict('route_order の反映対象が同時に更新されました。再読み込みしてください');
      }
      if (result.error === 'route_status_locked') {
        return validationError('完了済みまたは中止済みの訪問予定は順路を変更できません');
      }
      if (result.error === 'shift_conflict') {
        return validationError(result.message);
      }
      if (result.error === 'confirmation_context_mismatch') {
        return validationError('確認コンテキストが訪問予定の対象セルと一致しません');
      }
      if (result.error === 'vehicle_not_found') {
        return validationError('選択した車両リソースが見つからないか利用できません');
      }
      if (result.error === 'vehicle_site_required') {
        return validationError('車両リソースを指定する場合は訪問拠点が必要です');
      }
      if (result.error === 'vehicle_site_mismatch') {
        return validationError('選択した車両リソースは訪問予定の拠点では利用できません');
      }
      if (result.error === 'vehicle_capacity_exceeded') {
        return validationError(result.message);
      }
      if (result.error === 'vehicle_route_duration_exceeded') {
        return validationError(result.message);
      }
      if (result.error === 'vehicle_status_locked') {
        return validationError('完了済みまたは中止済みの訪問予定には車両を反映できません');
      }
      if (result.error === 'stale_vehicle_schedule_status') {
        return conflict('車両反映対象が同時に更新されました。再読み込みしてください');
      }
      if (result.error === 'vehicle_assignment_target_mismatch') {
        return validationError('車両反映対象は順路更新対象の訪問予定だけ指定できます');
      }
      if (result.error === 'vehicle_already_assigned') {
        return conflict('車両反映対象が同時に更新されました。再読み込みしてください');
      }
      if (result.error === 'duplicate_route_order') {
        return validationError('同一セル内で route_order は重複できません');
      }
      return validationError('訪問予定の並べ替えに失敗しました');
    }

    const successfulResult = result;
    await Promise.all(
      successfulResult.case_ids.map((caseId) =>
        notifyWorkflowMutation({
          orgId: ctx.orgId,
          payload: { source: 'visit_schedules_reorder', case_id: caseId },
        }),
      ),
    );

    return success(successfulResult);
  },
  {
    permission: 'canVisit',
    message: '訪問予定の更新権限がありません',
  },
);

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
