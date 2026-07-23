import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import {
  canAccessVisitScheduleAssignment,
  canManageVisitScheduleLifecycle,
} from '@/lib/auth/visit-schedule-access';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { normalizeJsonInput, readJsonObject } from '@/lib/db/json';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  success,
  validationError,
  notFound,
  forbiddenResponse,
  conflict,
} from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { upsertVisitPreparationSchema } from '@/lib/validations/visit-preparation';
import {
  buildChecklistFromTemplate,
  mergeChecklistWithTemplate,
} from '@/lib/visits/checklist-template';
import {
  upsertOperationalTask,
  resolveOperationalTasks,
} from '@/server/services/operational-tasks';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  buildVisitReadyReadinessBlockers,
  evaluateVisitScheduleReadyTransition,
  getVisitReadyTransitionErrorMessage,
  sanitizeVisitReadyTransitionDetails,
  type VisitReadyTransitionBlockers,
} from '@/server/services/visit-preparation-readiness';
import {
  DEFAULT_VISIT_ROUTE_SERVICE_MINUTES,
  computeOptimizedVisitRoute,
  visitRouteTimeWindowFromDbTime,
  type VisitRoutePlan,
  type VisitRouteTravelMode,
} from '@/server/services/visit-route-engine';

export { GET } from './route-get';

function isInputJsonObject(
  value: Prisma.InputJsonValue | null | undefined,
): value is Prisma.InputJsonObject {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !('toJSON' in value)
  );
}

function normalizeInputJsonObject(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeJsonInput(value);
  return isInputJsonObject(normalized) ? normalized : {};
}

function readRouteSnapshotVehicleResourceId(value: Prisma.InputJsonObject | null) {
  if (!value) return null;
  if (typeof value.vehicle_resource_id === 'string' && value.vehicle_resource_id.trim()) {
    return value.vehicle_resource_id.trim();
  }
  const vehicleResource = readJsonObject(value.vehicle_resource);
  const vehicleId = vehicleResource?.vehicle_id;
  return typeof vehicleId === 'string' && vehicleId.trim() ? vehicleId.trim() : null;
}

function readRouteSnapshotTravelMode(
  value: Prisma.InputJsonObject | null,
): VisitRouteTravelMode | null {
  if (!value) return null;
  const rawValue = value.travelMode ?? value.travel_mode;
  return rawValue === 'DRIVE' ||
    rawValue === 'BICYCLE' ||
    rawValue === 'WALK' ||
    rawValue === 'TWO_WHEELER'
    ? rawValue
    : null;
}

function appendRouteNote(note: string | null, next: string) {
  return note ? `${note} / ${next}` : next;
}

function buildVisitDayRange(date: Date) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function countUniqueScheduleIdsForVehicleCapacity(...scheduleGroups: Array<Array<{ id: string }>>) {
  const scheduleIds = new Set<string>();
  for (const schedules of scheduleGroups) {
    for (const schedule of schedules) {
      scheduleIds.add(schedule.id);
    }
  }
  return scheduleIds.size;
}

function normalizeRoutePlanSnapshotForWrite(
  plan: VisitRoutePlan,
  args: {
    scheduleIds: string[];
    routeOrder: number | null;
    vehicleResource: {
      id: string;
      label: string;
      max_stops: number | null;
      max_route_duration_minutes: number | null;
    } | null;
    generatedAt: Date;
  },
): Prisma.InputJsonObject {
  const vehicleLabel = args.vehicleResource?.label ?? args.vehicleResource?.id ?? '選択中の社用車';
  const vehicleConstraintExceeded =
    args.vehicleResource?.max_route_duration_minutes != null &&
    plan.totalDurationSeconds != null &&
    plan.totalDurationSeconds > args.vehicleResource.max_route_duration_minutes * 60;
  const vehicleConstraintUnverified =
    args.vehicleResource?.max_route_duration_minutes != null && plan.totalDurationSeconds == null;
  const note =
    args.vehicleResource == null
      ? plan.note
      : vehicleConstraintExceeded
        ? appendRouteNote(
            plan.note,
            `${vehicleLabel} の稼働上限 ${args.vehicleResource.max_route_duration_minutes}分を超えています`,
          )
        : vehicleConstraintUnverified
          ? appendRouteNote(plan.note, `${vehicleLabel} の稼働上限は経路時間未計算のため未確認です`)
          : appendRouteNote(plan.note, `${vehicleLabel} の車両リソース条件を確認済み`);

  return normalizeInputJsonObject({
    ...plan,
    note,
    ordered_schedule_ids: args.scheduleIds,
    orderedScheduleIds: plan.orderedScheduleIds,
    route_order: args.routeOrder,
    generated_by: 'server',
    generated_at: args.generatedAt.toISOString(),
    ...(args.vehicleResource
      ? {
          vehicle_resource_id: args.vehicleResource.id,
          vehicle_resource: {
            vehicle_id: args.vehicleResource.id,
            label: vehicleLabel,
            max_stops: args.vehicleResource.max_stops,
            max_route_duration_minutes: args.vehicleResource.max_route_duration_minutes,
            stop_count: args.scheduleIds.length,
            route_duration_minutes:
              plan.totalDurationSeconds == null ? null : Math.ceil(plan.totalDurationSeconds / 60),
            constraint_status: vehicleConstraintExceeded
              ? 'exceeded'
              : vehicleConstraintUnverified
                ? 'unverified'
                : 'ok',
          },
        }
      : {}),
  });
}

function buildPreparationTaskKey(scheduleId: string) {
  return `visit-preparation:${scheduleId}`;
}

function buildVisitPreparationTaskMetadata(args: {
  scheduleId: string;
  caseId: string;
  routeConfirmed: boolean;
  markReadyRequested: boolean;
  preparationReady: boolean;
  updatedBy: string;
}): Prisma.InputJsonObject {
  return {
    source: 'visit_preparation_put',
    schedule_id: args.scheduleId,
    case_id: args.caseId,
    route_confirmed: args.routeConfirmed,
    mark_ready_requested: args.markReadyRequested,
    preparation_ready: args.preparationReady,
    updated_by: args.updatedBy,
  };
}

const MARK_READY_SOURCE_STATUSES = new Set(['planned', 'in_preparation']);
const MARK_READY_SATISFIED_STATUSES = new Set(['ready', 'departed', 'in_progress', 'completed']);
const VISIT_PREPARATION_PUT_SERIALIZABLE_RETRY_LIMIT = 2;

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

class VisitPreparationReadyTransitionError extends Error {
  constructor(readonly details: VisitReadyTransitionBlockers) {
    super(getVisitReadyTransitionErrorMessage(details));
    this.name = 'VisitPreparationReadyTransitionError';
  }
}

class VisitPreparationScheduleConflictError extends Error {
  constructor() {
    super('訪問予定が同時に更新されました。再読み込みしてください');
    this.name = 'VisitPreparationScheduleConflictError';
  }
}

class VisitPreparationVehicleCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisitPreparationVehicleCapacityError';
  }
}

async function withSerializableVisitPreparationPutTransaction<T>(
  orgId: string,
  ctx: AuthContext,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < VISIT_PREPARATION_PUT_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        requestContext: ctx,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === VISIT_PREPARATION_PUT_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new VisitPreparationScheduleConflictError();
      }
    }
  }

  throw new VisitPreparationScheduleConflictError();
}

async function authenticatedPUT(
  req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const { scheduleId } = await params;
  const normalizedScheduleId = normalizeRequiredRouteParam(scheduleId);
  if (!normalizedScheduleId) return validationError('訪問予定IDが不正です');
  if (!canManageVisitScheduleLifecycle(ctx)) {
    return forbiddenResponse('訪問準備を更新する権限がありません');
  }

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = upsertVisitPreparationSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: normalizedScheduleId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_id: true,
      site_id: true,
      vehicle_resource_id: true,
      carry_items_status: true,
      schedule_status: true,
      confirmed_at: true,
      scheduled_date: true,
      route_order: true,
      pharmacist_id: true,
      version: true,
      case_: {
        select: {
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
        },
      },
    },
  });
  if (!schedule) return notFound('訪問予定が見つかりません');
  if (!canAccessVisitScheduleAssignment(ctx, schedule)) {
    return forbiddenResponse('この訪問予定の準備情報を更新する権限がありません');
  }

  const readinessBlockers = buildVisitReadyReadinessBlockers(
    parsed.data,
    schedule.carry_items_status,
  );
  const preparationReady = readinessBlockers.length === 0;
  if (parsed.data.mark_ready && !preparationReady) {
    const details = {
      readiness_blockers: readinessBlockers,
      onboarding_blockers: [],
      billing_blockers: [],
    } satisfies VisitReadyTransitionBlockers;
    return validationError(
      getVisitReadyTransitionErrorMessage(details),
      sanitizeVisitReadyTransitionDetails(details),
    );
  }
  if (
    parsed.data.mark_ready &&
    !MARK_READY_SOURCE_STATUSES.has(schedule.schedule_status) &&
    !MARK_READY_SATISFIED_STATUSES.has(schedule.schedule_status)
  ) {
    return validationError('この訪問予定は ready へ進められません');
  }
  const shouldAdvanceScheduleToReady =
    parsed.data.mark_ready && !MARK_READY_SATISFIED_STATUSES.has(schedule.schedule_status);

  const templateOpts = parsed.data.template_options;
  const effectiveChecklist: Record<string, unknown> = templateOpts
    ? mergeChecklistWithTemplate(parsed.data.checklist, {
        narcoticsCarry: templateOpts.narcotics_carry,
        infectionControl: templateOpts.infection_control,
        coldChainRequired: templateOpts.cold_chain_required,
        facilityCustomItems: templateOpts.facility_custom_items,
      })
    : Object.keys(parsed.data.checklist).length === 0
      ? buildChecklistFromTemplate()
      : parsed.data.checklist;
  const normalizedChecklist = normalizeInputJsonObject(effectiveChecklist);
  const submittedRoutePlanSnapshot = parsed.data.route_plan_snapshot
    ? normalizeInputJsonObject(parsed.data.route_plan_snapshot)
    : null;
  const routeVehicleResourceId = parsed.data.route_confirmed
    ? (readRouteSnapshotVehicleResourceId(submittedRoutePlanSnapshot) ??
      schedule.vehicle_resource_id)
    : null;
  let routePlanSnapshotWriteValue: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
  let orderedRouteCellSchedulesForCapacity: Array<{ id: string }> = [{ id: schedule.id }];
  let routeVehicleResourceForCapacity: {
    label: string;
    max_stops: number | null;
  } | null = null;

  if (parsed.data.route_confirmed) {
    const { start, end } = buildVisitDayRange(schedule.scheduled_date);
    const [vehicleResource, routeCellSchedules, vehicleDaySchedules] = await Promise.all([
      routeVehicleResourceId
        ? prisma.visitVehicleResource.findFirst({
            where: {
              org_id: ctx.orgId,
              id: routeVehicleResourceId,
              available: true,
            },
            select: {
              id: true,
              site_id: true,
              label: true,
              travel_mode: true,
              max_stops: true,
              max_route_duration_minutes: true,
            },
          })
        : Promise.resolve(null),
      prisma.visitSchedule.findMany({
        where: schedule.pharmacist_id
          ? {
              org_id: ctx.orgId,
              pharmacist_id: schedule.pharmacist_id,
              scheduled_date: {
                gte: start,
                lt: end,
              },
              schedule_status: {
                notIn: ['cancelled', 'rescheduled'],
              },
              ...(schedule.site_id ? { site_id: schedule.site_id } : {}),
            }
          : {
              org_id: ctx.orgId,
              id: schedule.id,
            },
        orderBy: [{ route_order: 'asc' }, { time_window_start: 'asc' }, { created_at: 'asc' }],
        select: {
          id: true,
          route_order: true,
          priority: true,
          time_window_start: true,
          time_window_end: true,
          site: {
            select: {
              id: true,
              name: true,
              lat: true,
              lng: true,
            },
          },
          case_: {
            select: {
              patient: {
                select: {
                  name: true,
                  residences: {
                    where: { is_primary: true },
                    select: {
                      address: true,
                      lat: true,
                      lng: true,
                    },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      }),
      routeVehicleResourceId
        ? prisma.visitSchedule.findMany({
            where: {
              org_id: ctx.orgId,
              vehicle_resource_id: routeVehicleResourceId,
              scheduled_date: {
                gte: start,
                lt: end,
              },
              schedule_status: {
                notIn: ['cancelled', 'rescheduled'],
              },
              id: {
                not: schedule.id,
              },
            },
            select: {
              id: true,
            },
          })
        : Promise.resolve([]),
    ]);

    if (routeVehicleResourceId && !vehicleResource) {
      return validationError('選択した車両リソースが見つからないか利用できません');
    }
    if (vehicleResource && schedule.site_id && vehicleResource.site_id !== schedule.site_id) {
      return validationError('選択した車両リソースは訪問予定の拠点では利用できません');
    }
    routeVehicleResourceForCapacity = vehicleResource
      ? {
          label: vehicleResource.label,
          max_stops: vehicleResource.max_stops,
        }
      : null;
    const currentScheduleInRoute = routeCellSchedules.some((item) => item.id === schedule.id);
    const orderedRouteCellSchedules = currentScheduleInRoute
      ? routeCellSchedules
      : [
          ...routeCellSchedules,
          ...(await prisma.visitSchedule.findMany({
            where: {
              org_id: ctx.orgId,
              id: schedule.id,
            },
            select: {
              id: true,
              route_order: true,
              priority: true,
              time_window_start: true,
              time_window_end: true,
              site: {
                select: {
                  id: true,
                  name: true,
                  lat: true,
                  lng: true,
                },
              },
              case_: {
                select: {
                  patient: {
                    select: {
                      name: true,
                      residences: {
                        where: { is_primary: true },
                        select: {
                          address: true,
                          lat: true,
                          lng: true,
                        },
                        take: 1,
                      },
                    },
                  },
                },
              },
            },
          })),
        ];
    orderedRouteCellSchedulesForCapacity = orderedRouteCellSchedules.map((item) => ({
      id: item.id,
    }));
    const vehicleCapacityStopCount = countUniqueScheduleIdsForVehicleCapacity(
      vehicleDaySchedules,
      orderedRouteCellSchedules,
      [{ id: schedule.id }],
    );
    if (
      vehicleResource?.max_stops != null &&
      vehicleCapacityStopCount > vehicleResource.max_stops
    ) {
      return validationError(
        `${vehicleResource.label} で訪問できる件数は最大 ${vehicleResource.max_stops} 件です`,
      );
    }
    const originSite = orderedRouteCellSchedules[0]?.site ?? null;
    const origin =
      originSite?.lat != null && originSite.lng != null
        ? {
            lat: originSite.lat,
            lng: originSite.lng,
            label: originSite.name,
          }
        : null;
    const routableSchedules = orderedRouteCellSchedules.filter(
      (item) =>
        item.case_.patient.residences[0]?.lat != null &&
        item.case_.patient.residences[0]?.lng != null,
    );
    const routePlan = await computeOptimizedVisitRoute({
      origin,
      travelMode:
        vehicleResource?.travel_mode ??
        readRouteSnapshotTravelMode(submittedRoutePlanSnapshot) ??
        'DRIVE',
      waypoints: routableSchedules.map((item) => {
        const residence = item.case_.patient.residences[0]!;
        return {
          scheduleId: item.id,
          patientName: item.case_.patient.name,
          address: residence.address,
          lat: residence.lat!,
          lng: residence.lng!,
          priority: item.priority,
          timeWindow: visitRouteTimeWindowFromDbTime(item.time_window_start, item.time_window_end),
          serviceMinutes: DEFAULT_VISIT_ROUTE_SERVICE_MINUTES,
        };
      }),
    });
    const missingCoordinateCount = orderedRouteCellSchedules.filter(
      (item) => !routableSchedules.some((candidate) => candidate.id === item.id),
    ).length;
    const routePlanWithCellNotes =
      missingCoordinateCount > 0
        ? {
            ...routePlan,
            note: appendRouteNote(routePlan.note, `座標未設定: ${missingCoordinateCount}件`),
          }
        : routePlan;
    const generatedSnapshot = normalizeRoutePlanSnapshotForWrite(routePlanWithCellNotes, {
      scheduleIds: orderedRouteCellSchedules.map((item) => item.id),
      routeOrder: schedule.route_order,
      vehicleResource: vehicleResource
        ? {
            id: vehicleResource.id,
            label: vehicleResource.label,
            max_stops: vehicleResource.max_stops,
            max_route_duration_minutes: vehicleResource.max_route_duration_minutes,
          }
        : null,
      generatedAt: new Date(),
    });
    const generatedVehicleStatus = readJsonObject(
      generatedSnapshot.vehicle_resource,
    )?.constraint_status;
    if (generatedVehicleStatus === 'exceeded') {
      return validationError('選択した車両リソースの稼働上限を超えるためルート確認できません');
    }
    routePlanSnapshotWriteValue = generatedSnapshot;
  }

  let result;
  try {
    result = await withSerializableVisitPreparationPutTransaction(ctx.orgId, ctx, async (tx) => {
      if (routeVehicleResourceId && routeVehicleResourceForCapacity?.max_stops != null) {
        const { start, end } = buildVisitDayRange(schedule.scheduled_date);
        const currentVehicleDaySchedules = await tx.visitSchedule.findMany({
          where: {
            org_id: ctx.orgId,
            vehicle_resource_id: routeVehicleResourceId,
            scheduled_date: {
              gte: start,
              lt: end,
            },
            schedule_status: {
              notIn: ['cancelled', 'rescheduled'],
            },
            id: {
              not: schedule.id,
            },
          },
          select: {
            id: true,
          },
        });
        const currentVehicleCapacityStopCount = countUniqueScheduleIdsForVehicleCapacity(
          currentVehicleDaySchedules,
          orderedRouteCellSchedulesForCapacity,
          [{ id: schedule.id }],
        );
        if (currentVehicleCapacityStopCount > routeVehicleResourceForCapacity.max_stops) {
          throw new VisitPreparationVehicleCapacityError(
            `${routeVehicleResourceForCapacity.label} で訪問できる件数は最大 ${routeVehicleResourceForCapacity.max_stops} 件です`,
          );
        }
      }

      const preparation = await tx.visitPreparation.upsert({
        where: {
          schedule_id: schedule.id,
        },
        create: {
          org_id: ctx.orgId,
          schedule_id: schedule.id,
          checklist: normalizedChecklist,
          medication_changes_reviewed: parsed.data.medication_changes_reviewed,
          carry_items_confirmed: parsed.data.carry_items_confirmed,
          previous_issues_reviewed: parsed.data.previous_issues_reviewed,
          route_confirmed: parsed.data.route_confirmed,
          route_plan_snapshot: routePlanSnapshotWriteValue,
          offline_synced: parsed.data.offline_synced,
          prepared_by: ctx.userId,
          prepared_at: preparationReady ? new Date() : null,
        },
        update: {
          checklist: normalizedChecklist,
          medication_changes_reviewed: parsed.data.medication_changes_reviewed,
          carry_items_confirmed: parsed.data.carry_items_confirmed,
          previous_issues_reviewed: parsed.data.previous_issues_reviewed,
          route_confirmed: parsed.data.route_confirmed,
          route_plan_snapshot: routePlanSnapshotWriteValue,
          offline_synced: parsed.data.offline_synced,
          prepared_by: ctx.userId,
          prepared_at: preparationReady ? new Date() : null,
        },
      });

      if (shouldAdvanceScheduleToReady) {
        const readyTransition = await evaluateVisitScheduleReadyTransition(tx, {
          orgId: ctx.orgId,
          scheduleId: schedule.id,
        });
        if (!readyTransition.ok) {
          throw new VisitPreparationReadyTransitionError(readyTransition.details);
        }
      }

      if (shouldAdvanceScheduleToReady) {
        const updated = await tx.visitSchedule.updateMany({
          where: {
            id: schedule.id,
            org_id: ctx.orgId,
            version: schedule.version,
            confirmed_at: schedule.confirmed_at,
            pharmacist_id: schedule.pharmacist_id,
            scheduled_date: schedule.scheduled_date,
            schedule_status: schedule.schedule_status,
            vehicle_resource_id: schedule.vehicle_resource_id,
          },
          data: {
            ...(routeVehicleResourceId ? { vehicle_resource_id: routeVehicleResourceId } : {}),
            schedule_status: 'ready',
            pre_visit_checklist_completed: true,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new VisitPreparationScheduleConflictError();
        }
      } else if (routeVehicleResourceId) {
        const updated = await tx.visitSchedule.updateMany({
          where: {
            id: schedule.id,
            org_id: ctx.orgId,
            version: schedule.version,
            confirmed_at: schedule.confirmed_at,
            pharmacist_id: schedule.pharmacist_id,
            scheduled_date: schedule.scheduled_date,
            schedule_status: schedule.schedule_status,
            vehicle_resource_id: schedule.vehicle_resource_id,
          },
          data: {
            vehicle_resource_id: routeVehicleResourceId,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new VisitPreparationScheduleConflictError();
        }
      }

      const taskMetadata = buildVisitPreparationTaskMetadata({
        scheduleId: schedule.id,
        caseId: schedule.case_id,
        routeConfirmed: parsed.data.route_confirmed,
        markReadyRequested: parsed.data.mark_ready,
        preparationReady,
        updatedBy: ctx.userId,
      });
      let preparationTaskResolutionCount: number | null = null;

      if (preparationReady) {
        const resolvedTasks = (await resolveOperationalTasks(tx, {
          orgId: ctx.orgId,
          dedupeKey: buildPreparationTaskKey(schedule.id),
          status: 'completed',
        })) as { count?: number };
        preparationTaskResolutionCount =
          typeof resolvedTasks.count === 'number' ? resolvedTasks.count : null;
      } else {
        await upsertOperationalTask(tx, {
          orgId: ctx.orgId,
          taskType: 'visit_preparation',
          title: '訪問準備が未完了です',
          description: `未完了: ${readinessBlockers.join('、')}`,
          priority: 'high',
          assignedTo: schedule.pharmacist_id,
          dueDate: schedule.scheduled_date,
          slaDueAt: schedule.scheduled_date,
          relatedEntityType: 'visit_schedule',
          relatedEntityId: schedule.id,
          dedupeKey: buildPreparationTaskKey(schedule.id),
          metadata: taskMetadata,
        });
      }

      await createAuditLogEntry(tx, ctx, {
        action: 'visit_preparation_updated',
        targetType: 'VisitPreparation',
        targetId: preparation.id,
        changes: {
          schedule_id: schedule.id,
          case_id: schedule.case_id,
          preparation: {
            route_confirmed: parsed.data.route_confirmed,
            mark_ready_requested: parsed.data.mark_ready,
            preparation_ready: preparationReady,
            offline_synced: parsed.data.offline_synced,
          },
          schedule_transition: shouldAdvanceScheduleToReady
            ? {
                from: schedule.schedule_status,
                to: 'ready',
              }
            : null,
          vehicle_assignment: {
            changed:
              routeVehicleResourceId != null &&
              routeVehicleResourceId !== schedule.vehicle_resource_id,
            previous_vehicle_resource_id: schedule.vehicle_resource_id,
            vehicle_resource_id: routeVehicleResourceId,
          },
          task_trace: {
            action: preparationReady ? 'resolved' : 'upserted',
            task_type: 'visit_preparation',
            dedupe_key: buildPreparationTaskKey(schedule.id),
            status: preparationReady ? 'completed' : 'pending',
            resolution_count: preparationTaskResolutionCount,
            actor_user_id: ctx.userId,
          },
        },
      });

      return preparation;
    });
  } catch (cause) {
    if (cause instanceof VisitPreparationReadyTransitionError) {
      return validationError(cause.message, sanitizeVisitReadyTransitionDetails(cause.details));
    }
    if (cause instanceof VisitPreparationVehicleCapacityError) {
      return validationError(cause.message);
    }
    if (cause instanceof VisitPreparationScheduleConflictError) {
      return conflict(cause.message);
    }
    throw cause;
  }

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: {
      source: 'visit_preparations_update',
      schedule_id: schedule.id,
      case_id: schedule.case_id,
    },
  });

  return success({ data: result });
}

export const PUT = withAuthContext(authenticatedPUT, {
  permission: 'canVisit',
  message: '訪問準備情報の更新権限がありません',
});
