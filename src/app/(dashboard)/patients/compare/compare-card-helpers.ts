import { format, parseISO } from 'date-fns';
import {
  PROCESS_STEPS_9,
  getCycleWorkspaceAction,
  getProcessStepIndex,
  getProcessStepKeyForStatus,
} from '@/lib/prescription/cycle-workspace';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import type { PatientAttentionKey, PatientBoardCard } from '@/types/patient-board';

/**
 * design/images/P1 p1_02_multi_card_split_workspace(複数カードを並べて確認)の導出ロジック。
 * 既存 BFF(/api/patients/board と /api/patients/[id]/overview の workspace)を入力に、
 * カードプレビュー(種別ラベル / 期間サブ / 今日の見どころ / 止まっている理由 / 次にやること)を組み立てる。
 * 全て純関数(fetch しない)。
 */

/** 並べる対象サイクルの最小情報(PatientWorkspace のサブセット、構造的部分型)。 */
export type CompareWorkspaceInput = {
  overall_status: string;
  exception_status: string | null;
  current_intake: {
    id: string;
    prescribed_date: string;
    prescription_category: string;
  } | null;
  today_tasks: Array<{ time_label: string; label: string; due_time: string | null }>;
  open_exceptions: Array<{ id: string; description: string; severity: 'critical' | 'warning' }>;
  previous_medication: { start: string | null; end: string | null } | null;
  current_medication: { start: string | null; end: string | null } | null;
};

/** 患者カード一覧(board BFF)からの最小情報。 */
export type CompareBoardCardInput = Pick<
  PatientBoardCard,
  'patient_id' | 'attention' | 'status_text' | 'link_label' | 'link_href' | 'current_step'
>;

export type CompareCardBlockedReason = {
  id: string;
  label: string;
  severity: 'critical' | 'warning';
};

export type CompareCardNextAction = {
  description: string;
  actionLabel: string;
  actionHref: string;
};

export type CompareCardView = {
  /** 定期処方カード / 臨時処方カード / 返信待ちカード / 処方カード */
  typeLabel: string;
  /** 例: 「前回薬 5/21まで / 今回 5/22〜6/18」 */
  periodSub: string;
  /** 今日の見どころ(1〜2 行) */
  highlights: string[];
  /** 止まっている理由(先頭 1〜2 件。空 = なし) */
  blockedReasons: CompareCardBlockedReason[];
  /** 次にやること(薄青枠)。null = 進行中の作業なし */
  nextAction: CompareCardNextAction | null;
};

/** MedicationCycle.exception_status のうち「返信待ち」系(board の reply_wait と同じ語彙)。 */
const REPLY_WAIT_EXCEPTION_STATUSES = ['awaiting_reply', 'report_failed'];

/** 外部からの返答を待っている対応カテゴリ(待ちの内容を「止まっている理由」に出す)。 */
const EXTERNAL_WAIT_ATTENTIONS: PatientAttentionKey[] = ['external_wait', 'reply_wait'];

/** 返信/回答待ちカードの「次にやること」説明文(workspace が無いときの代替)。 */
const ATTENTION_NEXT_DESCRIPTIONS: Partial<Record<PatientAttentionKey, string>> = {
  reply_wait: '返信状況を確認して、必要であれば報告を再送します。',
  external_wait: '回答状況を確認して、必要であれば再照会します。',
};

const FALLBACK_NEXT_DESCRIPTION = 'カードの状況を確認して、次の対応へ進めます。';

/**
 * カード種別ラベルの導出。
 * 返信待ち(attention=reply_wait / exception_status=awaiting_reply 系)→ 返信待ちカード、
 * 現行 intake の prescription_category(regular | emergency)→ 定期/臨時処方カード。
 * 判定材料が無い(サイクル・intake なし)場合は「処方カード」で代替。
 */
export function deriveCardTypeLabel(args: {
  attention?: PatientAttentionKey | null;
  exceptionStatus?: string | null;
  prescriptionCategory?: string | null;
}): string {
  if (
    args.attention === 'reply_wait' ||
    REPLY_WAIT_EXCEPTION_STATUSES.includes(args.exceptionStatus ?? '')
  ) {
    return '返信待ちカード';
  }
  if (args.prescriptionCategory === 'emergency') return '臨時処方カード';
  if (args.prescriptionCategory === 'regular') return '定期処方カード';
  return '処方カード';
}

function formatMonthDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, 'M/d');
}

/**
 * 期間サブの導出: 「前回薬 M/dまで / 今回 M/d〜M/d」。
 * 処方行に服用期間が無いときは取込日(「今回処方 M/d 取込」)、
 * 進行中サイクルが無いときは「進行中の処方はありません」で代替。
 */
export function formatMedicationPeriodSub(workspace: CompareWorkspaceInput | null): string {
  if (!workspace) return '進行中の処方はありません';
  const previousEnd = formatMonthDay(workspace.previous_medication?.end);
  const currentStart = formatMonthDay(workspace.current_medication?.start);
  const currentEnd = formatMonthDay(workspace.current_medication?.end);
  const currentLabel = currentStart && currentEnd ? `今回 ${currentStart}〜${currentEnd}` : null;
  if (previousEnd && currentLabel) return `前回薬 ${previousEnd}まで / ${currentLabel}`;
  if (currentLabel) return currentLabel;
  const prescribed = formatMonthDay(workspace.current_intake?.prescribed_date);
  if (prescribed) return `今回処方 ${prescribed} 取込`;
  return '処方期間は未登録です';
}

/** 現在工程キー → 工程ラベル(取込/入力/…/算定)。 */
function getStepLabel(stepKey: ReturnType<typeof getProcessStepKeyForStatus>): string | null {
  if (!stepKey) return null;
  return PROCESS_STEPS_9[getProcessStepIndex(stepKey)]?.label ?? null;
}

/**
 * 1 患者分のカードプレビューを導出する。
 * - 今日の見どころ: 今日のタスク(先頭 2 件)→ 現在工程の状態 → 一覧の状態文の順で代替
 * - 止まっている理由: open_exceptions(先頭 2 件)→ 外部回答待ちは一覧の状態文 → なし
 * - 次にやること: サイクル状態の主操作(期限があればラベルに内包)→ 一覧の工程ショートカット
 */
export function deriveCompareCardView(args: {
  boardCard: CompareBoardCardInput | null;
  workspace: CompareWorkspaceInput | null;
}): CompareCardView {
  const { boardCard, workspace } = args;
  const cycleAction = workspace ? getCycleWorkspaceAction(workspace.overall_status) : null;
  const workspaceStepLabel = workspace
    ? getStepLabel(getProcessStepKeyForStatus(workspace.overall_status))
    : null;
  const boardStepLabel = boardCard?.current_step ? getStepLabel(boardCard.current_step) : null;
  const isExternalWait =
    boardCard != null && EXTERNAL_WAIT_ATTENTIONS.includes(boardCard.attention);
  const externalWaitRequestHref =
    boardCard && isExternalWait
      ? buildCommunicationRequestsHref({ status: 'sent', patientId: boardCard.patient_id })
      : null;

  // ── 今日の見どころ ──────────────────────────────────────────
  let highlights: string[];
  if (workspace && workspace.today_tasks.length > 0) {
    highlights = workspace.today_tasks
      .slice(0, 2)
      .map((task) => `${task.time_label} ${task.label}`);
  } else if (cycleAction) {
    highlights = [
      workspaceStepLabel
        ? `現在の工程: ${workspaceStepLabel}(${cycleAction.statusLabel})`
        : `現在: ${cycleAction.statusLabel}`,
    ];
  } else if (boardCard && !isExternalWait) {
    // 外部回答待ちの状態文は「止まっている理由」側に出すため、ここでは使わない
    highlights = [boardCard.status_text];
  } else if (boardStepLabel) {
    highlights = [`現在の工程: ${boardStepLabel}`];
  } else {
    highlights = ['今日このカードでやることはありません'];
  }

  // ── 止まっている理由 ────────────────────────────────────────
  let blockedReasons: CompareCardBlockedReason[];
  if (workspace && workspace.open_exceptions.length > 0) {
    blockedReasons = workspace.open_exceptions.slice(0, 2).map((exception) => ({
      id: exception.id,
      label: exception.description,
      severity: exception.severity,
    }));
  } else if (boardCard && isExternalWait) {
    blockedReasons = [
      { id: `attention-${boardCard.attention}`, label: boardCard.status_text, severity: 'warning' },
    ];
  } else {
    blockedReasons = [];
  }

  // ── 次にやること ────────────────────────────────────────────
  let nextAction: CompareCardNextAction | null = null;
  if (cycleAction) {
    // 期限つきタスクがあれば主操作ラベルに内包する(06_card と同じ規約)
    const deadlineTask = workspace?.today_tasks.find((task) => task.due_time != null) ?? null;
    nextAction = {
      description: cycleAction.description,
      actionLabel: deadlineTask?.due_time
        ? `${cycleAction.actionLabel} — ${deadlineTask.due_time}期限`
        : cycleAction.actionLabel,
      actionHref: externalWaitRequestHref ?? cycleAction.actionHref,
    };
  } else if (boardCard) {
    nextAction = {
      description: ATTENTION_NEXT_DESCRIPTIONS[boardCard.attention] ?? FALLBACK_NEXT_DESCRIPTION,
      actionLabel: boardCard.link_label,
      actionHref: externalWaitRequestHref ?? boardCard.link_href,
    };
  }

  return {
    typeLabel: deriveCardTypeLabel({
      attention: boardCard?.attention ?? null,
      exceptionStatus: workspace?.exception_status ?? null,
      prescriptionCategory: workspace?.current_intake?.prescription_category ?? null,
    }),
    periodSub: formatMedicationPeriodSub(workspace),
    highlights,
    blockedReasons,
    nextAction,
  };
}

/** 並べられる最大カード数(target デザインの 3 カラム)。 */
export const COMPARE_CARD_LIMIT = 3;

/**
 * ?patients=id1,id2,id3 の解釈(空要素除去・重複排除・最大 3 件)。
 */
export function parseComparePatientsParam(
  value: string | null | undefined,
  limit: number = COMPARE_CARD_LIMIT,
): string[] {
  if (!value) return [];
  const ids: string[] = [];
  for (const raw of value.split(',')) {
    const id = raw.trim();
    if (id.length > 0 && !ids.includes(id)) ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

/**
 * クエリ未指定時の既定 3 枚: 「注目すべきカード」を一覧(対応が必要な順ソート済み)から導出する。
 * 1. 一覧の最優先カード(今すぐ対応など先頭)
 * 2. 返信待ちのある患者(reply_wait)
 * 3. 止まっている理由のある患者(確認中 checking → 外部回答待ち external_wait)
 * 足りない分は一覧の優先順で補完する。
 */
export function selectDefaultComparePatients(
  cards: Array<Pick<PatientBoardCard, 'patient_id' | 'attention'>>,
  limit: number = COMPARE_CARD_LIMIT,
): string[] {
  const picked: string[] = [];
  const pushUnique = (patientId: string | undefined) => {
    if (patientId && !picked.includes(patientId) && picked.length < limit) {
      picked.push(patientId);
    }
  };

  pushUnique(cards[0]?.patient_id);
  pushUnique(cards.find((card) => card.attention === 'reply_wait')?.patient_id);
  pushUnique(
    (
      cards.find((card) => card.attention === 'checking') ??
      cards.find((card) => card.attention === 'external_wait')
    )?.patient_id,
  );
  for (const card of cards) pushUnique(card.patient_id);
  return picked;
}
