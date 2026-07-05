import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { requireAuthContext, type AuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { COCKPIT_CACHE_TTL_MS } from '@/lib/constants/workflow';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { formatNullableDateKey } from '@/lib/date-key';
import { extractPackagingInstructionTags } from '@/lib/dispensing/packaging';
import { canViewAllDashboardWork } from '@/lib/auth/visit-schedule-access';
import { timeDateToString } from '@/lib/visits/time-of-day';
import { serverCache } from '@/lib/utils/server-cache';
import { japanDayInstantRange, todayUtcRange } from '@/lib/utils/date-boundary';
import {
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
  type DashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';
import {
  buildCockpitCacheKey,
  buildWorkflowAssignmentScopeFingerprint,
} from '@/server/services/workflow-dashboard-cache';
import { buildBlockedReasons } from '@/lib/workflow/blocked-reason-projection';
import type {
  CockpitAuditQueueItem,
  CockpitBlockedReason,
  CockpitVisit,
  DashboardCockpitDetailsResponse,
  DashboardCockpitResponse,
  DashboardCockpitScope,
  DashboardCockpitScopeMetadata,
  DashboardCockpitSummaryResponse,
  DashboardCockpitTeamResponse,
} from '@/types/dashboard-cockpit';
import { buildTeamCapacity } from '@/app/api/dashboard/cockpit/team-capacity';

const AUDIT_QUEUE_FETCH_LIMIT = 30;
const AUDIT_QUEUE_RESPONSE_LIMIT = 5;
const BLOCKED_REASONS_LIMIT = 3;

type DashboardScopeQuery =
  | { ok: true; scope: DashboardCockpitScope | null }
  | { ok: false; response: ReturnType<typeof validationError> };

type DashboardCockpitPart = 'full' | 'summary' | 'details' | 'team';

type DashboardCockpitSegmentResponse =
  | DashboardCockpitResponse
  | DashboardCockpitSummaryResponse
  | DashboardCockpitDetailsResponse
  | DashboardCockpitTeamResponse;

type DashboardCockpitScopeContext = {
  now: Date;
  todayRange: ReturnType<typeof todayUtcRange>;
  todayInstantStart: Date;
  requestedScope: DashboardCockpitScope | null;
  appliedScope: DashboardCockpitScope;
  canViewTeam: boolean;
  assignmentScope: DashboardAssignmentScope;
  metadata: DashboardCockpitScopeMetadata;
  cacheKey: string;
};

type AuditTaskLine = {
  packaging_instruction_tags: string[];
  packaging_instructions: string | null;
  notes: string | null;
  dispensing_method: string | null;
};

type AuditQueueCountRow = {
  count: bigint | number | string | null;
};

const TASK_PRIORITY_WEIGHT: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  normal: 2,
};

const HANDLING_TAG_ORDER = [
  'narcotic',
  'cold_storage',
  'unit_dose',
  'half_tablet',
  'crush_prohibited',
  'separate_pack',
  'staple_required',
  'label_required',
];

export function parseDashboardScope(req: Request): DashboardScopeQuery {
  const values = new URL(req.url).searchParams.getAll('scope');
  if (values.length === 0) return { ok: true, scope: null };
  if (values.length > 1) {
    return {
      ok: false,
      response: validationError('検索条件が不正です', {
        scope: ['scope は1つだけ指定してください'],
      }),
    };
  }

  const rawValue = values[0] ?? '';
  const scope = rawValue.trim();
  if (!scope || scope !== rawValue || (scope !== 'mine' && scope !== 'team')) {
    return {
      ok: false,
      response: validationError('検索条件が不正です', { scope: ['scope が不正です'] }),
    };
  }

  return { ok: true, scope };
}

function collectHandlingTags(lines: AuditTaskLine[]): string[] {
  const tags = new Set<string>();
  for (const line of lines) {
    for (const tag of line.packaging_instruction_tags) {
      tags.add(tag);
    }
    if (line.dispensing_method === 'unit_dose') {
      tags.add('unit_dose');
    }
    for (const tag of extractPackagingInstructionTags({
      packagingInstructions: line.packaging_instructions,
      notes: line.notes,
    })) {
      tags.add(tag);
    }
  }
  return HANDLING_TAG_ORDER.filter((tag) => tags.has(tag));
}

function compareAuditQueueItems(left: CockpitAuditQueueItem, right: CockpitAuditQueueItem) {
  if (left.has_narcotic !== right.has_narcotic) return left.has_narcotic ? -1 : 1;
  const weightDiff =
    (TASK_PRIORITY_WEIGHT[left.priority] ?? 2) - (TASK_PRIORITY_WEIGHT[right.priority] ?? 2);
  if (weightDiff !== 0) return weightDiff;
  if (left.due_at && right.due_at) return left.due_at.localeCompare(right.due_at);
  if (left.due_at) return -1;
  if (right.due_at) return 1;
  return (left.waiting_since ?? '').localeCompare(right.waiting_since ?? '');
}

function readCount(value: AuditQueueCountRow['count'] | undefined): number {
  if (typeof value === 'bigint') return Number(value);
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function buildSegmentCacheKey(baseKey: string, part: DashboardCockpitPart) {
  return part === 'full' ? baseKey : `${baseKey}:${part}`;
}

async function countAuditQueueItems(args: { orgId: string; caseIds?: string[] }) {
  if (args.caseIds && args.caseIds.length === 0) return 0;

  const caseScope = args.caseIds
    ? Prisma.sql`AND cycle."case_id" IN (${Prisma.join(args.caseIds)})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<AuditQueueCountRow[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "DispenseTask" task
    INNER JOIN "MedicationCycle" cycle
      ON cycle."id" = task."cycle_id"
      AND cycle."org_id" = task."org_id"
    LEFT JOIN LATERAL (
      SELECT audit."result"
      FROM "DispenseAudit" audit
      WHERE audit."task_id" = task."id"
        AND audit."org_id" = task."org_id"
      ORDER BY audit."audited_at" DESC, audit."created_at" DESC, audit."id" DESC
      LIMIT 1
    ) latest_audit ON TRUE
    WHERE task."org_id" = ${args.orgId}
      AND task."status" = 'completed'
      ${caseScope}
      AND (latest_audit."result" IS NULL OR latest_audit."result"::text = 'hold')
  `);

  return readCount(rows[0]?.count);
}

async function resolveCockpitScopeContext(args: {
  ctx: AuthContext;
  requestedScope: DashboardCockpitScope | null;
  part: DashboardCockpitPart;
}): Promise<DashboardCockpitScopeContext> {
  const now = new Date();
  const canViewTeam = canViewAllDashboardWork(args.ctx);
  const appliedScope: DashboardCockpitScope =
    args.requestedScope === 'team'
      ? canViewTeam
        ? 'team'
        : 'mine'
      : args.requestedScope === 'mine'
        ? 'mine'
        : canViewTeam
          ? 'team'
          : 'mine';
  const todayRange = todayUtcRange(now);
  const todayInstantStart = japanDayInstantRange(now).gte;
  const assignmentScope = await resolveDashboardAssignmentScope({
    db: prisma,
    orgId: args.ctx.orgId,
    accessContext: args.ctx,
    scope: args.requestedScope ? appliedScope : 'role_default',
  });
  const baseCacheKey = buildCockpitCacheKey(
    args.ctx.orgId,
    args.ctx.role,
    args.ctx.userId,
    todayRange.gte,
    appliedScope,
    buildWorkflowAssignmentScopeFingerprint(assignmentScope),
  );

  return {
    now,
    todayRange,
    todayInstantStart,
    requestedScope: args.requestedScope,
    appliedScope,
    canViewTeam,
    assignmentScope,
    metadata: {
      generated_at: now.toISOString(),
      scope: {
        requested: args.requestedScope ?? appliedScope,
        applied: appliedScope,
        can_view_team: canViewTeam,
      },
    },
    cacheKey: buildSegmentCacheKey(baseCacheKey, args.part),
  };
}

function buildCycleCaseScope(assignmentScope: DashboardAssignmentScope) {
  return assignmentScope.caseIds ? { case_id: { in: assignmentScope.caseIds } } : {};
}

async function readCycleStatusCounts(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
}) {
  const rows = await prisma.medicationCycle.groupBy({
    by: ['overall_status'],
    where: {
      org_id: args.orgId,
      ...buildCycleCaseScope(args.assignmentScope),
      overall_status: { notIn: ['cancelled'] },
    },
    _count: { id: true },
  });

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.overall_status] = row._count.id;
  }
  return counts;
}

async function readAuditQueue(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
}): Promise<{ all: CockpitAuditQueueItem[]; totalCount: number }> {
  const [auditTasks, totalCount] = await Promise.all([
    prisma.dispenseTask.findMany({
      where: {
        org_id: args.orgId,
        status: 'completed',
        ...(args.assignmentScope.caseIds
          ? { cycle: { case_id: { in: args.assignmentScope.caseIds } } }
          : {}),
      },
      orderBy: [{ priority: 'asc' }, { due_date: 'asc' }, { updated_at: 'asc' }],
      take: AUDIT_QUEUE_FETCH_LIMIT,
      select: {
        id: true,
        priority: true,
        due_date: true,
        updated_at: true,
        audits: {
          orderBy: [{ audited_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { result: true },
        },
        cycle: {
          select: {
            id: true,
            case_: {
              select: {
                patient: { select: { name: true } },
              },
            },
            prescription_intakes: {
              orderBy: { created_at: 'desc' },
              take: 1,
              select: {
                id: true,
                prescribed_date: true,
                lines: {
                  select: {
                    packaging_instruction_tags: true,
                    packaging_instructions: true,
                    notes: true,
                    dispensing_method: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    countAuditQueueItems({
      orgId: args.orgId,
      caseIds: args.assignmentScope.caseIds,
    }),
  ]);

  const all = auditTasks
    .filter((task) => {
      const latestAudit = task.audits[0] ?? null;
      return latestAudit == null || latestAudit.result === 'hold';
    })
    .map((task) => {
      const intake = task.cycle.prescription_intakes[0] ?? null;
      const handlingTags = collectHandlingTags(intake?.lines ?? []);
      return {
        task_id: task.id,
        cycle_id: task.cycle.id,
        patient_name: task.cycle.case_.patient.name,
        priority: task.priority,
        due_at: task.due_date?.toISOString() ?? null,
        intake_id: intake?.id ?? null,
        prescribed_date: formatNullableDateKey(intake?.prescribed_date ?? null),
        handling_tags: handlingTags,
        has_narcotic: handlingTags.includes('narcotic'),
        waiting_since: task.updated_at?.toISOString() ?? null,
      } satisfies CockpitAuditQueueItem;
    })
    .sort(compareAuditQueueItems);

  return { all, totalCount };
}

async function readTodayVisits(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
  todayRange: ReturnType<typeof todayUtcRange>;
}) {
  const rows = await prisma.visitSchedule.findMany({
    where: {
      org_id: args.orgId,
      ...buildCycleCaseScope(args.assignmentScope),
      scheduled_date: args.todayRange,
      schedule_status: { notIn: ['cancelled', 'rescheduled'] },
    },
    orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }],
    select: {
      id: true,
      visit_type: true,
      schedule_status: true,
      time_window_start: true,
      time_window_end: true,
      facility_batch_id: true,
      pharmacist_id: true,
      case_: {
        select: {
          patient: { select: { name: true } },
        },
      },
    },
  });

  return rows;
}

function mapTodayVisits(rows: Awaited<ReturnType<typeof readTodayVisits>>): CockpitVisit[] {
  return rows.map((schedule) => ({
    id: schedule.id,
    patient_name: schedule.case_.patient.name,
    visit_type: schedule.visit_type,
    schedule_status: schedule.schedule_status,
    time_start: timeDateToString(schedule.time_window_start) ?? null,
    time_end: timeDateToString(schedule.time_window_end) ?? null,
    facility_batch_id: schedule.facility_batch_id,
  }));
}

async function buildCockpitSummary(
  ctx: AuthContext,
  scopeContext: DashboardCockpitScopeContext,
): Promise<DashboardCockpitSummaryResponse> {
  const [cycleStatusCounts, auditQueue, todaySchedules] = await Promise.all([
    readCycleStatusCounts({ orgId: ctx.orgId, assignmentScope: scopeContext.assignmentScope }),
    readAuditQueue({ orgId: ctx.orgId, assignmentScope: scopeContext.assignmentScope }),
    readTodayVisits({
      orgId: ctx.orgId,
      assignmentScope: scopeContext.assignmentScope,
      todayRange: scopeContext.todayRange,
    }),
  ]);
  const todayVisitTimes = todaySchedules
    .map((schedule) => timeDateToString(schedule.time_window_start))
    .filter((value): value is string => value != null);

  return {
    ...scopeContext.metadata,
    cycle_status_counts: cycleStatusCounts,
    audit_pending_count: auditQueue.totalCount,
    audit_queue_total_count: auditQueue.totalCount,
    narcotic_audit_count: auditQueue.all.filter((item) => item.has_narcotic).length,
    earliest_audit_due_at:
      auditQueue.all
        .map((item) => item.due_at)
        .filter((dueAt): dueAt is string => dueAt != null)
        .sort()[0] ?? null,
    today_visit_count: todaySchedules.length,
    today_visit_times: todayVisitTimes,
  };
}

async function buildCockpitDetails(
  ctx: AuthContext,
  scopeContext: DashboardCockpitScopeContext,
): Promise<DashboardCockpitDetailsResponse> {
  const [auditQueue, todaySchedules, openExceptions, carryoverCount] = await Promise.all([
    readAuditQueue({ orgId: ctx.orgId, assignmentScope: scopeContext.assignmentScope }),
    readTodayVisits({
      orgId: ctx.orgId,
      assignmentScope: scopeContext.assignmentScope,
      todayRange: scopeContext.todayRange,
    }),
    prisma.workflowException.findMany({
      where: {
        org_id: ctx.orgId,
        status: 'open',
        ...(scopeContext.assignmentScope.caseIds
          ? {
              OR: [
                { cycle_id: null },
                { cycle: { case_id: { in: scopeContext.assignmentScope.caseIds } } },
              ],
            }
          : {}),
      },
      orderBy: { created_at: 'asc' },
      take: BLOCKED_REASONS_LIMIT,
      select: {
        id: true,
        exception_type: true,
        patient_id: true,
        description: true,
        severity: true,
        created_at: true,
      },
    }),
    prisma.task.count({
      where: {
        org_id: ctx.orgId,
        status: { in: ['pending', 'in_progress'] },
        created_at: { lt: scopeContext.todayInstantStart },
        ...buildDashboardTaskAssignmentWhere(scopeContext.assignmentScope),
      },
    }),
  ]);

  const visibleQueue = auditQueue.all.slice(0, AUDIT_QUEUE_RESPONSE_LIMIT);
  return {
    ...scopeContext.metadata,
    audit_queue_total_count: auditQueue.totalCount,
    audit_queue_visible_count: visibleQueue.length,
    audit_queue_hidden_count: Math.max(auditQueue.totalCount - visibleQueue.length, 0),
    audit_queue: visibleQueue,
    today_visits: mapTodayVisits(todaySchedules),
    blocked_reasons: buildBlockedReasons(
      openExceptions,
      scopeContext.now,
    ) as CockpitBlockedReason[],
    carryover_count: carryoverCount,
  };
}

async function buildCockpitTeam(
  ctx: AuthContext,
  scopeContext: DashboardCockpitScopeContext,
): Promise<DashboardCockpitTeamResponse> {
  const [todaySchedules, teamMembers, todayShifts] = await Promise.all([
    readTodayVisits({
      orgId: ctx.orgId,
      assignmentScope: scopeContext.assignmentScope,
      todayRange: scopeContext.todayRange,
    }),
    prisma.membership.findMany({
      where: {
        org_id: ctx.orgId,
        is_active: true,
        user: { is_active: true },
      },
      orderBy: { created_at: 'asc' },
      select: {
        user_id: true,
        role: true,
        user: { select: { name: true } },
      },
    }),
    prisma.pharmacistShift.findMany({
      where: {
        org_id: ctx.orgId,
        date: scopeContext.todayRange,
      },
      select: {
        user_id: true,
        available: true,
        available_from: true,
        available_to: true,
      },
    }),
  ]);

  return {
    ...scopeContext.metadata,
    team_capacity: buildTeamCapacity(teamMembers, todayShifts, todaySchedules, scopeContext.now),
  };
}

async function buildCockpitFull(
  ctx: AuthContext,
  scopeContext: DashboardCockpitScopeContext,
): Promise<DashboardCockpitResponse> {
  const [
    cycleStatusCounts,
    auditQueue,
    todaySchedules,
    openExceptions,
    carryoverCount,
    teamMembers,
    todayShifts,
  ] = await Promise.all([
    readCycleStatusCounts({ orgId: ctx.orgId, assignmentScope: scopeContext.assignmentScope }),
    readAuditQueue({ orgId: ctx.orgId, assignmentScope: scopeContext.assignmentScope }),
    readTodayVisits({
      orgId: ctx.orgId,
      assignmentScope: scopeContext.assignmentScope,
      todayRange: scopeContext.todayRange,
    }),
    prisma.workflowException.findMany({
      where: {
        org_id: ctx.orgId,
        status: 'open',
        ...(scopeContext.assignmentScope.caseIds
          ? {
              OR: [
                { cycle_id: null },
                { cycle: { case_id: { in: scopeContext.assignmentScope.caseIds } } },
              ],
            }
          : {}),
      },
      orderBy: { created_at: 'asc' },
      take: BLOCKED_REASONS_LIMIT,
      select: {
        id: true,
        exception_type: true,
        patient_id: true,
        description: true,
        severity: true,
        created_at: true,
      },
    }),
    prisma.task.count({
      where: {
        org_id: ctx.orgId,
        status: { in: ['pending', 'in_progress'] },
        created_at: { lt: scopeContext.todayInstantStart },
        ...buildDashboardTaskAssignmentWhere(scopeContext.assignmentScope),
      },
    }),
    prisma.membership.findMany({
      where: {
        org_id: ctx.orgId,
        is_active: true,
        user: { is_active: true },
      },
      orderBy: { created_at: 'asc' },
      select: {
        user_id: true,
        role: true,
        user: { select: { name: true } },
      },
    }),
    prisma.pharmacistShift.findMany({
      where: {
        org_id: ctx.orgId,
        date: scopeContext.todayRange,
      },
      select: {
        user_id: true,
        available: true,
        available_from: true,
        available_to: true,
      },
    }),
  ]);
  const visibleQueue = auditQueue.all.slice(0, AUDIT_QUEUE_RESPONSE_LIMIT);

  return {
    ...scopeContext.metadata,
    cycle_status_counts: cycleStatusCounts,
    audit_pending_count: auditQueue.totalCount,
    audit_queue_total_count: auditQueue.totalCount,
    audit_queue_visible_count: visibleQueue.length,
    audit_queue_hidden_count: Math.max(auditQueue.totalCount - visibleQueue.length, 0),
    narcotic_audit_count: auditQueue.all.filter((item) => item.has_narcotic).length,
    audit_queue: visibleQueue,
    today_visits: mapTodayVisits(todaySchedules),
    blocked_reasons: buildBlockedReasons(
      openExceptions,
      scopeContext.now,
    ) as CockpitBlockedReason[],
    carryover_count: carryoverCount,
    team_capacity: buildTeamCapacity(teamMembers, todayShifts, todaySchedules, scopeContext.now),
  };
}

async function buildCockpitSegment(args: {
  ctx: AuthContext;
  requestedScope: DashboardCockpitScope | null;
  part: DashboardCockpitPart;
}): Promise<DashboardCockpitSegmentResponse> {
  const scopeContext = await resolveCockpitScopeContext({
    ctx: args.ctx,
    requestedScope: args.requestedScope,
    part: args.part,
  });
  const cachedData = serverCache.get<DashboardCockpitSegmentResponse>(scopeContext.cacheKey);
  if (cachedData) return cachedData;

  const data =
    args.part === 'summary'
      ? await buildCockpitSummary(args.ctx, scopeContext)
      : args.part === 'details'
        ? await buildCockpitDetails(args.ctx, scopeContext)
        : args.part === 'team'
          ? await buildCockpitTeam(args.ctx, scopeContext)
          : await buildCockpitFull(args.ctx, scopeContext);

  serverCache.set(scopeContext.cacheKey, data, COCKPIT_CACHE_TTL_MS);
  return data;
}

export async function dashboardCockpitSegmentResponse(
  req: NextRequest,
  part: DashboardCockpitPart,
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const scopeQuery = parseDashboardScope(req);
    if (!scopeQuery.ok) return scopeQuery.response;

    const data = await buildCockpitSegment({
      ctx,
      requestedScope: scopeQuery.scope,
      part,
    });
    return success({ data });
  });
}
