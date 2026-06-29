/**
 * p0_45「キャパシティ・詰まり確認」(/admin/capacity)の集計純関数。
 * 「今日あとどれだけ対応できる?」を KPI 4 枚(訪問枠 / 調剤・セット /
 * スタッフ稼働 / 緊急余力)+ 行程ごとの残り(6 工程)+ スタッフ別の負荷 +
 * 「今すぐ見るべきこと」(ルール導出)に変換する。
 */

import { familyNameOf } from '@/lib/utils/person-name';
import { timeDateToMinutes } from '@/lib/visits/time-of-day';

// シフト未登録時の既定勤務枠(cockpit buildTeamCapacity と同じ 9:00-18:00)
const DEFAULT_WORK_START_MINUTES = 9 * 60;
const DEFAULT_WORK_END_MINUTES = 18 * 60;
/** 時刻未定・終了未定の訪問 1 件あたりの拘束目安(分) */
const DEFAULT_VISIT_DURATION_MINUTES = 60;
/** 緊急余力 = 余白合計 ÷ 緊急訪問 1 件の既定拘束(60分) */
const EMERGENCY_VISIT_MINUTES = 60;
/** スタッフ別の負荷バーの表示上限(target デザインは 5 本) */
const STAFF_CHART_LIMIT = 5;
/** 薬剤師確認待ち(監査待ち)がこの件数以上で「今すぐ見るべきこと」に出す */
const AUDIT_WAITING_ALERT_THRESHOLD = 6;
/** 緊急余力がこの件数を下回ると「今すぐ見るべきこと」に出す */
const EMERGENCY_CAPACITY_ALERT_THRESHOLD = 4;
/** 時間帯別の訪問枠判定の対象時間帯(勤務枠と同じ 9〜18 時) */
const SLOT_HOUR_START = 9;
const SLOT_HOUR_END = 18;

// ---------------------------------------------------------------------------
// 時刻変換(@db.Time / 実時刻 → その日の経過分)
// ---------------------------------------------------------------------------

/** VisitSchedule.time_window_*(@db.Time)→ UTC clock parts の分。 */
export function visitTimeToMinutes(time: Date | null): number | null {
  return timeDateToMinutes(time);
}

/**
 * PharmacistShift.available_*(@db.Time)→ 0:00 からの分。
 * シフトはコックピットの buildTeamCapacity(projectTimeOfDay)と同じく
 * UTC 時刻部分をそのまま時刻として読む規約に合わせる。
 */
export function shiftTimeToMinutes(time: Date | null): number | null {
  if (!time) return null;
  return time.getUTCHours() * 60 + time.getUTCMinutes();
}

/** 現在時刻 → ローカル 0:00 からの分。 */
export function minutesOfDayLocal(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

// ---------------------------------------------------------------------------
// 行程ごとの残り(6 工程)
// ---------------------------------------------------------------------------

export type CapacityProcessKey = 'input' | 'confirm' | 'dispense' | 'set' | 'visit' | 'report';

export type ProcessRemaining = {
  key: CapacityProcessKey;
  label: string;
  count: number;
};

/**
 * MedicationCycle.overall_status → 6 工程バケット。
 * PROCESS_STEPS_9(取込/入力/判断/調剤/監査/セット/訪問/報告/算定)を
 * target デザインの 6 本(入力/確認/調剤/セット/訪問/報告)へ畳む:
 * - 入力 = 取込 + 入力、確認 = 判断(疑義)+ 監査(薬剤師の確認待ち)
 * - 算定(reported)と on_hold / cancelled はキャパシティの残件に含めない
 */
export const CAPACITY_PROCESS_BUCKETS: ReadonlyArray<{
  key: CapacityProcessKey;
  label: string;
  statuses: readonly string[];
}> = [
  { key: 'input', label: '入力', statuses: ['intake_received', 'structuring'] },
  {
    key: 'confirm',
    label: '確認',
    statuses: ['inquiry_pending', 'inquiry_resolved', 'dispensed', 'audit_pending'],
  },
  { key: 'dispense', label: '調剤', statuses: ['ready_to_dispense', 'dispensing'] },
  { key: 'set', label: 'セット', statuses: ['audited', 'setting'] },
  { key: 'visit', label: '訪問', statuses: ['set_audited', 'visit_ready'] },
  { key: 'report', label: '報告', statuses: ['visit_completed'] },
];

/** overall_status 件数マップ → 行程ごとの残り 6 本。 */
export function buildProcessRemaining(statusCounts: Record<string, number>): ProcessRemaining[] {
  return CAPACITY_PROCESS_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.statuses.reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0),
  }));
}

/** 薬剤師確認待ち(調剤完了で監査を待っている件数)。 */
export function countAuditWaiting(statusCounts: Record<string, number>): number {
  return (statusCounts['dispensed'] ?? 0) + (statusCounts['audit_pending'] ?? 0);
}

// ---------------------------------------------------------------------------
// KPI: 訪問枠 / 調剤・セット
// ---------------------------------------------------------------------------

export type SlotSummary = {
  completed: number;
  total: number;
};

/** 本日の訪問予定(キャンセル・再調整除外済み)の完了/全体。 */
export function buildVisitSlotSummary(scheduleStatuses: string[]): SlotSummary {
  return {
    completed: scheduleStatuses.filter((status) => status === 'completed').length,
    total: scheduleStatuses.length,
  };
}

export type SetPlanInput = {
  /** 最新 SetAudit の result(なければ null) */
  latestAuditResult: string | null;
};

/**
 * 調剤・セット KPI。
 * - 調剤: 未完了タスク全件 + 本日完了したタスク(完了済みの古いタスクは分母に入れない)
 * - セット: SetPlan 全件のうち最新監査が承認済みのものを完了とみなす
 */
export function buildDispenseSetSummary(args: {
  dispenseOpenCount: number;
  dispenseCompletedTodayCount: number;
  setPlans: SetPlanInput[];
}): SlotSummary {
  const setCompleted = args.setPlans.filter((plan) => plan.latestAuditResult === 'approved').length;
  return {
    completed: args.dispenseCompletedTodayCount + setCompleted,
    total: args.dispenseOpenCount + args.dispenseCompletedTodayCount + args.setPlans.length,
  };
}

// ---------------------------------------------------------------------------
// スタッフ稼働 / 緊急余力 / スタッフ別の負荷
// ---------------------------------------------------------------------------

export type StaffVisitInput = {
  /** 訪問開始(その日の経過分)。時刻未定は null(拘束に数えない) */
  startMinutes: number | null;
  endMinutes: number | null;
};

export type StaffMemberInput = {
  userId: string;
  name: string;
  /** membership.role(clerk のみ事務扱い、それ以外は薬剤師系) */
  role: string;
  /** 当日シフト(未登録は null = 既定 9:00-18:00 勤務) */
  shift: {
    available: boolean;
    fromMinutes: number | null;
    toMinutes: number | null;
  } | null;
  /** 当日の担当訪問(完了済みを除く残り予定) */
  visits: StaffVisitInput[];
};

export type StaffLoadItem = {
  userId: string;
  /** バー下のラベル(姓のみ。例: 山田) */
  label: string;
  /** 勤務時間に対する稼働割合 0-100(余白以外を稼働とみなす近似) */
  loadPercent: number;
};

export type StaffCapacitySummary = {
  staffLoad: StaffLoadItem[];
  /** チーム全体の稼働率 0-100(勤務分の合計に対する非余白分) */
  utilizationPercent: number;
  /** 緊急余力(残り余白の合計 ÷ 訪問60分。小数1桁) */
  emergencyCapacityCount: number;
  /** 勤務中の薬剤師数(時間帯別の訪問枠判定の供給側) */
  workingPharmacistCount: number;
  /** 勤務中メンバー総数(事務含む) */
  workingStaffCount: number;
};

/** 姓のみ(スペース区切りの先頭)。cockpit のハンドオフ提案と同じ規約。 */
const familyName = familyNameOf;

/**
 * チームの余白(cockpit buildTeamCapacity)と同じ近似で
 * 「稼働中時間 / 勤務時間」を出す。余白 = 残り勤務 − 残り訪問拘束、
 * 稼働 = 勤務枠 − 余白(経過時間と確保済みの訪問拘束を稼働とみなす)。
 */
export function buildStaffCapacity(
  members: StaffMemberInput[],
  nowMinutes: number,
): StaffCapacitySummary {
  type WorkingMember = {
    userId: string;
    label: string;
    role: string;
    workTotalMinutes: number;
    slackMinutes: number;
  };

  const working: WorkingMember[] = [];
  for (const member of members) {
    if (member.shift && !member.shift.available) continue; // 当日休み

    const workStart = member.shift?.fromMinutes ?? DEFAULT_WORK_START_MINUTES;
    const workEnd = member.shift?.toMinutes ?? DEFAULT_WORK_END_MINUTES;
    const workTotalMinutes = Math.max(0, workEnd - workStart);
    const remainingMinutes = Math.max(0, workEnd - Math.max(nowMinutes, workStart));

    const futureBusyMinutes = member.visits.reduce((total, visit) => {
      if (visit.startMinutes == null || visit.startMinutes < nowMinutes) return total;
      const duration =
        visit.endMinutes != null
          ? Math.max(0, visit.endMinutes - visit.startMinutes)
          : DEFAULT_VISIT_DURATION_MINUTES;
      return total + duration;
    }, 0);

    working.push({
      userId: member.userId,
      label: familyName(member.name),
      role: member.role,
      workTotalMinutes,
      slackMinutes: Math.max(0, remainingMinutes - futureBusyMinutes),
    });
  }

  // 薬剤師系を先に、事務を後に(cockpit と同じ並び)。同役割は入力順。
  const roleWeight = (role: string) => (role === 'clerk' ? 1 : 0);
  const staffLoad = working
    .slice()
    .sort((left, right) => roleWeight(left.role) - roleWeight(right.role))
    .slice(0, STAFF_CHART_LIMIT)
    .map((member) => ({
      userId: member.userId,
      label: member.label,
      loadPercent:
        member.workTotalMinutes > 0
          ? Math.round(
              Math.min(
                1,
                (member.workTotalMinutes - member.slackMinutes) / member.workTotalMinutes,
              ) * 100,
            )
          : 100,
    }));

  const workTotalSum = working.reduce((sum, member) => sum + member.workTotalMinutes, 0);
  const slackSum = working.reduce((sum, member) => sum + member.slackMinutes, 0);

  return {
    staffLoad,
    utilizationPercent:
      workTotalSum > 0 ? Math.round(((workTotalSum - slackSum) / workTotalSum) * 100) : 0,
    emergencyCapacityCount: Math.round((slackSum / EMERGENCY_VISIT_MINUTES) * 10) / 10,
    workingPharmacistCount: working.filter((member) => member.role !== 'clerk').length,
    workingStaffCount: working.length,
  };
}

// ---------------------------------------------------------------------------
// 時間帯別の訪問枠(不足の検出)
// ---------------------------------------------------------------------------

export type HourlyVisitInput = {
  startMinutes: number | null;
  endMinutes: number | null;
  /** 施設一括バッチは同一 ID を 1 件(1 訪問単位)として数える */
  facilityBatchId: string | null;
};

export type VisitSlotShortage = {
  /** 不足が最大の時間帯の開始時(例 14 → 「14〜15時」) */
  startHour: number;
  demand: number;
};

/**
 * 時間帯(1時間刻み)ごとの訪問数が勤務中の薬剤師数以上 = その時間帯は満枠で
 * 新規・緊急が入らない、を「訪問枠の不足」として検出する(需要最大・同数なら早い時間帯)。
 */
export function findVisitSlotShortage(
  visits: HourlyVisitInput[],
  workingPharmacistCount: number,
): VisitSlotShortage | null {
  if (workingPharmacistCount <= 0) return null;

  // 施設一括は 1 単位に畳む(バッチ内の患者数ぶん重複計上しない)
  const units: Array<{ start: number; end: number }> = [];
  const seenBatchIds = new Set<string>();
  for (const visit of visits) {
    if (visit.startMinutes == null) continue;
    if (visit.facilityBatchId) {
      if (seenBatchIds.has(visit.facilityBatchId)) continue;
      seenBatchIds.add(visit.facilityBatchId);
    }
    const end =
      visit.endMinutes != null && visit.endMinutes > visit.startMinutes
        ? visit.endMinutes
        : visit.startMinutes + DEFAULT_VISIT_DURATION_MINUTES;
    units.push({ start: visit.startMinutes, end });
  }

  let shortage: VisitSlotShortage | null = null;
  for (let hour = SLOT_HOUR_START; hour < SLOT_HOUR_END; hour += 1) {
    const hourStart = hour * 60;
    const hourEnd = hourStart + 60;
    const demand = units.filter((unit) => unit.start < hourEnd && unit.end > hourStart).length;
    if (demand >= workingPharmacistCount && (!shortage || demand > shortage.demand)) {
      shortage = { startHour: hour, demand };
    }
  }
  return shortage;
}

// ---------------------------------------------------------------------------
// 今すぐ見るべきこと(ルール導出)
// ---------------------------------------------------------------------------

/** 集計値から注意点を導出する(実データ起点、最大4件)。 */
export function buildAttentionItems(args: {
  processRemaining: ProcessRemaining[];
  auditWaitingCount: number;
  visitShortage: VisitSlotShortage | null;
  emergencyCapacityCount: number;
  /** 勤務中メンバー数(0 のときは余力低下の警告を出さない) */
  workingStaffCount: number;
}): string[] {
  const items: string[] = [];

  // 1) 残件が最大の工程
  const largest = [...args.processRemaining]
    .filter((process) => process.count > 0)
    .sort((left, right) => right.count - left.count)[0];
  if (largest) {
    items.push(`${largest.label}が${largest.count}件で多め`);
  }

  // 2) 満枠の時間帯(訪問枠の不足)
  if (args.visitShortage) {
    items.push(
      `${args.visitShortage.startHour}〜${args.visitShortage.startHour + 1}時の訪問枠が不足`,
    );
  }

  // 3) 薬剤師確認待ち(監査待ち)の滞留
  if (args.auditWaitingCount >= AUDIT_WAITING_ALERT_THRESHOLD) {
    items.push(`薬剤師確認待ちが${args.auditWaitingCount}件たまっています`);
  }

  // 4) 緊急余力の低下(スタッフ不在の 0 件は対象外)
  if (
    args.workingStaffCount > 0 &&
    args.emergencyCapacityCount < EMERGENCY_CAPACITY_ALERT_THRESHOLD
  ) {
    items.push(`緊急対応余力が${EMERGENCY_CAPACITY_ALERT_THRESHOLD - 1}件を下回りそう`);
  }

  return items.slice(0, 4);
}
