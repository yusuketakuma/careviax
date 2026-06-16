import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { withOrgContext } from '@/lib/db/rls';
import type {
  SetLaneCounts,
  SetPendingItem,
  SetWorkspaceFacilityGroup,
  SetWorkspaceResponse,
  SetWorkspaceRow,
} from '@/app/(dashboard)/set/set-workspace.shared';
import { deriveRowStatus, deriveSlotMarks } from './set-derivations';

/**
 * new_09_set(セット準備ワークスペース)用 BFF。
 * 施設 × 訪問時刻でグルーピングした居室別セット作業テーブル
 * (居室/患者/朝昼夕/状態/担当)+ レーン別件数(通常/冷所/麻薬)+
 * 「工程待ちのセット」(監査待ち/明日先行可)を 1 リクエストで返す読み取り専用集計。
 * docs/design-gap-analysis-new.md 09_set セクション準拠。
 *
 * 注: 所要分・先行可能枠は専用スキーマが無いため、患者数 × 標準見込み
 * (SET_MINUTES_PER_PATIENT / PREWORK_MINUTES_PER_PATIENT)で算出する。
 */

const querySchema = z.object({
  scope: z.enum(['today', 'upcoming']).optional(),
});

/** セット 1 患者分の標準所要見込み(分)。専用フィールドのスキーマ化までの既定値 */
const SET_MINUTES_PER_PATIENT = 15;
/** 先行準備 1 患者分の標準見込み(分) */
const PREWORK_MINUTES_PER_PATIENT = 10;
const UPCOMING_WINDOW_DAYS = 7;

const HANDLING_TAG_SHORT_LABELS: Record<string, string> = {
  narcotic: '麻薬',
  cold_storage: '冷所',
};

function formatTimeOfDay(value: Date): string {
  const hours = `${value.getHours()}`.padStart(2, '0');
  const minutes = `${value.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

type RoleLike = { role: string } | undefined;

/** 担当ラベル: 事務は「名前(事務)」、薬剤師等は名前のみ(09_set の表記) */
function buildAssigneeLabel(name: string, membership: RoleLike): string {
  if (membership?.role === 'clerk') return `${name}(事務)`;
  return name;
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const url = new URL(req.url);
    const parsedQuery = querySchema.safeParse({
      scope: url.searchParams.get('scope') ?? undefined,
    });
    if (!parsedQuery.success) {
      return validationError('クエリパラメータが不正です', parsedQuery.error.flatten());
    }
    const scope = parsedQuery.data.scope ?? 'today';

    const now = new Date();
    // scheduled_date(@db.Date)比較用: ローカル日付の UTC 深夜境界
    const today = utcDateFromLocalKey(localDateKey(now));
    const tomorrow = addUtcDays(today, 1);
    const windowStart = scope === 'today' ? today : tomorrow;
    const windowEnd = scope === 'today' ? tomorrow : addUtcDays(tomorrow, UPCOMING_WINDOW_DAYS);

    const data = await withOrgContext(ctx.orgId, async (tx) => {
      const schedules = await tx.visitSchedule.findMany({
        where: {
          org_id: ctx.orgId,
          scheduled_date: { gte: windowStart, lt: windowEnd },
          schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        },
        orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }],
        select: {
          id: true,
          case_id: true,
          pharmacist_id: true,
          time_window_start: true,
          case_: {
            select: {
              id: true,
              patient: {
                select: {
                  id: true,
                  name: true,
                  allergy_info: true,
                  residences: {
                    where: { is_primary: true },
                    take: 1,
                    select: {
                      unit_name: true,
                      facility_id: true,
                      facility: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const caseIds = [...new Set(schedules.map((schedule) => schedule.case_id))];
      const [plans, auditWaitingCycles, tomorrowSchedules, coldExceptionCount] =
        await Promise.all([
          caseIds.length > 0
            ? tx.setPlan.findMany({
                where: { org_id: ctx.orgId, cycle: { case_id: { in: caseIds } } },
                orderBy: { created_at: 'desc' },
                select: {
                  id: true,
                  target_period_start: true,
                  target_period_end: true,
                  cycle: { select: { case_id: true } },
                  batches: {
                    select: {
                      line_id: true,
                      slot: true,
                      day_number: true,
                      packaging_instruction_tags_snapshot: true,
                    },
                  },
                  audits: {
                    orderBy: { audited_at: 'desc' },
                    take: 1,
                    select: { result: true },
                  },
                  change_logs: {
                    orderBy: { created_at: 'desc' },
                    take: 1,
                    select: { changed_by: true },
                  },
                },
              })
            : Promise.resolve([]),
          scope === 'today' && caseIds.length > 0
            ? tx.medicationCycle.findMany({
                where: {
                  org_id: ctx.orgId,
                  case_id: { in: caseIds },
                  overall_status: { in: ['dispensed', 'audit_pending'] },
                },
                select: {
                  id: true,
                  case_id: true,
                  case_: { select: { patient: { select: { name: true } } } },
                  prescription_intakes: {
                    orderBy: { created_at: 'desc' },
                    take: 1,
                    select: {
                      lines: { select: { packaging_instruction_tags: true } },
                    },
                  },
                },
              })
            : Promise.resolve([]),
          scope === 'today'
            ? tx.visitSchedule.findMany({
                where: {
                  org_id: ctx.orgId,
                  scheduled_date: { gte: tomorrow, lt: addUtcDays(tomorrow, 1) },
                  schedule_status: { notIn: ['cancelled', 'rescheduled'] },
                  case_: { medication_cycles: { some: { overall_status: 'audited' } } },
                },
                orderBy: [{ time_window_start: 'asc' }],
                select: {
                  id: true,
                  case_: {
                    select: {
                      patient: { select: { id: true, name: true } },
                      medication_cycles: {
                        where: { overall_status: 'audited' },
                        take: 1,
                        select: {
                          prescription_intakes: {
                            orderBy: { created_at: 'desc' },
                            take: 1,
                            select: {
                              lines: { select: { packaging_instruction_tags: true } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              })
            : Promise.resolve([]),
          tx.workflowException.count({
            where: {
              org_id: ctx.orgId,
              status: 'open',
              exception_type: { contains: 'cold' },
            },
          }),
        ]);

      // 担当ラベル用のユーザー名+ロール(変更ログの actor / 訪問担当薬剤師)
      const userIds = new Set<string>();
      for (const schedule of schedules) userIds.add(schedule.pharmacist_id);
      for (const plan of plans) {
        const changedBy = plan.change_logs[0]?.changed_by;
        if (changedBy) userIds.add(changedBy);
      }
      const users =
        userIds.size > 0
          ? await tx.user.findMany({
              where: { id: { in: [...userIds] } },
              select: {
                id: true,
                name: true,
                memberships: {
                  where: { org_id: ctx.orgId, is_active: true },
                  take: 1,
                  select: { role: true },
                },
              },
            })
          : [];

      return {
        schedules,
        plans,
        auditWaitingCycles,
        tomorrowSchedules,
        coldExceptionCount,
        users,
      };
    });

    const userById = new Map(
      data.users.map((user) => [
        user.id,
        buildAssigneeLabel(user.name, user.memberships[0]),
      ]),
    );

    // 最新プランを case_id ごとに 1 件(findMany は created_at desc 済み)
    const planByCaseId = new Map<string, (typeof data.plans)[number]>();
    for (const plan of data.plans) {
      if (!planByCaseId.has(plan.cycle.case_id)) {
        planByCaseId.set(plan.cycle.case_id, plan);
      }
    }

    // 施設グルーピング(住まいの施設が無い患者は施設カード対象外)
    type GroupAccumulator = {
      facility_id: string;
      facility_name: string;
      visit_time: Date | null;
      pharmacist_ids: Set<string>;
      rows: SetWorkspaceRow[];
      lane_lines: { normal: Set<string>; cold: Set<string>; narcotic: Set<string> };
      seen_patient_ids: Set<string>;
    };
    const groups = new Map<string, GroupAccumulator>();

    for (const schedule of data.schedules) {
      const patient = schedule.case_.patient;
      const residence = patient.residences[0] ?? null;
      const facility = residence?.facility ?? null;
      if (!facility) continue;

      let group = groups.get(facility.id);
      if (!group) {
        group = {
          facility_id: facility.id,
          facility_name: facility.name,
          visit_time: null,
          pharmacist_ids: new Set(),
          rows: [],
          lane_lines: { normal: new Set(), cold: new Set(), narcotic: new Set() },
          seen_patient_ids: new Set(),
        };
        groups.set(facility.id, group);
      }
      group.pharmacist_ids.add(schedule.pharmacist_id);
      if (
        schedule.time_window_start &&
        (group.visit_time == null || schedule.time_window_start < group.visit_time)
      ) {
        group.visit_time = schedule.time_window_start;
      }
      if (group.seen_patient_ids.has(patient.id)) continue;
      group.seen_patient_ids.add(patient.id);

      const plan = planByCaseId.get(schedule.case_id) ?? null;
      const changedBy = plan?.change_logs[0]?.changed_by ?? null;
      group.rows.push({
        patient_id: patient.id,
        patient_name: patient.name,
        room_label: residence?.unit_name ?? null,
        has_allergy: Array.isArray(patient.allergy_info) && patient.allergy_info.length > 0,
        slots: deriveSlotMarks(plan),
        status: deriveRowStatus(plan),
        assignee_label: changedBy ? (userById.get(changedBy) ?? null) : null,
      });

      for (const batch of plan?.batches ?? []) {
        const tags = batch.packaging_instruction_tags_snapshot;
        if (tags.includes('narcotic')) {
          group.lane_lines.narcotic.add(batch.line_id);
        } else if (tags.includes('cold_storage')) {
          group.lane_lines.cold.add(batch.line_id);
        } else {
          group.lane_lines.normal.add(batch.line_id);
        }
      }
    }

    const facilityGroups: SetWorkspaceFacilityGroup[] = [...groups.values()]
      .map((group) => {
        const laneCounts: SetLaneCounts = {
          normal: group.lane_lines.normal.size,
          cold: group.lane_lines.cold.size,
          narcotic: group.lane_lines.narcotic.size,
        };
        const completedCount = group.rows.filter((row) => row.status === 'completed').length;
        const pharmacistId = [...group.pharmacist_ids][0] ?? null;
        return {
          facility_id: group.facility_id,
          facility_name: group.facility_name,
          visit_time: group.visit_time?.toISOString() ?? null,
          rows: group.rows,
          completed_count: completedCount,
          total_count: group.rows.length,
          lane_counts: laneCounts,
          final_check_assignee: pharmacistId ? (userById.get(pharmacistId) ?? null) : null,
        } satisfies SetWorkspaceFacilityGroup;
      })
      .sort((left, right) => right.total_count - left.total_count);

    // 工程待ちのセット: (1) 調剤監査待ち=監査合格と同時にセットへ来る分
    const pendingItems: SetPendingItem[] = [];
    const scheduleByCaseId = new Map(data.schedules.map((schedule) => [schedule.case_id, schedule]));
    for (const cycle of data.auditWaitingCycles) {
      const schedule = scheduleByCaseId.get(cycle.case_id) ?? null;
      const tags = new Set<string>(
        (cycle.prescription_intakes[0]?.lines ?? []).flatMap(
          (line) => line.packaging_instruction_tags,
        ),
      );
      const tagLabels = ['narcotic', 'cold_storage']
        .filter((tag) => tags.has(tag))
        .map((tag) => HANDLING_TAG_SHORT_LABELS[tag]);
      const pharmacistLabel = schedule ? (userById.get(schedule.pharmacist_id) ?? null) : null;
      const timeLabel = schedule?.time_window_start
        ? `本日${formatTimeOfDay(schedule.time_window_start)} 持参分`
        : '本日 持参分';
      const directSetSentence =
        tagLabels.length > 0 && pharmacistLabel
          ? `${tagLabels.join('・')}のため${pharmacistLabel}が直接セットします。`
          : '';
      pendingItems.push({
        id: `audit-waiting-${cycle.id}`,
        kind: 'audit_waiting',
        badge_label: '監査待ち',
        title: `${cycle.case_.patient.name} 様 — ${timeLabel}`,
        subtitle: `監査合格と同時にここへ自動で現れます。${directSetSentence}`,
        meta_label: `所要${SET_MINUTES_PER_PATIENT}分`,
        action_label: '→ 監査へ',
        action_href: '/audit',
      });
    }

    // (2) 明日分: 監査済み(セット作業待ち)サイクルを持つ明日訪問分 = 余白で先行可
    if (data.tomorrowSchedules.length > 0) {
      const titles = data.tomorrowSchedules.map((schedule) => {
        const tags = new Set<string>(
          (schedule.case_.medication_cycles[0]?.prescription_intakes[0]?.lines ?? []).flatMap(
            (line) => line.packaging_instruction_tags,
          ),
        );
        return tags.has('cold_storage')
          ? `${schedule.case_.patient.name} 様(冷所)`
          : `${schedule.case_.patient.name} 様`;
      });
      pendingItems.push({
        id: 'preworkable-tomorrow',
        kind: 'preworkable',
        badge_label: '明日分',
        title: titles.join('・'),
        subtitle: null,
        meta_label: `余白で先行可(${data.tomorrowSchedules.length * PREWORK_MINUTES_PER_PATIENT}分)`,
        action_label: '→ ダッシュボードへ',
        action_href: '/dashboard',
      });
    }

    const responseData: SetWorkspaceResponse = {
      generated_at: now.toISOString(),
      scope,
      facility_groups: facilityGroups,
      pending_items: pendingItems,
      evidence: {
        cart_map_count: facilityGroups.length,
        cold_storage_log_status: data.coldExceptionCount > 0 ? '要確認' : '正常',
      },
    };

    return success({ data: responseData });
  },
  {
    permission: 'canSet',
    message: 'セット準備ワークスペースの閲覧権限がありません',
  },
);
