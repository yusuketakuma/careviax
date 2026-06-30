import type { CockpitAuditQueueItem } from '@/types/dashboard-cockpit';
import type { DayBoardStaff, DayBoardVisit } from '@/types/schedule-day-board';
import { formatTimeOfDay as formatTimeOfDayIso } from '@/lib/datetime/time-of-day';
import { formatDateKey } from '@/lib/date-key';
import { familyNameOf } from '@/lib/utils/person-name';
import { timeIsoToMinutes, timeIsoToString } from '@/lib/visits/time-of-day';

/**
 * new_03_schedule(今日のスケジュール — 全員)の表示計算ヘルパー。
 * 担当者レーン(訪問=固定点 + デスク作業/移動/昼/余白の仮置き)と
 * リスク警告(麻薬監査未完×当日訪問)を純関数として切り出す。
 * デスク作業・移動の時間帯は件数×目安からの仮置き
 * (dashboard-cockpit.helpers の buildTimelineBlocks と同じ方針)。
 */

export const BOARD_START_MINUTES = 9 * 60;
export const BOARD_END_MINUTES = 18 * 60;
const BOARD_TOTAL_MINUTES = BOARD_END_MINUTES - BOARD_START_MINUTES;

const LUNCH_START_MINUTES = 12 * 60;
const LUNCH_END_MINUTES = 13 * 60;
const DEFAULT_VISIT_MINUTES = 60;
const TRAVEL_MINUTES = 30;
const MIN_TRAVEL_RENDER_MINUTES = 10;
const AUDIT_MINUTES_PER_TASK = 15;
const AUDIT_BLOCK_MIN_MINUTES = 30;
const AUDIT_BLOCK_MAX_MINUTES = 150;
const REPORT_BLOCK_START_MINUTES = 17 * 60 + 30;
const REPORT_BLOCK_MIN_MINUTES = 20;
/** この分数以上の空きだけ「余白」点線ブロックとして描画する */
const IDLE_RENDER_MIN_MINUTES = 25;
/** 行合計の余白がこの分数未満なら赤(⚠)表示 */
export const IDLE_TIGHT_THRESHOLD_MINUTES = 15;

export type BoardBlockKind = 'visit' | 'desk' | 'prep' | 'travel' | 'break' | 'idle';

export type BoardBlock = {
  id: string;
  kind: BoardBlockKind;
  label: string;
  startMinutes: number;
  endMinutes: number;
  /** 訪問ステータス。訪問以外の仮置きブロックは null */
  status: DayBoardVisit['schedule_status'] | null;
  /** 確定訪問(🔒 変更は理由必須) */
  locked: boolean;
  /** 麻薬監査未完などのリスク(⚠) */
  risk: boolean;
  patientArchive?: DayBoardVisit['patient_archive'];
  patientSummary?: DayBoardVisit['patient_summary'];
  preparationSummary?: DayBoardVisit['preparation_summary'];
  aggregateScheduleIds?: string[];
};

export type StaffLane = {
  staffId: string;
  /** 行ラベル(例: 山田(薬) / 鈴木(事務)) */
  rowLabel: string;
  roleKind: DayBoardStaff['role_kind'];
  blocks: BoardBlock[];
  /** ガントに置いた訪問ブロックの合計(分)。施設一括訪問は1つの訪問窓として数える */
  visitMinutes: number;
  /** ガントに置いた移動ブロックの合計(分) */
  travelMinutes: number;
  /** 勤務帯(9:00-18:00)内の空き合計(分) */
  idleMinutes: number;
  /** 余白から見た仮の追加訪問枠数(確定可否ではなく目安) */
  estimatedVisitSlots: number;
  idleTone: 'ok' | 'tight';
};

export function boardPercent(minutes: number): number {
  const clamped = Math.min(Math.max(minutes, BOARD_START_MINUTES), BOARD_END_MINUTES);
  return ((clamped - BOARD_START_MINUTES) / BOARD_TOTAL_MINUTES) * 100;
}

export function minutesOfDayIso(iso: string): number {
  return timeIsoToMinutes(iso) ?? BOARD_START_MINUTES;
}

export { formatTimeOfDayIso };

export function formatScheduleTimeIso(iso: string): string {
  return timeIsoToString(iso) ?? '—';
}

function clampToBoard(minutes: number): number {
  return Math.min(Math.max(minutes, BOARD_START_MINUTES), BOARD_END_MINUTES);
}

/** 姓のみ(スペース区切りの先頭)+職種サフィックス。例: 山田(薬)。 */
export function staffRowLabel(staff: Pick<DayBoardStaff, 'name' | 'role_kind'>): string {
  const familyName = familyNameOf(staff.name) || staff.name;
  return `${familyName}(${staff.role_kind === 'clerk' ? '事務' : '薬'})`;
}

export function visitBlockLabel(visit: DayBoardVisit): string {
  if (visit.facility_label && visit.facility_patient_count > 1) {
    return `施設${visit.facility_label} ${visit.facility_patient_count}名`;
  }
  return `${visit.patient_name}様`;
}

type VisitWindow = {
  start: number;
  end: number;
  visit: DayBoardVisit;
  aggregateScheduleIds?: string[];
};

function aggregatePreparationSummaries(
  visits: DayBoardVisit[],
): DayBoardVisit['preparation_summary'] {
  const summaries = visits.map((visit) => visit.preparation_summary);
  const totalVisitCount = summaries.length;
  const incompleteSummaries = summaries.filter(
    (summary) =>
      summary.status !== 'ready' ||
      summary.incomplete_labels.length > 0 ||
      summary.ready_blocker_summary?.blocked,
  );
  const blockedVisitCount = summaries.filter(
    (summary) => summary.status === 'blocked' || summary.ready_blocker_summary?.blocked,
  ).length;
  const incompleteVisitCount = summaries.filter(
    (summary) => summary.status === 'incomplete',
  ).length;
  const unknownVisitCount = summaries.filter((summary) => summary.status === 'unknown').length;
  const incompleteLabels = Array.from(
    new Set(
      incompleteSummaries.flatMap((summary) => [
        ...summary.incomplete_labels,
        ...(summary.ready_blocker_summary?.category_labels ?? []),
      ]),
    ),
  ).slice(0, 3);
  const readyBlockerSummaries = summaries
    .map((summary) => summary.ready_blocker_summary)
    .filter(
      (
        summary,
      ): summary is NonNullable<DayBoardVisit['preparation_summary']['ready_blocker_summary']> =>
        Boolean(summary),
    );
  const preparationBlockerCount = readyBlockerSummaries.reduce(
    (total, summary) => total + summary.preparation_blocker_count,
    0,
  );
  const onboardingBlockerCount = readyBlockerSummaries.reduce(
    (total, summary) => total + summary.onboarding_blocker_count,
    0,
  );
  const billingBlockerCount = readyBlockerSummaries.reduce(
    (total, summary) => total + summary.billing_blocker_count,
    0,
  );
  const readyBlockerCount = preparationBlockerCount + onboardingBlockerCount + billingBlockerCount;

  return {
    completed_count: summaries.reduce((total, summary) => total + summary.completed_count, 0),
    total_count: summaries.reduce((total, summary) => total + summary.total_count, 0),
    status:
      incompleteSummaries.length === 0
        ? 'ready'
        : blockedVisitCount > 0
          ? 'blocked'
          : incompleteVisitCount > 0
            ? 'incomplete'
            : 'unknown',
    incomplete_labels: incompleteLabels,
    aggregate_visit_count: totalVisitCount,
    incomplete_visit_count: incompleteSummaries.length,
    blocked_visit_count: blockedVisitCount,
    unknown_visit_count: unknownVisitCount,
    ready_blocker_summary:
      readyBlockerSummaries.length > 0
        ? {
            blocked: readyBlockerCount > 0,
            blocker_count: readyBlockerCount,
            category_labels: [
              preparationBlockerCount > 0 ? `訪問前提 ${preparationBlockerCount}件` : null,
              onboardingBlockerCount > 0 ? `導入準備 ${onboardingBlockerCount}件` : null,
              billingBlockerCount > 0 ? `算定確認 ${billingBlockerCount}件` : null,
            ].filter((label): label is string => label !== null),
            preparation_blocker_count: preparationBlockerCount,
            onboarding_blocker_count: onboardingBlockerCount,
            billing_blocker_count: billingBlockerCount,
          }
        : undefined,
  };
}

/** 施設バッチをまとめた当日訪問ウィンドウ(時間未設定は除外)。 */
function buildVisitWindows(visits: DayBoardVisit[]): VisitWindow[] {
  const facilityGroups = new Map<string, DayBoardVisit[]>();
  const windows: VisitWindow[] = [];

  for (const visit of visits) {
    if (!visit.time_start) continue;
    if (visit.facility_label && visit.facility_patient_count > 1) {
      const key = visit.facility_batch_id ?? `facility:${visit.facility_label}:${visit.time_start}`;
      const group = facilityGroups.get(key) ?? [];
      group.push(visit);
      facilityGroups.set(key, group);
      continue;
    }
    const start = clampToBoard(minutesOfDayIso(visit.time_start));
    const rawEnd = visit.time_end
      ? minutesOfDayIso(visit.time_end)
      : minutesOfDayIso(visit.time_start) + DEFAULT_VISIT_MINUTES;
    windows.push({ start, end: clampToBoard(Math.max(rawEnd, start + 15)), visit });
  }

  for (const group of facilityGroups.values()) {
    const starts = group.map((visit) => minutesOfDayIso(visit.time_start as string));
    const ends = group.map((visit) =>
      visit.time_end
        ? minutesOfDayIso(visit.time_end)
        : minutesOfDayIso(visit.time_start as string) + DEFAULT_VISIT_MINUTES,
    );
    const start = clampToBoard(Math.min(...starts));
    const end = clampToBoard(Math.max(...ends, start + 15));
    const representative = group[0];
    windows.push({
      start,
      end,
      aggregateScheduleIds: group.map((visit) => visit.id),
      visit: {
        ...representative,
        // API の facility_patient_count(バッチ全体の人数)を優先し、
        // 同一行内の同時訪問件数はフォールバックとして使う
        facility_patient_count: Math.max(representative.facility_patient_count, group.length),
        preparation_summary: aggregatePreparationSummaries(group),
      },
    });
  }

  return windows
    .filter((window) => window.end > window.start)
    .sort((left, right) => left.start - right.start);
}

type OccupiedRange = { start: number; end: number };

function totalFreeMinutes(occupied: OccupiedRange[]): number {
  const sorted = [...occupied].sort((left, right) => left.start - right.start);
  let cursor = BOARD_START_MINUTES;
  let free = 0;
  for (const range of sorted) {
    if (range.start > cursor) free += range.start - cursor;
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < BOARD_END_MINUTES) free += BOARD_END_MINUTES - cursor;
  return free;
}

function freeGaps(occupied: OccupiedRange[]): OccupiedRange[] {
  const sorted = [...occupied].sort((left, right) => left.start - right.start);
  const gaps: OccupiedRange[] = [];
  let cursor = BOARD_START_MINUTES;
  for (const range of sorted) {
    if (range.start > cursor) gaps.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < BOARD_END_MINUTES) gaps.push({ start: cursor, end: BOARD_END_MINUTES });
  return gaps;
}

export type BuildStaffLaneArgs = {
  staff: DayBoardStaff;
  /** 麻薬監査リスクのある患者名(訪問ブロックの ⚠ 表示) */
  riskPatientNames?: ReadonlySet<string>;
  /** 報告書待ち件数(行内「報告」ブロックの仮置き。先頭薬剤師行のみ渡す) */
  reportPendingCount?: number;
  /** 事務カテゴリの止まっている理由件数(「送付先確認ほか」ブロックの仮置き) */
  clericalBlockedCount?: number;
};

/**
 * 担当者 1 行分のレーン。訪問=固定点(緑🔒)を実データから置き、
 * デスク作業(監査/窓口・取込/入力・庶務)・移動・昼・余白は件数×目安の仮置き。
 */
export function buildStaffLane({
  staff,
  riskPatientNames,
  reportPendingCount = 0,
  clericalBlockedCount = 0,
}: BuildStaffLaneArgs): StaffLane {
  const blocks: BoardBlock[] = [];
  const occupied: OccupiedRange[] = [];
  const visitWindows = buildVisitWindows(staff.visits);
  let visitMinutes = 0;
  let travelMinutes = 0;

  for (const window of visitWindows) {
    visitMinutes += window.end - window.start;
    blocks.push({
      id: `visit:${window.visit.id}`,
      kind: 'visit',
      label: visitBlockLabel(window.visit),
      startMinutes: window.start,
      endMinutes: window.end,
      status: window.aggregateScheduleIds ? null : window.visit.schedule_status,
      locked: window.visit.confirmed,
      risk: riskPatientNames?.has(window.visit.patient_name) ?? false,
      patientArchive: window.visit.patient_archive,
      patientSummary: window.aggregateScheduleIds ? undefined : window.visit.patient_summary,
      preparationSummary: window.visit.preparation_summary,
      aggregateScheduleIds: window.aggregateScheduleIds,
    });
    occupied.push({ start: window.start, end: window.end });

    // 移動時間(訪問直前の斜線ブロック・仮置き)
    const travelStart = Math.max(window.start - TRAVEL_MINUTES, BOARD_START_MINUTES);
    const blockedBefore = occupied.some(
      (range) => range !== occupied[occupied.length - 1] && range.end > travelStart,
    );
    if (!blockedBefore && window.start - travelStart >= MIN_TRAVEL_RENDER_MINUTES) {
      blocks.push({
        id: `travel:${window.visit.id}`,
        kind: 'travel',
        label: '移動',
        startMinutes: travelStart,
        endMinutes: window.start,
        status: null,
        locked: false,
        risk: false,
      });
      occupied.push({ start: travelStart, end: window.start });
      travelMinutes += window.start - travelStart;
    }
  }

  // 昼休み(訪問と重ならない場合のみ)
  const lunchOverlaps = visitWindows.some(
    (window) => window.start < LUNCH_END_MINUTES && window.end > LUNCH_START_MINUTES,
  );
  if (!lunchOverlaps) {
    blocks.push({
      id: 'break:lunch',
      kind: 'break',
      label: '昼',
      startMinutes: LUNCH_START_MINUTES,
      endMinutes: LUNCH_END_MINUTES,
      status: null,
      locked: false,
      risk: false,
    });
    occupied.push({ start: LUNCH_START_MINUTES, end: LUNCH_END_MINUTES });
  }

  if (staff.role_kind === 'pharmacist') {
    // 監査デスクブロック(朝イチ・件数×15分の仮置き)
    if (staff.audit_task_count > 0) {
      const duration = Math.min(
        Math.max(staff.audit_task_count * AUDIT_MINUTES_PER_TASK, AUDIT_BLOCK_MIN_MINUTES),
        AUDIT_BLOCK_MAX_MINUTES,
      );
      const firstOccupied = [...occupied].sort((left, right) => left.start - right.start)[0];
      const end = Math.min(
        BOARD_START_MINUTES + duration,
        firstOccupied
          ? Math.max(firstOccupied.start, BOARD_START_MINUTES + AUDIT_BLOCK_MIN_MINUTES)
          : BOARD_END_MINUTES,
        BOARD_END_MINUTES,
      );
      if (end > BOARD_START_MINUTES) {
        blocks.push({
          id: 'desk:audit',
          kind: 'desk',
          label: `監査${staff.audit_task_count}件`,
          startMinutes: BOARD_START_MINUTES,
          endMinutes: end,
          status: null,
          locked: false,
          risk: false,
        });
        occupied.push({ start: BOARD_START_MINUTES, end });
      }
    }

    // 報告ブロック(終業前・仮置き)
    if (reportPendingCount > 0) {
      const lastOccupiedEnd = occupied.reduce(
        (max, range) => Math.max(max, range.end),
        BOARD_START_MINUTES,
      );
      const start = Math.max(REPORT_BLOCK_START_MINUTES, lastOccupiedEnd);
      if (BOARD_END_MINUTES - start >= REPORT_BLOCK_MIN_MINUTES) {
        blocks.push({
          id: 'desk:report',
          kind: 'desk',
          label: '報告',
          startMinutes: start,
          endMinutes: BOARD_END_MINUTES,
          status: null,
          locked: false,
          risk: false,
        });
        occupied.push({ start, end: BOARD_END_MINUTES });
      }
    }
  } else {
    // 事務行: 窓口・取込 / 送付先確認 / 入力・庶務(定常業務の仮置き)
    const clerkBlocks: Array<{
      id: string;
      label: string;
      start: number;
      end: number;
      kind: BoardBlockKind;
    }> = [
      { id: 'desk:reception', label: '窓口・取込', start: 9 * 60, end: 11 * 60 + 45, kind: 'desk' },
      ...(clericalBlockedCount > 0
        ? [
            {
              id: 'prep:delivery-check',
              label: '送付先確認ほか',
              start: 13 * 60,
              end: 14 * 60,
              kind: 'prep' as BoardBlockKind,
            },
          ]
        : []),
      {
        id: 'desk:back-office',
        label: '入力・庶務',
        start: clericalBlockedCount > 0 ? 14 * 60 : 13 * 60,
        end: 16 * 60,
        kind: 'desk',
      },
    ];
    for (const clerkBlock of clerkBlocks) {
      const overlaps = occupied.some(
        (range) => range.start < clerkBlock.end && range.end > clerkBlock.start,
      );
      if (overlaps) continue;
      blocks.push({
        id: clerkBlock.id,
        kind: clerkBlock.kind,
        label: clerkBlock.label,
        startMinutes: clerkBlock.start,
        endMinutes: clerkBlock.end,
        status: null,
        locked: false,
        risk: false,
      });
      occupied.push({ start: clerkBlock.start, end: clerkBlock.end });
    }
  }

  // 余白: 空き合計を行バッジに、十分大きい空きは点線ブロックとして可視化
  const idleMinutes = totalFreeMinutes(occupied);
  const estimatedVisitSlots =
    staff.role_kind === 'pharmacist' ? Math.floor(idleMinutes / DEFAULT_VISIT_MINUTES) : 0;
  for (const gap of freeGaps(occupied)) {
    const gapMinutes = gap.end - gap.start;
    if (gapMinutes < IDLE_RENDER_MIN_MINUTES) continue;
    blocks.push({
      id: `idle:${gap.start}`,
      kind: 'idle',
      label: `余白${gapMinutes}分`,
      startMinutes: gap.start,
      endMinutes: gap.end,
      status: null,
      locked: false,
      risk: false,
    });
  }

  return {
    staffId: staff.id,
    rowLabel: staffRowLabel(staff),
    roleKind: staff.role_kind,
    blocks: blocks.sort((left, right) => left.startMinutes - right.startMinutes),
    visitMinutes,
    travelMinutes,
    idleMinutes,
    estimatedVisitSlots,
    idleTone: idleMinutes < IDLE_TIGHT_THRESHOLD_MINUTES ? 'tight' : 'ok',
  };
}

export type ScheduleRiskAlert = {
  /** 警告本文(リスクのある予定: …) */
  message: string;
  /** 監査導線ラベル */
  actionLabel: string;
  actionHref: string;
};

/**
 * リスクのある予定: 麻薬監査未完(期限つき)×同一患者の当日訪問から警告文を組み立てる。
 * 代替案は「訪問を1時間繰り下げ+後続の施設訪問を1時間後ろ倒し」の仮案。
 */
export function buildScheduleRiskAlert(args: {
  auditQueue: CockpitAuditQueueItem[];
  staff: DayBoardStaff[];
}): ScheduleRiskAlert | null {
  const narcoticAudit = args.auditQueue.find((item) => item.has_narcotic && item.due_at);
  if (!narcoticAudit) return null;

  let riskVisit: DayBoardVisit | null = null;
  let riskStaff: DayBoardStaff | null = null;
  for (const member of args.staff) {
    const found = member.visits.find(
      (visit) => visit.time_start && visit.patient_name === narcoticAudit.patient_name,
    );
    if (found) {
      riskVisit = found;
      riskStaff = member;
      break;
    }
  }
  if (!riskVisit?.time_start) return null;

  const visitTime = formatScheduleTimeIso(riskVisit.time_start);
  const dueTime = formatTimeOfDayIso(narcoticAudit.due_at as string);
  const visitStartMinutes = minutesOfDayIso(riskVisit.time_start);
  const fallbackHour = Math.floor(visitStartMinutes / 60) + 1;

  const laterFacilityVisit = riskStaff?.visits.find(
    (visit) =>
      visit.facility_label &&
      visit.facility_patient_count > 1 &&
      visit.time_start &&
      minutesOfDayIso(visit.time_start) > visitStartMinutes,
  );
  const fallbackTail = laterFacilityVisit?.time_start
    ? `、施設${laterFacilityVisit.facility_label}を${Math.floor(minutesOfDayIso(laterFacilityVisit.time_start) / 60) + 1}:00開始に変更する案を準備済み`
    : '、以降の予定を順送りにする案を準備済み';

  return {
    message: `リスクのある予定: ${visitTime} ${riskVisit.patient_name}様 — 持参薬の麻薬監査が未完了(期限${dueTime})。間に合わない場合は訪問を${fallbackHour}:00へ繰り下げ${fallbackTail}`,
    actionLabel: '→ 監査へ',
    actionHref: '/audit',
  };
}

/** 「明日」「6/13(土)」など未確定カードの日付ラベル。 */
export function pendingProposalDateLabel(proposedDate: string, todayKey: string): string {
  if (proposedDate === todayKey) return '今日';
  const today = new Date(`${todayKey}T00:00:00`);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = formatDateKey(tomorrow);
  if (proposedDate === tomorrowKey) return '明日';
  const date = new Date(`${proposedDate}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
