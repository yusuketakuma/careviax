import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound, conflict, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { formatDateKey } from '@/lib/date-key';
import { withOrgContext } from '@/lib/db/rls';
import {
  findVisitRouteOrderConflict,
  hasDuplicateVisitRouteOrderCells,
} from '@/lib/visits/route-order-conflicts';
import {
  buildVisitScheduleAssignmentWhere,
  buildVisitScheduleProposalAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import { OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES as OPEN_PROPOSAL_STATUSES } from '@/lib/visit-schedule-proposals/route-order';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { createRoadTravelEstimator } from '@/server/services/road-routing';
import { buildVehicleRoutePoint } from '@/server/services/visit-schedule-service';
import {
  estimateVehicleRouteDurationWithCandidate,
  type VehicleRouteDurationPoint,
} from '@/server/services/visit-schedule-planner';
import type { VisitRouteTravelMode } from '@/types/visit-route';

const MIXED_ROUTE_REORDER_SERIALIZABLE_RETRY_LIMIT = 3;

const routeOrderConfirmationContextSchema = z.object({
  source: z.enum(['weekly_optimizer_mixed_route_preview']),
  date: visitScheduleDateKeySchema('確認日付の形式が不正です（YYYY-MM-DD）').optional(),
  pharmacist_id: z.string().trim().min(1).max(100).optional(),
  travel_mode: z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']).optional(),
  target_count: z.number().int().min(1).max(100).optional(),
  route_order_diff_count: z.number().int().min(0).max(100).optional(),
});

const mixedRouteOrderUpdateSchema = z.object({
  item_type: z.enum(['schedule', 'proposal']),
  id: z.string().trim().min(1),
  route_order: z.number().int().min(1),
});

const mixedRouteReorderSchema = z.object({
  updates: z.array(mixedRouteOrderUpdateSchema).min(1).max(100),
  confirmation_context: routeOrderConfirmationContextSchema.optional(),
});

type MixedRouteReorderError =
  | 'not_found'
  | 'locked'
  | 'mismatch'
  | 'duplicate_route_order'
  | 'vehicle_route_duration_exceeded';
type MixedRouteReorderResult =
  | { error: Exclude<MixedRouteReorderError, 'vehicle_route_duration_exceeded'> }
  | { error: 'vehicle_route_duration_exceeded'; message: string }
  | { case_ids: string[]; schedule_ids: string[]; proposal_ids: string[] };

function hasDuplicateRouteTarget(updates: Array<z.infer<typeof mixedRouteOrderUpdateSchema>>) {
  const seen = new Set<string>();
  return updates.some((item) => {
    const key = `${item.item_type}:${item.id}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

class MixedRouteReorderConflictError extends Error {
  constructor() {
    super('mixed route reorder target changed before guarded write');
    this.name = 'MixedRouteReorderConflictError';
  }
}

class MixedRouteReorderRetryLimitError extends Error {
  constructor() {
    super('mixed route reorder transaction retry limit exceeded');
    this.name = 'MixedRouteReorderRetryLimitError';
  }
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

function buildMixedRouteSitePoint(
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

async function withSerializableMixedRouteReorderTransaction<T>(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < MIXED_ROUTE_REORDER_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === MIXED_ROUTE_REORDER_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new MixedRouteReorderRetryLimitError();
      }
    }
  }

  throw new MixedRouteReorderRetryLimitError();
}

const authenticatedPATCH = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = mixedRouteReorderSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const updates = parsed.data.updates;
    if (hasDuplicateRouteTarget(updates)) {
      return validationError('同じ対象を複数回指定できません');
    }

    const scheduleUpdates = updates.filter((item) => item.item_type === 'schedule');
    const proposalUpdates = updates.filter((item) => item.item_type === 'proposal');
    const scheduleIds = scheduleUpdates.map((item) => item.id);
    const proposalIds = proposalUpdates.map((item) => item.id);

    let result: MixedRouteReorderResult;
    try {
      result = await withSerializableMixedRouteReorderTransaction<MixedRouteReorderResult>(
        ctx.orgId,
        async (tx) => {
          const scheduleAssignmentWhere = buildVisitScheduleAssignmentWhere(ctx);
          const proposalAssignmentWhere = buildVisitScheduleProposalAssignmentWhere(ctx);
          const [schedules, proposals] = await Promise.all([
            scheduleIds.length > 0
              ? tx.visitSchedule.findMany({
                  where: {
                    org_id: ctx.orgId,
                    id: { in: scheduleIds },
                    ...(scheduleAssignmentWhere ? { AND: [scheduleAssignmentWhere] } : {}),
                  },
                  select: {
                    id: true,
                    case_id: true,
                    pharmacist_id: true,
                    scheduled_date: true,
                    route_order: true,
                    time_window_start: true,
                    vehicle_resource_id: true,
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
                    vehicle_resource: {
                      select: {
                        id: true,
                        label: true,
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
                    },
                  },
                })
              : Promise.resolve([]),
            proposalIds.length > 0
              ? tx.visitScheduleProposal.findMany({
                  where: {
                    org_id: ctx.orgId,
                    id: { in: proposalIds },
                    ...(proposalAssignmentWhere ? { AND: [proposalAssignmentWhere] } : {}),
                  },
                  select: {
                    id: true,
                    case_id: true,
                    proposed_date: true,
                    proposed_pharmacist_id: true,
                    finalized_schedule_id: true,
                    proposal_status: true,
                  },
                })
              : Promise.resolve([]),
          ]);

          if (schedules.length !== scheduleIds.length || proposals.length !== proposalIds.length) {
            return { error: 'not_found' as const };
          }

          const lockedProposal = proposals.find(
            (proposal) =>
              proposal.finalized_schedule_id != null ||
              !OPEN_PROPOSAL_STATUSES.includes(proposal.proposal_status),
          );
          if (lockedProposal) return { error: 'locked' as const };

          const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
          const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
          const routeCells = updates.map((item) => {
            if (item.item_type === 'schedule') {
              const schedule = scheduleById.get(item.id);
              if (!schedule) return null;
              return {
                itemType: item.item_type,
                id: item.id,
                caseId: schedule.case_id,
                pharmacistId: schedule.pharmacist_id,
                dateKey: formatDateKey(schedule.scheduled_date),
                routeOrder: item.route_order,
              };
            }

            const proposal = proposalById.get(item.id);
            if (!proposal) return null;
            return {
              itemType: item.item_type,
              id: item.id,
              caseId: proposal.case_id,
              pharmacistId: proposal.proposed_pharmacist_id,
              dateKey: formatDateKey(proposal.proposed_date),
              routeOrder: item.route_order,
            };
          });

          if (routeCells.some((item) => item == null)) {
            return { error: 'not_found' as const };
          }

          const typedRouteCells = routeCells.filter((item): item is NonNullable<typeof item> =>
            Boolean(item),
          );
          const [firstCell] = typedRouteCells;
          const mismatch = typedRouteCells.find(
            (item) =>
              item.pharmacistId !== firstCell.pharmacistId || item.dateKey !== firstCell.dateKey,
          );
          if (mismatch) return { error: 'mismatch' as const };

          if (hasDuplicateVisitRouteOrderCells(typedRouteCells)) {
            return { error: 'duplicate_route_order' as const };
          }

          const routeOrderConflict = await findVisitRouteOrderConflict(tx, {
            orgId: ctx.orgId,
            cells: typedRouteCells,
            excludeScheduleIds: scheduleIds,
            excludeProposalIds: proposalIds,
            scheduleStatusScope: 'any',
          });
          if (routeOrderConflict) {
            return { error: 'duplicate_route_order' as const };
          }

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
              targets: Array<{
                update: (typeof scheduleUpdates)[number];
                schedule: NonNullable<ReturnType<typeof scheduleById.get>>;
              }>;
            }
          >();
          for (const update of scheduleUpdates) {
            const schedule = scheduleById.get(update.id);
            const vehicle = schedule?.vehicle_resource;
            if (!schedule || !vehicle?.max_route_duration_minutes) continue;
            const dateKey = formatDateKey(schedule.scheduled_date);
            const key = `${vehicle.id}:${dateKey}`;
            const current =
              vehicleRouteDurationCells.get(key) ??
              ({
                vehicleId: vehicle.id,
                dateKey,
                label: vehicle.label,
                maxRouteDurationMinutes: vehicle.max_route_duration_minutes,
                travelMode: vehicle.travel_mode as VisitRouteTravelMode,
                site: vehicle.site,
                targets: [],
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
                targets: Array<{
                  update: (typeof scheduleUpdates)[number];
                  schedule: NonNullable<ReturnType<typeof scheduleById.get>>;
                }>;
              });
            current.targets.push({ update, schedule });
            vehicleRouteDurationCells.set(key, current);
          }

          const vehicleRouteRows =
            vehicleRouteDurationCells.size === 0
              ? []
              : await tx.visitSchedule.findMany({
                  where: {
                    org_id: ctx.orgId,
                    vehicle_resource_id: {
                      in: Array.from(
                        new Set(
                          Array.from(vehicleRouteDurationCells.values()).map(
                            (cell) => cell.vehicleId,
                          ),
                        ),
                      ),
                    },
                    scheduled_date: {
                      in: Array.from(
                        new Set(
                          Array.from(vehicleRouteDurationCells.values()).map(
                            (cell) => new Date(cell.dateKey),
                          ),
                        ),
                      ),
                    },
                    schedule_status: { notIn: ['cancelled', 'rescheduled'] },
                    id: { notIn: scheduleIds },
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
          const existingRoutePointsByVehicleCell = new Map<string, VehicleRouteDurationPoint[]>();
          for (const row of vehicleRouteRows) {
            if (!row.vehicle_resource_id) continue;
            const key = `${row.vehicle_resource_id}:${formatDateKey(row.scheduled_date)}`;
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
            const sitePoint = buildMixedRouteSitePoint(cell.site);
            if (!sitePoint) {
              return {
                error: 'vehicle_route_duration_exceeded' as const,
                message: `${cell.label} の稼働上限 ${cell.maxRouteDurationMinutes}分を検証できません。訪問拠点の住所座標を整備してください`,
              };
            }

            const acceptedTargetPoints: VehicleRouteDurationPoint[] = [];
            const estimateRoadTravel = createRoadTravelEstimator(cell.travelMode);
            for (const target of cell.targets) {
              const candidatePoint = buildVehicleRoutePoint({
                scheduledDate: target.schedule.scheduled_date,
                routeOrder: target.update.route_order,
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
            scheduleUpdates.map(async (item) => {
              const schedule = scheduleById.get(item.id);
              const updateResult = await tx.visitSchedule.updateMany({
                where: {
                  org_id: ctx.orgId,
                  id: item.id,
                  pharmacist_id: firstCell.pharmacistId,
                  scheduled_date: new Date(firstCell.dateKey),
                  ...(schedule?.vehicle_resource_id
                    ? { vehicle_resource_id: schedule.vehicle_resource_id }
                    : {}),
                  ...(scheduleAssignmentWhere ? { AND: [scheduleAssignmentWhere] } : {}),
                },
                data: {
                  route_order: item.route_order,
                  version: { increment: 1 },
                },
              });
              if (updateResult.count !== 1) throw new MixedRouteReorderConflictError();
            }),
          );

          await Promise.all(
            proposalUpdates.map(async (item) => {
              const updateResult = await tx.visitScheduleProposal.updateMany({
                where: {
                  org_id: ctx.orgId,
                  id: item.id,
                  proposed_pharmacist_id: firstCell.pharmacistId,
                  proposed_date: new Date(firstCell.dateKey),
                  finalized_schedule_id: null,
                  proposal_status: { in: OPEN_PROPOSAL_STATUSES },
                  ...(proposalAssignmentWhere ? { AND: [proposalAssignmentWhere] } : {}),
                },
                data: { route_order: item.route_order },
              });
              if (updateResult.count !== 1) throw new MixedRouteReorderConflictError();
            }),
          );

          await createAuditLogEntry(tx, ctx, {
            action: 'visit_routes_mixed_reordered',
            targetType: 'VisitRouteMixedCell',
            targetId: `${firstCell.pharmacistId}:${firstCell.dateKey}`,
            changes: {
              date: firstCell.dateKey,
              pharmacist_id: firstCell.pharmacistId,
              schedule_updates: scheduleUpdates.map((item) => ({
                schedule_id: item.id,
                route_order: item.route_order,
              })),
              proposal_updates: proposalUpdates.map((item) => ({
                proposal_id: item.id,
                route_order: item.route_order,
              })),
              confirmation_context: parsed.data.confirmation_context ?? null,
            },
          });

          return {
            case_ids: Array.from(new Set(typedRouteCells.map((item) => item.caseId))),
            schedule_ids: scheduleIds,
            proposal_ids: proposalIds,
          };
        },
      );
    } catch (cause) {
      if (
        cause instanceof MixedRouteReorderConflictError ||
        cause instanceof MixedRouteReorderRetryLimitError
      ) {
        return conflict('route_order の反映対象が同時に更新されました。再読み込みしてください');
      }
      throw cause;
    }

    if ('error' in result) {
      if (result.error === 'not_found') {
        return notFound('対象の訪問予定または候補が見つかりません');
      }
      if (result.error === 'locked') {
        return validationError('確定済みまたは却下済みの候補は並べ替えできません');
      }
      if (result.error === 'mismatch') {
        return validationError('同一薬剤師・同一日の訪問予定と候補のみ route_order を更新できます');
      }
      if (result.error === 'duplicate_route_order') {
        return validationError('同一セル内で route_order は重複できません');
      }
      if (result.error === 'vehicle_route_duration_exceeded') {
        return validationError(result.message);
      }
      return validationError('route_order の更新に失敗しました');
    }

    const successfulResult = result;
    await Promise.all(
      successfulResult.case_ids.map((caseId) =>
        notifyWorkflowMutation({
          orgId: ctx.orgId,
          payload: { source: 'visit_routes_mixed_reorder', case_id: caseId },
        }),
      ),
    );

    return success({
      schedule_ids: successfulResult.schedule_ids,
      proposal_ids: successfulResult.proposal_ids,
    });
  },
  {
    permission: 'canVisit',
    message: '混在ルート順の更新権限がありません',
  },
);

export async function PATCH(
  req: NextRequest,
  routeContext: AuthRouteContext<Record<string, string>>,
) {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
