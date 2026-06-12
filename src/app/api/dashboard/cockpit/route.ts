import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { formatNullableDateKey } from '@/lib/date-key';
import { todayUtcRange } from '@/lib/utils/date-boundary';
import { extractPackagingInstructionTags } from '@/lib/dispensing/packaging';
import {
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';
import type {
  CockpitAuditQueueItem,
  CockpitBlockedReason,
  CockpitVisit,
  DashboardCockpitResponse,
} from '@/types/dashboard-cockpit';
import { buildTeamCapacity } from './team-capacity';

/**
 * new_01_dashboard(運用コックピット)用 BFF。
 * 条件バナー / 今すぐ対応(監査待ち中心) / 今日の流れ / 工程の今 / 右レールを
 * 1 リクエストで賄う読み取り専用集計(docs/design-gap-analysis-new.md new_01_dashboard)。
 */

const AUDIT_QUEUE_FETCH_LIMIT = 30;
const AUDIT_QUEUE_RESPONSE_LIMIT = 5;
const BLOCKED_REASONS_LIMIT = 3;

const TASK_PRIORITY_WEIGHT: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  normal: 2,
};

/** 危険タグの表示順(麻薬 → 冷所 → 一包化 → その他)。 */
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

type ExceptionPresentation = {
  category: string;
  actionLabel: string;
  actionHref: string;
};

/** WorkflowException.exception_type → 止まっている理由のカテゴリ/個別アクション。 */
const EXCEPTION_PRESENTATIONS: Record<string, ExceptionPresentation> = {
  consent_revoked: { category: '患者', actionLabel: '再連絡する →', actionHref: '/patients' },
  missing_visit_consent: { category: '患者', actionLabel: '再連絡する →', actionHref: '/patients' },
  family_consent_pending: {
    category: '患者',
    actionLabel: '再連絡する →',
    actionHref: '/patients',
  },
  medication_gap: { category: '患者', actionLabel: '状況を見る →', actionHref: '/patients' },
  prescription_structuring_block: {
    category: '医療機関',
    actionLabel: '状況を見る →',
    actionHref: '/prescriptions',
  },
  reduction_prohibited_drug: {
    category: '医療機関',
    actionLabel: '状況を見る →',
    actionHref: '/workflow',
  },
  outpatient_injection_eligibility_block: {
    category: '医療機関',
    actionLabel: '状況を見る →',
    actionHref: '/workflow',
  },
  dispense_audit_rejected: {
    category: '調剤',
    actionLabel: '状況を見る →',
    actionHref: '/dispensing',
  },
  partial_dispense: { category: '調剤', actionLabel: '状況を見る →', actionHref: '/dispensing' },
  set_audit_rejected: {
    category: '調剤',
    actionLabel: '状況を見る →',
    actionHref: '/medication-sets',
  },
};

const EXCEPTION_PRESENTATION_FALLBACK: ExceptionPresentation = {
  category: '事務',
  actionLabel: '状況を見る →',
  actionHref: '/workflow',
};

type AuditTaskLine = {
  packaging_instruction_tags: string[];
  packaging_instructions: string | null;
  notes: string | null;
  dispensing_method: string | null;
};

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

export const GET = withAuthContext(
  async (req, ctx) => {
    const now = new Date();
    // scheduled_date(@db.Date)比較用: ローカル日付の UTC 深夜レンジ
    const todayRange = todayUtcRange(now);
    // created_at(DateTime, 実時刻)比較用: 従来どおりローカル深夜
    const localTodayStart = new Date(now);
    localTodayStart.setHours(0, 0, 0, 0);

    const assignmentScope = await resolveDashboardAssignmentScope({
      db: prisma,
      orgId: ctx.orgId,
      accessContext: ctx,
    });
    const cycleCaseScope = assignmentScope.caseIds
      ? { case_id: { in: assignmentScope.caseIds } }
      : {};

    const [
      cycleCounts,
      auditTasks,
      todaySchedules,
      openExceptions,
      carryoverCount,
      teamMembers,
      todayShifts,
    ] = await Promise.all([
      prisma.medicationCycle.groupBy({
        by: ['overall_status'],
        where: {
          org_id: ctx.orgId,
          ...cycleCaseScope,
          overall_status: { notIn: ['cancelled'] },
        },
        _count: { id: true },
      }),
      prisma.dispenseTask.findMany({
        where: {
          org_id: ctx.orgId,
          status: 'completed',
          ...(assignmentScope.caseIds
            ? { cycle: { case_id: { in: assignmentScope.caseIds } } }
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
            orderBy: { audited_at: 'desc' },
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
      prisma.visitSchedule.findMany({
        where: {
          org_id: ctx.orgId,
          ...cycleCaseScope,
          scheduled_date: todayRange,
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
      }),
      prisma.workflowException.findMany({
        where: {
          org_id: ctx.orgId,
          status: 'open',
          ...(assignmentScope.caseIds
            ? {
                OR: [{ cycle_id: null }, { cycle: { case_id: { in: assignmentScope.caseIds } } }],
              }
            : {}),
        },
        orderBy: { created_at: 'asc' },
        take: BLOCKED_REASONS_LIMIT,
        select: {
          id: true,
          exception_type: true,
          description: true,
          severity: true,
          created_at: true,
        },
      }),
      prisma.task.count({
        where: {
          org_id: ctx.orgId,
          status: { in: ['pending', 'in_progress'] },
          created_at: { lt: localTodayStart },
          ...buildDashboardTaskAssignmentWhere(assignmentScope),
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
          date: todayRange,
        },
        select: {
          user_id: true,
          available: true,
          available_from: true,
          available_to: true,
        },
      }),
    ]);

    const cycleStatusCounts: Record<string, number> = {};
    for (const row of cycleCounts) {
      cycleStatusCounts[row.overall_status] = row._count.id;
    }

    const auditQueueAll: CockpitAuditQueueItem[] = auditTasks
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

    const todayVisits: CockpitVisit[] = todaySchedules.map((schedule) => ({
      id: schedule.id,
      patient_name: schedule.case_.patient.name,
      visit_type: schedule.visit_type,
      schedule_status: schedule.schedule_status,
      time_start: schedule.time_window_start?.toISOString() ?? null,
      time_end: schedule.time_window_end?.toISOString() ?? null,
      facility_batch_id: schedule.facility_batch_id,
    }));

    const blockedReasons: CockpitBlockedReason[] = openExceptions.map((exception) => {
      const presentation =
        EXCEPTION_PRESENTATIONS[exception.exception_type] ?? EXCEPTION_PRESENTATION_FALLBACK;
      return {
        id: exception.id,
        label: exception.description,
        severity: exception.severity === 'critical' ? 'critical' : 'warning',
        category: presentation.category,
        age_minutes: Math.max(
          0,
          Math.floor((now.getTime() - exception.created_at.getTime()) / 60_000),
        ),
        action_label: presentation.actionLabel,
        action_href: presentation.actionHref,
      } satisfies CockpitBlockedReason;
    });

    const responseData: DashboardCockpitResponse = {
      generated_at: now.toISOString(),
      cycle_status_counts: cycleStatusCounts,
      audit_pending_count: auditQueueAll.length,
      narcotic_audit_count: auditQueueAll.filter((item) => item.has_narcotic).length,
      audit_queue: auditQueueAll.slice(0, AUDIT_QUEUE_RESPONSE_LIMIT),
      today_visits: todayVisits,
      blocked_reasons: blockedReasons,
      carryover_count: carryoverCount,
      team_capacity: buildTeamCapacity(teamMembers, todayShifts, todaySchedules, now),
    };

    return success({ data: responseData });
  },
  {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  },
);
