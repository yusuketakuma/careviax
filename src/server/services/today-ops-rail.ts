import type { Prisma } from '@prisma/client';
import { format } from 'date-fns';
import { extractPackagingInstructionTags } from '@/lib/dispensing/packaging';
import { todayUtcRange } from '@/lib/utils/date-boundary';
import type {
  TodayOpsBlockedReason,
  TodayOpsNextAction,
  TodayOpsRail,
} from '@/types/today-ops-rail';

/**
 * design/images/new 共通の右レール「次にやること / 止まっている理由」を
 * 当日オペレーション(監査キュー + WorkflowException)から組み立てる集約。
 * 11_billing / 13_master の BFF が共有する(docs/design-gap-analysis-new.md
 * 「右レールは画面横断の共通供給源として設計するのが妥当」)。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 */

const AUDIT_QUEUE_FETCH_LIMIT = 30;
const BLOCKED_REASONS_LIMIT = 3;

const TASK_PRIORITY_WEIGHT: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  normal: 2,
};

/**
 * 止まっている理由: WorkflowException type → カテゴリ色チップ(患者/事務/医療機関)。
 * patients/[id]/card-workspace.tsx の Phase2a 合格マッピングと揃える。
 */
const EXCEPTION_CATEGORY_LABELS: Record<string, string> = {
  no_show: '患者',
  hospitalized: '患者',
  refused_receipt: '患者',
  discontinued_collection_unconfirmed: '患者',
  family_consent_pending: '患者',
  consent_revoked: '患者',
  missing_visit_consent: '患者',
  medication_gap: '患者',
  awaiting_reply: '医療機関',
  prescription_structuring_block: '事務',
  outpatient_injection_eligibility_block: '事務',
  delivery_target_confirmation: '事務',
  report_failed: '事務',
};

const EXCEPTION_CATEGORY_FALLBACK = '事務';

/** type 別の個別アクション(「再連絡する →」等)。card-workspace.tsx と同一導線。 */
const EXCEPTION_ACTIONS: Record<string, { label: string; href: string }> = {
  family_consent_pending: { label: '再連絡する →', href: '/communications/requests' },
  delivery_target_confirmation: { label: '状況を見る →', href: '/admin/contact-profiles' },
};

const EXCEPTION_ACTION_FALLBACK = { label: '状況を見る →', href: '/workflow' };

type AuditTaskRecord = {
  id: string;
  priority: string;
  due_date: Date | null;
  updated_at: Date | null;
  audits: Array<{ result: string }>;
  cycle: {
    case_: { patient: { name: string } };
    prescription_intakes: Array<{
      lines: Array<{
        packaging_instruction_tags: string[];
        packaging_instructions: string | null;
        notes: string | null;
        dispensing_method: string | null;
      }>;
    }>;
  };
};

function hasNarcoticLine(task: AuditTaskRecord): boolean {
  const lines = task.cycle.prescription_intakes[0]?.lines ?? [];
  return lines.some(
    (line) =>
      line.packaging_instruction_tags.includes('narcotic') ||
      extractPackagingInstructionTags({
        packagingInstructions: line.packaging_instructions,
        notes: line.notes,
      }).includes('narcotic'),
  );
}

/** 姓のみ(「田中 一郎」→「田中」)。区切りが無ければフルネーム。 */
function familyName(name: string): string {
  return name.split(/[\s　]+/)[0] || name;
}

function buildNextAction(
  topAudit: { patientName: string; dueAt: Date | null; hasNarcotic: boolean } | null,
  todayVisits: Array<{ patient_name: string; time_start: Date | null }>,
): TodayOpsNextAction {
  if (topAudit) {
    const auditLabel = topAudit.hasNarcotic ? '麻薬監査' : '監査';
    const label = topAudit.dueAt
      ? `${auditLabel}を開始 — ${format(topAudit.dueAt, 'HH:mm')}期限`
      : `${auditLabel}を開始する`;
    const visit = todayVisits.find(
      (item) => item.patient_name === topAudit.patientName && item.time_start != null,
    );
    const description = visit?.time_start
      ? `${format(visit.time_start, 'HH:mm')}訪問(${familyName(topAudit.patientName)}様)の持参薬です。完了で午後の予定がすべて確定します。`
      : `${topAudit.patientName} 様の調剤監査が待ちです。完了で次の工程が動き出します。`;
    return { label, description, href: '/audit' };
  }
  if (todayVisits.length > 0) {
    return {
      label: '訪問準備を確認する',
      description: `本日の訪問 ${todayVisits.length}件の準備状況を確認します。`,
      href: '/schedules',
    };
  }
  return {
    label: '今日の予定を確認する',
    description: 'いま期限で止まっている作業はありません。',
    href: '/schedules',
  };
}

/**
 * 右レール共通スナップショット。
 * - 次にやること: 監査待ち(麻薬最優先 → 優先度 → 期限)の先頭 1 件
 * - 止まっている理由: open な WorkflowException 上位 3 件(カテゴリ + 経過 + 個別導線)
 */
export async function buildTodayOpsRail(
  tx: Prisma.TransactionClient,
  orgId: string,
  now: Date = new Date(),
): Promise<TodayOpsRail> {
  // scheduled_date(@db.Date)比較用: ローカル日付の UTC 深夜レンジ
  const todayRange = todayUtcRange(now);

  const auditTasks = await tx.dispenseTask.findMany({
    where: { org_id: orgId, status: 'completed' },
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
          case_: { select: { patient: { select: { name: true } } } },
          prescription_intakes: {
            orderBy: { created_at: 'desc' },
            take: 1,
            select: {
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
  });
  const todaySchedules = await tx.visitSchedule.findMany({
    where: {
      org_id: orgId,
      scheduled_date: todayRange,
      schedule_status: { notIn: ['cancelled', 'rescheduled'] },
    },
    orderBy: [{ time_window_start: 'asc' }],
    select: {
      time_window_start: true,
      case_: { select: { patient: { select: { name: true } } } },
    },
  });
  const openExceptions = await tx.workflowException.findMany({
    where: { org_id: orgId, status: 'open' },
    orderBy: { created_at: 'asc' },
    take: BLOCKED_REASONS_LIMIT,
    select: {
      id: true,
      exception_type: true,
      description: true,
      severity: true,
      created_at: true,
    },
  });

  const pendingAudits = (auditTasks as AuditTaskRecord[])
    .filter((task) => {
      const latestAudit = task.audits[0] ?? null;
      return latestAudit == null || latestAudit.result === 'hold';
    })
    .map((task) => ({
      patientName: task.cycle.case_.patient.name,
      dueAt: task.due_date,
      hasNarcotic: hasNarcoticLine(task),
      priorityWeight: TASK_PRIORITY_WEIGHT[task.priority] ?? 2,
      waitingSince: task.updated_at,
    }))
    .sort((left, right) => {
      if (left.hasNarcotic !== right.hasNarcotic) return left.hasNarcotic ? -1 : 1;
      if (left.priorityWeight !== right.priorityWeight)
        return left.priorityWeight - right.priorityWeight;
      const leftDue = left.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightDue = right.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (leftDue !== rightDue) return leftDue - rightDue;
      return (left.waitingSince?.getTime() ?? 0) - (right.waitingSince?.getTime() ?? 0);
    });

  const todayVisits = todaySchedules.map((schedule) => ({
    patient_name: schedule.case_.patient.name,
    time_start: schedule.time_window_start,
  }));

  const blockedReasons: TodayOpsBlockedReason[] = openExceptions.map((exception) => {
    const action = EXCEPTION_ACTIONS[exception.exception_type] ?? EXCEPTION_ACTION_FALLBACK;
    return {
      id: exception.id,
      label: exception.description,
      severity: exception.severity === 'critical' ? 'critical' : 'warning',
      category: EXCEPTION_CATEGORY_LABELS[exception.exception_type] ?? EXCEPTION_CATEGORY_FALLBACK,
      age_minutes: Math.max(
        0,
        Math.floor((now.getTime() - exception.created_at.getTime()) / 60_000),
      ),
      action_label: action.label,
      action_href: action.href,
    };
  });

  return {
    next_action: buildNextAction(pendingAudits[0] ?? null, todayVisits),
    blocked_reasons: blockedReasons,
  };
}
