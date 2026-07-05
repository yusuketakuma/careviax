import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { requireAuthContext, type AuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { COCKPIT_CACHE_TTL_MS } from '@/lib/constants/workflow';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { formatNullableDateKey } from '@/lib/date-key';
import { buildDispenseTaskHref } from '@/lib/dispense/navigation';
import { extractPackagingInstructionTags } from '@/lib/dispensing/packaging';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildSetPlanHref } from '@/lib/set/navigation';
import { canViewAllDashboardWork } from '@/lib/auth/visit-schedule-access';
import { buildVisitHref } from '@/lib/visits/navigation';
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
  CockpitCommentItem,
  CockpitVisit,
  DashboardCockpitCommentsResponse,
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
const COMMENT_FEED_FETCH_LIMIT = 80;
const COMMENT_FEED_RESPONSE_LIMIT = 5;
const COMMENT_EXCERPT_LENGTH = 96;

type DashboardScopeQuery =
  | { ok: true; scope: DashboardCockpitScope | null }
  | { ok: false; response: ReturnType<typeof validationError> };

type DashboardCockpitPart = 'full' | 'summary' | 'details' | 'team' | 'comments';

type DashboardCockpitSegmentResponse =
  | DashboardCockpitResponse
  | DashboardCockpitSummaryResponse
  | DashboardCockpitDetailsResponse
  | DashboardCockpitTeamResponse
  | DashboardCockpitCommentsResponse;

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

type DashboardCommentCandidate = {
  id: string;
  entity_type: CockpitCommentItem['entity_type'];
  entity_id: string;
  content: string;
  author_id: string;
  mentions: string[];
  created_at: Date;
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

const DASHBOARD_COMMENT_ENTITY_LABELS: Record<CockpitCommentItem['entity_type'], string> = {
  dispense_task: '調剤',
  medication_cycle: '処方サイクル',
  set_plan: 'セット',
  visit_record: '訪問記録',
  care_report: '報告書',
  patient: '患者',
};

function isDashboardCommentEntityType(value: string): value is CockpitCommentItem['entity_type'] {
  return value in DASHBOARD_COMMENT_ENTITY_LABELS;
}

function hasRestrictedDashboardScope(assignmentScope: DashboardAssignmentScope) {
  return assignmentScope.caseIds !== undefined || assignmentScope.patientIds !== undefined;
}

function createEntityIdBucket() {
  return {
    dispense_task: new Set<string>(),
    medication_cycle: new Set<string>(),
    set_plan: new Set<string>(),
    visit_record: new Set<string>(),
    care_report: new Set<string>(),
    patient: new Set<string>(),
  } satisfies Record<CockpitCommentItem['entity_type'], Set<string>>;
}

function normalizeCommentExcerpt(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'コメント本文なし';
  if (normalized.length <= COMMENT_EXCERPT_LENGTH) return normalized;
  return `${normalized.slice(0, COMMENT_EXCERPT_LENGTH - 1)}…`;
}

function buildDashboardCommentHref(
  comment: Pick<CockpitCommentItem, 'entity_type' | 'entity_id'>,
  cyclePatientIds: Map<string, string>,
) {
  switch (comment.entity_type) {
    case 'patient':
      return buildPatientHref(comment.entity_id);
    case 'dispense_task':
      return buildDispenseTaskHref(comment.entity_id);
    case 'set_plan':
      return buildSetPlanHref(comment.entity_id);
    case 'visit_record':
      return buildVisitHref(comment.entity_id);
    case 'care_report':
      return buildReportHref(comment.entity_id);
    case 'medication_cycle': {
      const patientId = cyclePatientIds.get(comment.entity_id);
      return patientId ? buildPatientHref(patientId) : '/handoff';
    }
    default:
      return '/handoff';
  }
}

async function readAllowedCommentEntities(args: {
  orgId: string;
  assignmentScope: DashboardAssignmentScope;
  entityIds: Record<CockpitCommentItem['entity_type'], Set<string>>;
}) {
  const allowed = createEntityIdBucket();
  const cyclePatientIds = new Map<string, string>();
  const restricted = hasRestrictedDashboardScope(args.assignmentScope);

  if (!restricted) {
    for (const entityType of Object.keys(args.entityIds) as CockpitCommentItem['entity_type'][]) {
      for (const id of args.entityIds[entityType]) {
        allowed[entityType].add(id);
      }
    }
  } else if (args.assignmentScope.patientIds && args.assignmentScope.patientIds.length > 0) {
    const allowedPatientIds = new Set(args.assignmentScope.patientIds);
    for (const id of args.entityIds.patient) {
      if (allowedPatientIds.has(id)) allowed.patient.add(id);
    }
  }

  const caseIds = args.assignmentScope.caseIds;
  const hasCaseScope = caseIds === undefined || caseIds.length > 0;

  const cycleIds = Array.from(args.entityIds.medication_cycle);
  const dispenseTaskIds = Array.from(args.entityIds.dispense_task);
  const setPlanIds = Array.from(args.entityIds.set_plan);
  const visitRecordIds = Array.from(args.entityIds.visit_record);
  const careReportIds = Array.from(args.entityIds.care_report);

  const [cycles, dispenseTasks, setPlans, visitRecords, careReports] = await Promise.all([
    cycleIds.length > 0 && hasCaseScope
      ? prisma.medicationCycle.findMany({
          where: {
            id: { in: cycleIds },
            org_id: args.orgId,
            ...(caseIds ? { case_id: { in: caseIds } } : {}),
          },
          select: { id: true, patient_id: true },
        })
      : [],
    dispenseTaskIds.length > 0 && hasCaseScope
      ? prisma.dispenseTask.findMany({
          where: {
            id: { in: dispenseTaskIds },
            org_id: args.orgId,
            ...(caseIds ? { cycle: { case_id: { in: caseIds } } } : {}),
          },
          select: { id: true },
        })
      : [],
    setPlanIds.length > 0 && hasCaseScope
      ? prisma.setPlan.findMany({
          where: {
            id: { in: setPlanIds },
            org_id: args.orgId,
            ...(caseIds ? { cycle: { case_id: { in: caseIds } } } : {}),
          },
          select: { id: true },
        })
      : [],
    visitRecordIds.length > 0 && hasCaseScope
      ? prisma.visitRecord.findMany({
          where: {
            id: { in: visitRecordIds },
            org_id: args.orgId,
            ...(caseIds ? { schedule: { case_id: { in: caseIds } } } : {}),
          },
          select: { id: true },
        })
      : [],
    careReportIds.length > 0 && hasCaseScope
      ? prisma.careReport.findMany({
          where: {
            id: { in: careReportIds },
            org_id: args.orgId,
            ...(caseIds
              ? {
                  OR: [
                    { case_id: { in: caseIds } },
                    ...(args.assignmentScope.patientIds &&
                    args.assignmentScope.patientIds.length > 0
                      ? [
                          {
                            case_id: null,
                            patient_id: { in: args.assignmentScope.patientIds },
                          },
                        ]
                      : []),
                  ],
                }
              : {}),
          },
          select: { id: true },
        })
      : [],
  ]);

  for (const cycle of cycles) {
    allowed.medication_cycle.add(cycle.id);
    cyclePatientIds.set(cycle.id, cycle.patient_id);
  }
  for (const task of dispenseTasks) allowed.dispense_task.add(task.id);
  for (const plan of setPlans) allowed.set_plan.add(plan.id);
  for (const record of visitRecords) allowed.visit_record.add(record.id);
  for (const report of careReports) allowed.care_report.add(report.id);

  return { allowed, cyclePatientIds };
}

async function readDashboardComments(args: {
  ctx: AuthContext;
  scopeContext: DashboardCockpitScopeContext;
}): Promise<DashboardCockpitCommentsResponse> {
  const rawComments = await prisma.taskComment.findMany({
    where: { org_id: args.ctx.orgId },
    orderBy: { created_at: 'desc' },
    take: COMMENT_FEED_FETCH_LIMIT,
    select: {
      id: true,
      entity_type: true,
      entity_id: true,
      content: true,
      author_id: true,
      mentions: true,
      created_at: true,
    },
  });
  const candidates: DashboardCommentCandidate[] = rawComments
    .filter((comment): comment is DashboardCommentCandidate =>
      isDashboardCommentEntityType(comment.entity_type),
    )
    .map((comment) => ({
      id: comment.id,
      entity_type: comment.entity_type,
      entity_id: comment.entity_id,
      content: comment.content,
      author_id: comment.author_id,
      mentions: comment.mentions,
      created_at: comment.created_at,
    }));

  const entityIds = createEntityIdBucket();
  for (const comment of candidates) {
    entityIds[comment.entity_type].add(comment.entity_id);
  }

  const { allowed, cyclePatientIds } = await readAllowedCommentEntities({
    orgId: args.ctx.orgId,
    assignmentScope: args.scopeContext.assignmentScope,
    entityIds,
  });

  const visibleCandidates = candidates.filter((comment) =>
    allowed[comment.entity_type].has(comment.entity_id),
  );
  const visible = visibleCandidates.slice(0, COMMENT_FEED_RESPONSE_LIMIT);
  const authorIds = Array.from(new Set(visible.map((comment) => comment.author_id)));
  const authors =
    authorIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: authorIds }, org_id: args.ctx.orgId },
          select: { id: true, name: true },
        });
  const authorMap = new Map(authors.map((author) => [author.id, author.name]));

  return {
    ...args.scopeContext.metadata,
    comments: visible.map((comment) => ({
      id: comment.id,
      entity_type: comment.entity_type,
      entity_id: comment.entity_id,
      entity_label: DASHBOARD_COMMENT_ENTITY_LABELS[comment.entity_type],
      author_id: comment.author_id,
      author_name: authorMap.get(comment.author_id) ?? '不明',
      content_excerpt: normalizeCommentExcerpt(comment.content),
      mentions_me: comment.mentions.includes(args.ctx.userId),
      authored_by_me: comment.author_id === args.ctx.userId,
      created_at: comment.created_at.toISOString(),
      href: buildDashboardCommentHref(comment, cyclePatientIds),
    })),
    comments_total_count: visibleCandidates.length,
    comments_visible_count: visible.length,
    comments_hidden_count: Math.max(visibleCandidates.length - visible.length, 0),
  };
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
  if (args.part === 'comments') {
    return readDashboardComments({ ctx: args.ctx, scopeContext });
  }

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
