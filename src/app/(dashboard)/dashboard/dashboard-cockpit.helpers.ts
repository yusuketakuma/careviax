import { PROCESS_STEPS_9, type ProcessStepKey } from '@/lib/prescription/cycle-workspace';
import { formatElapsedLabel } from '@/lib/ui/relative-time';
import { formatTimeOfDay } from '@/lib/datetime/time-of-day';
import type { CockpitVisit } from '@/types/dashboard-cockpit';

/**
 * new_01_dashboard(運用コックピット)の表示計算ヘルパー。
 * 条件バナーの一文サマリ / 期限カウントダウン / 今日の流れタイムライン /
 * 工程の今(9工程×WIP目安)を純関数として切り出す。
 */

// ---------------------------------------------------------------------------
// 時刻
// ---------------------------------------------------------------------------

export { formatTimeOfDay };

export const COCKPIT_FRESHNESS_WINDOW_MS = 30_000;

export function formatCockpitGeneratedAtMeta(generatedAtIso: string, now: Date): string {
  const generatedAt = new Date(generatedAtIso);
  const timeLabel = formatTimeOfDay(generatedAtIso);
  if (Number.isNaN(generatedAt.getTime())) return timeLabel;

  const ageMs = Math.max(0, now.getTime() - generatedAt.getTime());
  return ageMs >= COCKPIT_FRESHNESS_WINDOW_MS ? `${timeLabel} / 要更新` : timeLabel;
}

/** ISO 文字列 → ローカル 0:00 からの経過分。 */
export function minutesOfDay(iso: string): number {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}

/** 期限までの残り時間ラベル(例: あと 2時間18分)。期限超過は overdue=true。 */
export function formatDeadlineCountdown(
  dueAtIso: string,
  now: Date,
): { label: string; overdue: boolean } {
  const diffMinutes = Math.floor((new Date(dueAtIso).getTime() - now.getTime()) / 60_000);
  if (diffMinutes < 0) return { label: '期限超過', overdue: true };
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (hours === 0) return { label: `あと ${minutes}分`, overdue: false };
  return { label: `あと ${hours}時間${minutes}分`, overdue: false };
}

/** 経過分 → 「30分」「2時間」「1日」形式(止まっている理由の経過時間)。 */
export const formatAgeLabel = formatElapsedLabel;

// ---------------------------------------------------------------------------
// 条件バナー(締め文)
// ---------------------------------------------------------------------------

export type ConditionSummaryPart = {
  text: string;
  /** 数値・期限の強調(太字)対象 */
  strong?: boolean;
};

export type ConditionSummary = {
  tone: 'conditional' | 'clear';
  /** 左端ピルの文言(条件つきで回る / 今日は回る) */
  pillLabel: string;
  parts: ConditionSummaryPart[];
};

/**
 * 「今日は回ります — ただし監査N件(麻薬M件を含む)が HH:MM までに完了することが条件です。…」
 * を監査待ち件数・最早期限・当日訪問から組み立てる。
 * 余白(分)はメンバー別キャパシティ API が未実装のため第一版では含めない。
 */
export function buildConditionSummary(args: {
  auditPendingCount: number;
  narcoticAuditCount: number;
  earliestAuditDueAt: string | null;
  /** HH:MM(時刻昇順) */
  visitTimes: string[];
}): ConditionSummary {
  const visitCount = args.visitTimes.length;
  const visitTimesText =
    visitCount > 0
      ? `(${args.visitTimes.slice(0, 3).join(' / ')}${visitCount > 3 ? ' ほか' : ''})`
      : '';

  if (args.auditPendingCount === 0) {
    const parts: ConditionSummaryPart[] = [
      { text: '今日は回ります — いま期限で止まっている監査はありません。' },
    ];
    if (visitCount > 0) {
      parts.push(
        { text: `訪問${visitCount}件`, strong: true },
        { text: `${visitTimesText}の準備をそのまま進められます。` },
      );
    } else {
      parts.push({ text: '本日の訪問予定はありません。' });
    }
    return { tone: 'clear', pillLabel: '今日は回る', parts };
  }

  const parts: ConditionSummaryPart[] = [
    { text: '今日は回ります — ただし' },
    { text: `監査${args.auditPendingCount}件`, strong: true },
  ];
  if (args.narcoticAuditCount > 0) {
    parts.push({ text: `(麻薬${args.narcoticAuditCount}件を含む)`, strong: true });
  }
  parts.push(
    { text: 'が' },
    {
      text: args.earliestAuditDueAt
        ? `${formatTimeOfDay(args.earliestAuditDueAt)}までに`
        : '本日中に',
      strong: true,
    },
    { text: '完了することが条件です。' },
  );
  if (visitCount > 0) {
    parts.push(
      { text: '完了すれば' },
      { text: `訪問${visitCount}件`, strong: true },
      { text: `${visitTimesText}はすべて時間内です。` },
    );
  }
  return { tone: 'conditional', pillLabel: '条件つきで回る', parts };
}

// ---------------------------------------------------------------------------
// 工程の今(9工程×WIP目安)
// ---------------------------------------------------------------------------

/**
 * 工程ごとの WIP 目安(design/images/new/01_dashboard の固定値)。
 * バックエンドに目安マスタが無いため、第一版はクライアント定数で持つ。
 */
export const PROCESS_WIP_GUIDES: Record<ProcessStepKey, number> = {
  intake: 10,
  entry: 12,
  decision: 12,
  dispense: 15,
  audit: 14,
  set: 20,
  visit: 8,
  report: 15,
  billing: 20,
};

export type ProcessNowTile = {
  key: ProcessStepKey;
  label: string;
  count: number;
  guide: number;
  /** over=目安超過(赤) / near=接近(橙) / normal */
  tone: 'over' | 'near' | 'normal';
};

/** MedicationCycle.overall_status の件数マップ → 9工程タイル。 */
export function buildProcessNowTiles(statusCounts: Record<string, number>): ProcessNowTile[] {
  return PROCESS_STEPS_9.map((step) => {
    const count = step.statuses.reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0);
    const guide = PROCESS_WIP_GUIDES[step.key];
    const tone: ProcessNowTile['tone'] =
      count >= guide * 1.2 ? 'over' : count > guide ? 'near' : 'normal';
    return { key: step.key, label: step.label, count, guide, tone };
  });
}

/** 目安超過の工程からボトルネック注記を生成(超過幅の大きい上位2工程・工程順)。 */
export function buildBottleneckNote(tiles: ProcessNowTile[]): string | null {
  const over = tiles.filter((tile) => tile.tone === 'over');
  if (over.length === 0) return null;
  const top = [...over]
    .sort((left, right) => right.count - right.guide - (left.count - left.guide))
    .slice(0, 2);
  const names = tiles
    .filter((tile) => top.some((candidate) => candidate.key === tile.key))
    .map((tile) => tile.label)
    .join('と');
  return `詰まりは${names}。上流の工程を今増やしても、今日は速くなりません。`;
}

// ---------------------------------------------------------------------------
// 今日の流れタイムライン
// ---------------------------------------------------------------------------

export const TIMELINE_START_MINUTES = 9 * 60;
export const TIMELINE_END_MINUTES = 18 * 60;

/** 監査 1 件あたりのデスク作業目安(分)。 */
const AUDIT_MINUTES_PER_TASK = 15;
const AUDIT_BLOCK_MIN_MINUTES = 30;
const AUDIT_BLOCK_MAX_MINUTES = 150;
const DEFAULT_VISIT_MINUTES = 60;
const LUNCH_START_MINUTES = 12 * 60;
const LUNCH_END_MINUTES = 13 * 60;
const REPORT_BLOCK_START_MINUTES = 17 * 60;
const REPORT_BLOCK_MIN_MINUTES = 20;

export type TimelineBlock = {
  id: string;
  kind: 'visit' | 'desk' | 'break';
  label: string;
  startMinutes: number;
  endMinutes: number;
  /** 訪問=動かせない固定点(🔒) */
  locked: boolean;
};

/** タイムライン上の横位置(%)。範囲外はクランプ。 */
export function timelinePercent(minutes: number): number {
  const clamped = Math.min(Math.max(minutes, TIMELINE_START_MINUTES), TIMELINE_END_MINUTES);
  return (
    ((clamped - TIMELINE_START_MINUTES) / (TIMELINE_END_MINUTES - TIMELINE_START_MINUTES)) * 100
  );
}

function clampToTimeline(minutes: number): number {
  return Math.min(Math.max(minutes, TIMELINE_START_MINUTES), TIMELINE_END_MINUTES);
}

function buildVisitBlocks(visits: CockpitVisit[]): TimelineBlock[] {
  const facilityGroups = new Map<string, CockpitVisit[]>();
  const individual: CockpitVisit[] = [];
  for (const visit of visits) {
    if (visit.time_start == null) continue; // 時間未確定の訪問はタイムラインに置かない
    if (visit.facility_batch_id) {
      const group = facilityGroups.get(visit.facility_batch_id) ?? [];
      group.push(visit);
      facilityGroups.set(visit.facility_batch_id, group);
      continue;
    }
    individual.push(visit);
  }

  const blocks: TimelineBlock[] = individual.map((visit) => {
    const start = minutesOfDay(visit.time_start as string);
    const end = visit.time_end ? minutesOfDay(visit.time_end) : start + DEFAULT_VISIT_MINUTES;
    return {
      id: `visit:${visit.id}`,
      kind: 'visit',
      label: `${visit.patient_name}様`,
      startMinutes: clampToTimeline(start),
      endMinutes: clampToTimeline(Math.max(end, start + 15)),
      locked: true,
    };
  });

  for (const [batchId, group] of facilityGroups) {
    const starts = group.map((visit) => minutesOfDay(visit.time_start as string));
    const ends = group.map((visit) =>
      visit.time_end
        ? minutesOfDay(visit.time_end)
        : minutesOfDay(visit.time_start as string) + DEFAULT_VISIT_MINUTES,
    );
    const start = Math.min(...starts);
    const end = Math.max(...ends, start + 15);
    blocks.push({
      id: `facility:${batchId}`,
      kind: 'visit',
      label: `施設訪問 ${group.length}名`,
      startMinutes: clampToTimeline(start),
      endMinutes: clampToTimeline(end),
      locked: true,
    });
  }

  return blocks.filter((block) => block.endMinutes > block.startMinutes);
}

/**
 * 今日の流れの横棒ブロック。訪問=固定点(緑🔒)、監査・報告書=デスク作業(青)、昼休み=灰。
 * デスク作業の時間帯は件数×目安からの仮置き(余白計算 API は未実装)。
 */
export function buildTimelineBlocks(args: {
  visits: CockpitVisit[];
  auditCount: number;
  narcoticAuditCount: number;
  reportCount: number;
}): TimelineBlock[] {
  const blocks: TimelineBlock[] = buildVisitBlocks(args.visits);
  const visitBlocks = [...blocks].sort((left, right) => left.startMinutes - right.startMinutes);

  if (args.auditCount > 0) {
    const duration = Math.min(
      Math.max(args.auditCount * AUDIT_MINUTES_PER_TASK, AUDIT_BLOCK_MIN_MINUTES),
      AUDIT_BLOCK_MAX_MINUTES,
    );
    const firstVisitStart = visitBlocks[0]?.startMinutes ?? Number.POSITIVE_INFINITY;
    const end = Math.min(
      TIMELINE_START_MINUTES + duration,
      Math.max(firstVisitStart, TIMELINE_START_MINUTES + AUDIT_BLOCK_MIN_MINUTES),
      TIMELINE_END_MINUTES,
    );
    if (end > TIMELINE_START_MINUTES) {
      blocks.push({
        id: 'desk:audit',
        kind: 'desk',
        label: `監査 ${args.auditCount}件${args.narcoticAuditCount > 0 ? '(麻薬を先頭)' : ''}`,
        startMinutes: TIMELINE_START_MINUTES,
        endMinutes: end,
        locked: false,
      });
    }
  }

  const lunchOverlapsVisit = visitBlocks.some(
    (block) => block.startMinutes < LUNCH_END_MINUTES && block.endMinutes > LUNCH_START_MINUTES,
  );
  if (!lunchOverlapsVisit) {
    blocks.push({
      id: 'break:lunch',
      kind: 'break',
      label: '昼休み',
      startMinutes: LUNCH_START_MINUTES,
      endMinutes: LUNCH_END_MINUTES,
      locked: false,
    });
  }

  if (args.reportCount > 0) {
    const lastVisitEnd = visitBlocks.reduce(
      (max, block) => Math.max(max, block.endMinutes),
      TIMELINE_START_MINUTES,
    );
    const start = Math.max(REPORT_BLOCK_START_MINUTES, lastVisitEnd);
    if (TIMELINE_END_MINUTES - start >= REPORT_BLOCK_MIN_MINUTES) {
      blocks.push({
        id: 'desk:report',
        kind: 'desk',
        label: `報告書 ${args.reportCount}件`,
        startMinutes: start,
        endMinutes: TIMELINE_END_MINUTES,
        locked: false,
      });
    }
  }

  return blocks.sort((left, right) => left.startMinutes - right.startMinutes);
}

/**
 * チームの余白 → ハンドオフ提案(new_01「判断キュー定型N件を◯◯さんへ回せます」)。
 * 目安超過が最大の工程と、勤務中で余白が最も大きいメンバー(30分以上)を組み合わせる。
 */
export function buildTeamHandoffSuggestion(
  tiles: ProcessNowTile[],
  team: Array<{ name: string; status: 'working' | 'off'; slack_minutes: number | null }>,
): string | null {
  const overTiles = tiles.filter((tile) => tile.tone === 'over');
  if (overTiles.length === 0) return null;
  const worst = overTiles.reduce((left, right) =>
    right.count - right.guide > left.count - left.guide ? right : left,
  );

  let candidate: { name: string; slack: number } | null = null;
  for (const member of team) {
    if (member.status !== 'working') continue;
    const slack = member.slack_minutes ?? 0;
    if (slack < 30) continue;
    if (!candidate || slack > candidate.slack) {
      candidate = { name: member.name, slack };
    }
  }
  if (!candidate) return null;

  const overflow = worst.count - worst.guide;
  const familyName = candidate.name.split(/[\s　]+/)[0] ?? candidate.name;
  return `${worst.label}キュー定型${overflow}件を${familyName}さんへ回せます`;
}
