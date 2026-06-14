import type { VisitPriority, VisitType } from '@/app/(dashboard)/schedules/day-view.shared';

/**
 * p0_19「予定の重なりを直す」: 当日の訪問予定から、
 * 同一薬剤師の時間帯重複 と 同一社用車(vehicle_resource)の同時使用 を検知し、
 * 解消用の調整案 A/B/C を合成する純関数群。
 *
 * 外部 API・DB に依存せず、入力された訪問予定スナップショットだけで判定する
 * (UI 側で /api/visit-schedules と /api/pharmacists を取得し、本サービスへ渡す)。
 * 時刻は 0 時からの分で扱い、`null`(時間帯未指定)は重複判定から除外する。
 */

/** 緊急処方割込を後ろへずらす際の既定シフト幅(分) */
export const RESCHEDULE_SHIFT_MINUTES = 30;
/** 社用車を別車両へ振り替えた際に見込む移動時間の増分の近似(分) */
export const VEHICLE_SWAP_TRAVEL_PENALTY_MINUTES = 5;

/** 重なり判定 1 件分の入力(時刻は 0 時からの分。time_window が無い場合は null) */
export type ConflictScheduleInput = {
  scheduleId: string;
  /** 患者名(社用車の同時使用行など、患者を持たない行では null) */
  patientName: string | null;
  pharmacistId: string;
  /** 担当薬剤師の表示名。未解決時は null */
  pharmacistName: string | null;
  startMinutes: number | null;
  endMinutes: number | null;
  priority: VisitPriority;
  visitType: VisitType;
  /** 確定済み(運用ロック)の訪問は原則動かさない。調整案の対象選定で参照する */
  confirmed: boolean;
  /** 緊急処方の割込など、後ろへずらしやすい一時訪問かどうか */
  vehicleResourceId: string | null;
  vehicleLabel: string | null;
};

export type ConflictKind = 'pharmacist_overlap' | 'vehicle_overlap';

/** 重なり一覧テーブルの 1 行(対象 / 時間 / 内容) */
export type ConflictRow = {
  scheduleId: string;
  /** 対象列: 薬剤師名 もしくは 社用車ラベル */
  subject: string;
  /** 時間列: HH:mm(開始時刻)。未指定は「時間未定」 */
  timeLabel: string;
  startMinutes: number | null;
  /** 内容列: 「田中一郎 訪問」「緊急処方 割込」「同時使用」など */
  detail: string;
  kind: ConflictKind;
  confirmed: boolean;
};

/** 検知された 1 件の重なり(同一薬剤師 もしくは 同一社用車のペア群) */
export type ScheduleConflict = {
  id: string;
  kind: ConflictKind;
  /** 重なりの主体(薬剤師名 または 社用車ラベル) */
  subjectLabel: string;
  /** 重なりに巻き込まれた予定 ID */
  scheduleIds: string[];
  /** 重複している時間帯の開始(0 時からの分)。表示用 */
  overlapStartMinutes: number | null;
  rows: ConflictRow[];
};

export type AdjustmentPlanId = 'plan_a' | 'plan_b' | 'plan_c';

export type AdjustmentPlanTone = 'blue' | 'amber' | 'slate';

/** 調整案 A/B/C のカード 1 枚分 */
export type AdjustmentPlan = {
  id: AdjustmentPlanId;
  /** 例: 案A:緊急処方を佐藤薬剤師へ変更 */
  title: string;
  /** 例: 正式決定患者は動かさない */
  note: string;
  tone: AdjustmentPlanTone;
  /** 推奨案(主操作として強調する)かどうか */
  recommended: boolean;
  /** 対象となる予定 ID(採用時に変更する想定の予定) */
  targetScheduleIds: string[];
};

export type ScheduleConflictViewModel = {
  /** 重なっている予定の行(テーブル表示用、時刻昇順) */
  rows: ConflictRow[];
  conflicts: ScheduleConflict[];
  plans: AdjustmentPlan[];
  hasConflict: boolean;
  hasVehicleConflict: boolean;
  hasLockedSchedule: boolean;
};

function minutesToTimeLabel(value: number | null): string {
  if (value == null) return '時間未定';
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** 2 つの時間帯が重なるか(終了が無い場合は開始 + 既定所要を仮定せず、開始一致のみ重なりとみなす) */
function rangesOverlap(
  leftStart: number | null,
  leftEnd: number | null,
  rightStart: number | null,
  rightEnd: number | null,
): boolean {
  if (leftStart == null || rightStart == null) return false;
  // 終了未指定はその時点のみ(開始時刻)を占有するとみなす
  const lEnd = leftEnd ?? leftStart;
  const rEnd = rightEnd ?? rightStart;
  return leftStart < rEnd && rightStart < lEnd ? true : leftStart === rightStart;
}

function subjectFor(schedule: ConflictScheduleInput): string {
  return schedule.pharmacistName ?? '担当薬剤師';
}

function detailFor(schedule: ConflictScheduleInput): string {
  if (schedule.visitType === 'emergency') return '緊急処方 割込';
  if (schedule.patientName) return `${schedule.patientName} 訪問`;
  return '訪問';
}

function toPharmacistRow(schedule: ConflictScheduleInput): ConflictRow {
  return {
    scheduleId: schedule.scheduleId,
    subject: subjectFor(schedule),
    timeLabel: minutesToTimeLabel(schedule.startMinutes),
    startMinutes: schedule.startMinutes,
    detail: detailFor(schedule),
    kind: 'pharmacist_overlap',
    confirmed: schedule.confirmed,
  };
}

function toVehicleRow(schedule: ConflictScheduleInput): ConflictRow {
  return {
    scheduleId: schedule.scheduleId,
    subject: schedule.vehicleLabel ?? '社用車',
    timeLabel: minutesToTimeLabel(schedule.startMinutes),
    startMinutes: schedule.startMinutes,
    detail: '同時使用',
    kind: 'vehicle_overlap',
    confirmed: schedule.confirmed,
  };
}

function compareRows(left: ConflictRow, right: ConflictRow): number {
  const leftStart = left.startMinutes ?? Number.MAX_SAFE_INTEGER;
  const rightStart = right.startMinutes ?? Number.MAX_SAFE_INTEGER;
  if (leftStart !== rightStart) return leftStart - rightStart;
  return left.scheduleId.localeCompare(right.scheduleId);
}

/** 同一キー(薬剤師 または 社用車)の中で時間帯が重なるペアを 1 つのグループにまとめる */
function groupOverlaps(
  schedules: ConflictScheduleInput[],
  keyOf: (schedule: ConflictScheduleInput) => string | null,
): ConflictScheduleInput[][] {
  const byKey = new Map<string, ConflictScheduleInput[]>();
  for (const schedule of schedules) {
    const key = keyOf(schedule);
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(schedule);
    else byKey.set(key, [schedule]);
  }

  const groups: ConflictScheduleInput[][] = [];
  for (const bucket of byKey.values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort(
      (left, right) =>
        (left.startMinutes ?? Number.MAX_SAFE_INTEGER) -
        (right.startMinutes ?? Number.MAX_SAFE_INTEGER),
    );
    const overlapping = new Set<ConflictScheduleInput>();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (
          rangesOverlap(
            sorted[i].startMinutes,
            sorted[i].endMinutes,
            sorted[j].startMinutes,
            sorted[j].endMinutes,
          )
        ) {
          overlapping.add(sorted[i]);
          overlapping.add(sorted[j]);
        }
      }
    }
    if (overlapping.size >= 2) {
      groups.push(sorted.filter((schedule) => overlapping.has(schedule)));
    }
  }
  return groups;
}

function detectPharmacistConflicts(schedules: ConflictScheduleInput[]): ScheduleConflict[] {
  return groupOverlaps(schedules, (schedule) => schedule.pharmacistId).map((group, index) => {
    const rows = group.map(toPharmacistRow).sort(compareRows);
    return {
      id: `pharmacist:${group[0].pharmacistId}:${index}`,
      kind: 'pharmacist_overlap' as const,
      subjectLabel: subjectFor(group[0]),
      scheduleIds: group.map((schedule) => schedule.scheduleId),
      overlapStartMinutes: rows[0]?.startMinutes ?? null,
      rows,
    };
  });
}

function detectVehicleConflicts(schedules: ConflictScheduleInput[]): ScheduleConflict[] {
  return groupOverlaps(schedules, (schedule) => schedule.vehicleResourceId).map((group, index) => {
    const rows = group.map(toVehicleRow).sort(compareRows);
    return {
      id: `vehicle:${group[0].vehicleResourceId}:${index}`,
      kind: 'vehicle_overlap' as const,
      subjectLabel: group[0].vehicleLabel ?? '社用車',
      scheduleIds: group.map((schedule) => schedule.scheduleId),
      overlapStartMinutes: rows[0]?.startMinutes ?? null,
      rows,
    };
  });
}

/** 緊急処方割込 → 一時訪問 → 未確定 → 緊急以外 の順で「動かしやすい」予定を選ぶ */
function pickMovableSchedule(schedules: ConflictScheduleInput[]): ConflictScheduleInput | null {
  const candidates = [...schedules].sort((left, right) => {
    const score = (schedule: ConflictScheduleInput) =>
      (schedule.visitType === 'emergency' ? 0 : 1) +
      (schedule.confirmed ? 2 : 0) +
      (schedule.visitType === 'temporary' ? -1 : 0);
    return score(left) - score(right);
  });
  return candidates[0] ?? null;
}

/**
 * 検知された重なりから調整案 A/B/C を合成する。
 * 案A: 重なっている割込/未確定訪問を別の薬剤師へ振り替える(正式決定患者は動かさない=推奨)
 * 案B: 動かしやすい患者を後ろの時間帯へずらす(患者再確認が必要)
 * 案C: 社用車の同時使用がある場合に別の社用車へ振り替える(移動時間 +5 分)
 */
function buildAdjustmentPlans(
  pharmacistConflicts: ScheduleConflict[],
  vehicleConflicts: ScheduleConflict[],
  scheduleById: ReadonlyMap<string, ConflictScheduleInput>,
): AdjustmentPlan[] {
  const plans: AdjustmentPlan[] = [];

  const primaryConflict = pharmacistConflicts[0] ?? null;
  const movable = primaryConflict
    ? pickMovableSchedule(
        primaryConflict.scheduleIds
          .map((id) => scheduleById.get(id))
          .filter((schedule): schedule is ConflictScheduleInput => Boolean(schedule)),
      )
    : null;

  if (primaryConflict && movable) {
    const movableLabel =
      movable.visitType === 'emergency'
        ? '緊急処方'
        : movable.patientName
          ? `${movable.patientName}様の訪問`
          : '対象の訪問';

    // 案A: 別薬剤師へ振り替え(確定患者を動かさずに割込側を移す)
    plans.push({
      id: 'plan_a',
      title: `案A:${movableLabel}を別の薬剤師へ変更`,
      note: '正式決定患者は動かさない',
      tone: 'blue',
      recommended: true,
      targetScheduleIds: [movable.scheduleId],
    });

    // 案B: 後ろの時間帯へずらす(患者の再確認が必要)
    const shiftedStart =
      movable.startMinutes != null ? movable.startMinutes + RESCHEDULE_SHIFT_MINUTES : null;
    const shiftedLabel = shiftedStart != null ? minutesToTimeLabel(shiftedStart) : '後ろの時間帯';
    const subjectB = movable.patientName ? `${movable.patientName}様` : '対象訪問';
    plans.push({
      id: 'plan_b',
      title: `案B:${subjectB}を${shiftedLabel}へ変更`,
      note: '患者再確認が必要',
      tone: 'amber',
      recommended: false,
      targetScheduleIds: [movable.scheduleId],
    });
  }

  // 案C: 社用車の同時使用がある場合は別車両へ振り替え
  const vehicleConflict = vehicleConflicts[0] ?? null;
  if (vehicleConflict) {
    const vehicleMovable = pickMovableSchedule(
      vehicleConflict.scheduleIds
        .map((id) => scheduleById.get(id))
        .filter((schedule): schedule is ConflictScheduleInput => Boolean(schedule)),
    );
    plans.push({
      id: 'plan_c',
      title: '案C:別の社用車へ変更',
      note: `移動時間+${VEHICLE_SWAP_TRAVEL_PENALTY_MINUTES}分`,
      tone: 'slate',
      recommended: false,
      targetScheduleIds: vehicleMovable ? [vehicleMovable.scheduleId] : vehicleConflict.scheduleIds,
    });
  }

  return plans;
}

/**
 * 当日の訪問予定スナップショットから、重なり一覧と調整案 A/B/C を構築する。
 * pharmacist_overlap(同一薬剤師の時間帯重複)と vehicle_overlap(同一社用車の同時使用)を検知する。
 */
export function buildScheduleConflictViewModel(
  schedules: ConflictScheduleInput[],
): ScheduleConflictViewModel {
  const scheduleById = new Map(schedules.map((schedule) => [schedule.scheduleId, schedule]));
  const pharmacistConflicts = detectPharmacistConflicts(schedules);
  const vehicleConflicts = detectVehicleConflicts(schedules);
  const conflicts = [...pharmacistConflicts, ...vehicleConflicts];

  // テーブル行: 薬剤師重複行を主とし、社用車の同時使用を末尾に補足する(設計図の 3 行構成に対応)
  const pharmacistRows = pharmacistConflicts.flatMap((conflict) => conflict.rows);
  const pharmacistRowIds = new Set(pharmacistRows.map((row) => row.scheduleId));
  const vehicleRows = vehicleConflicts
    .flatMap((conflict) => conflict.rows)
    // 同一予定が薬剤師行で既に出ている場合も、社用車視点の「同時使用」行として別途 1 行残す
    .filter((row, index, rows) => rows.findIndex((other) => other.scheduleId === row.scheduleId) === index);

  const rows = [
    ...pharmacistRows.sort(compareRows),
    ...vehicleRows.sort(compareRows),
  ];

  const plans = buildAdjustmentPlans(pharmacistConflicts, vehicleConflicts, scheduleById);

  return {
    rows,
    conflicts,
    plans,
    hasConflict: conflicts.length > 0,
    hasVehicleConflict: vehicleConflicts.length > 0,
    hasLockedSchedule: schedules.some(
      (schedule) => schedule.confirmed && pharmacistRowIds.has(schedule.scheduleId),
    ),
  };
}
