/**
 * design/ v1.9 カード詳細ワークスペース(p0_08)用の工程表示定義。
 * MedicationCycle.overall_status →「現在の状態」表示と「次にやること」(主操作 1 つ)。
 * 文言ルール: design/README_Codex.md(Next Action →「次にやること」)。
 */

import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';

export type CycleWorkspaceAction = {
  /** 左カード「現在」/ 工程タブの状態表示 */
  statusLabel: string;
  /** 右パネル「次にやること」の説明文 */
  description: string;
  /** 主操作ボタンのラベル(画面で 1 つだけ強調) */
  actionLabel: string;
  /** 主操作の遷移先(クエリは画面側で付与) */
  actionHref: string;
};

export const CYCLE_WORKSPACE_ACTIONS: Record<string, CycleWorkspaceAction> = {
  intake_received: {
    statusLabel: '処方構造化待ち',
    description: '受け取った処方箋を確認して、構造化を進めます。',
    actionLabel: '処方内容を確認する',
    actionHref: '/prescriptions',
  },
  structuring: {
    statusLabel: '処方構造化中',
    description: '処方明細の構造化を仕上げます。',
    actionLabel: '構造化を続ける',
    actionHref: '/prescriptions',
  },
  inquiry_pending: {
    statusLabel: '疑義照会中',
    description: '医師からの回答を確認して、処方へ反映します。',
    actionLabel: '照会状況を確認する',
    actionHref: buildCommunicationRequestsHref({ status: 'sent' }),
  },
  inquiry_resolved: {
    statusLabel: '照会反映待ち',
    description: '照会結果を反映して、調剤へ進めます。',
    actionLabel: '調剤へ進める',
    actionHref: '/dispense',
  },
  ready_to_dispense: {
    statusLabel: '調剤待ち',
    description: '処方の確認が済んでいます。調剤を始めます。',
    actionLabel: '調剤を始める',
    actionHref: '/dispense',
  },
  dispensing: {
    statusLabel: '調剤中',
    description: '調剤を仕上げて、鑑査へ進めます。',
    actionLabel: '調剤を続ける',
    actionHref: '/dispense',
  },
  dispensed: {
    statusLabel: '調剤鑑査待ち',
    description: '調剤鑑査をして、セット作業へ進めます。',
    actionLabel: '調剤鑑査を始める',
    actionHref: '/audit',
  },
  audit_pending: {
    statusLabel: '調剤鑑査中',
    description: '調剤鑑査を仕上げます。',
    actionLabel: '鑑査を続ける',
    actionHref: '/audit',
  },
  audited: {
    statusLabel: 'セット作業待ち',
    description: '鑑査済みの薬剤をセットして、セット監査へ進めます。',
    actionLabel: 'セットを始める',
    actionHref: '/set',
  },
  setting: {
    statusLabel: 'セット監査待ち',
    description: 'セット監査をして、訪問準備へ進めます。',
    actionLabel: 'セット監査を始める',
    actionHref: '/set-audit',
  },
  set_audited: {
    statusLabel: '訪問準備待ち',
    description: '持参パックを確認して、訪問準備を仕上げます。',
    actionLabel: '訪問準備を確認する',
    actionHref: '/schedules',
  },
  visit_ready: {
    statusLabel: '訪問待ち',
    description: '準備が済んでいます。訪問を始めます。',
    actionLabel: '訪問を始める',
    actionHref: '/visits',
  },
  visit_completed: {
    statusLabel: '報告書作成待ち',
    description: '訪問記録をもとに、報告書を作成します。',
    actionLabel: '報告書を作成する',
    actionHref: '/reports',
  },
  reported: {
    statusLabel: '報告済み',
    description: 'このサイクルの作業は完了しています。',
    actionLabel: '報告内容を見る',
    actionHref: '/reports',
  },
  on_hold: {
    statusLabel: '保留中',
    description: '保留の理由を確認して、再開の判断をします。',
    actionLabel: '保留内容を確認する',
    actionHref: '/workflow',
  },
  cancelled: {
    statusLabel: '中止',
    description: 'このサイクルは中止されています。',
    actionLabel: '経緯を確認する',
    actionHref: '/workflow',
  },
};

export function getCycleWorkspaceAction(status: string): CycleWorkspaceAction | null {
  return CYCLE_WORKSPACE_ACTIONS[status] ?? null;
}

// ---------------------------------------------------------------------------
// MedicationCycle.overall_status 表示ラベル
// ---------------------------------------------------------------------------

/**
 * MedicationCycle.overall_status の状態名。
 * CYCLE_WORKSPACE_ACTIONS.statusLabel は「次に待っている作業」を表すため、状態名とは分ける。
 */
export const CYCLE_STATUS_LABELS: Record<string, string> = {
  intake_received: '受付済',
  structuring: '構造化中',
  inquiry_pending: '疑義照会中',
  inquiry_resolved: '照会解決',
  ready_to_dispense: '調剤待ち',
  dispensing: '調剤中',
  dispensed: '調剤済',
  audit_pending: '監査待ち',
  audited: '監査済',
  setting: 'セット監査待ち',
  set_audited: 'セット監査済み',
  visit_ready: '訪問準備完了',
  visit_completed: '訪問完了',
  reported: '報告済',
  on_hold: '保留',
  cancelled: '取消',
};

/** フィルタチップなど狭い UI 用の短縮状態名。 */
export const CYCLE_STATUS_SHORT_LABELS: Record<string, string> = {
  intake_received: '受付',
  structuring: '構造化',
  inquiry_pending: '疑義',
  inquiry_resolved: '解決',
  ready_to_dispense: '調剤待',
  dispensing: '調剤中',
  dispensed: '済',
  audit_pending: '監査',
  audited: '監査済',
  setting: '監査待',
  set_audited: '監査済',
  visit_ready: '訪問準備',
  visit_completed: '訪問済',
  reported: '報告済',
  on_hold: '保留',
  cancelled: '取消',
};

// ---------------------------------------------------------------------------
// 9 工程定義(design/images/new 共通パターン)
// ---------------------------------------------------------------------------

/** design/images/new の工程語彙(取込→入力→判断→調剤→監査→セット→訪問→報告→算定)のキー。 */
export type ProcessStepKey =
  | 'intake'
  | 'entry'
  | 'decision'
  | 'dispense'
  | 'audit'
  | 'set'
  | 'visit'
  | 'report'
  | 'billing';

export type ProcessStepDefinition = {
  key: ProcessStepKey;
  label: string;
  /** この工程が「現在(いまここ)」になる MedicationCycleStatus 値 */
  statuses: readonly string[];
};

/**
 * design/images/new の 9 工程チップ列・進捗ドット用の工程定義。
 * MedicationCycleStatus(16 値)のうち on_hold / cancelled は線形フロー外のため
 * どの工程にも対応しない(getProcessStepKeyForStatus が null を返す)。
 *
 * マッピングの考え方: 各 status を「いま着手すべき/進行中の工程」に割り当てる。
 * - dispensed(調剤完了=監査待ち)/ audit_pending は「監査(いまここ)」(06_card の表現)。
 * - audited(監査済)は次工程「セット」が現在になる。同様に set_audited / visit_ready は「訪問」、
 *   visit_completed は「報告」、reported(報告済)は「算定」が現在。
 */
export const PROCESS_STEPS_9: readonly ProcessStepDefinition[] = [
  { key: 'intake', label: '取込', statuses: ['intake_received'] },
  { key: 'entry', label: '入力', statuses: ['structuring'] },
  { key: 'decision', label: '判断', statuses: ['inquiry_pending', 'inquiry_resolved'] },
  { key: 'dispense', label: '調剤', statuses: ['ready_to_dispense', 'dispensing'] },
  { key: 'audit', label: '監査', statuses: ['dispensed', 'audit_pending'] },
  { key: 'set', label: 'セット', statuses: ['audited', 'setting'] },
  { key: 'visit', label: '訪問', statuses: ['set_audited', 'visit_ready'] },
  { key: 'report', label: '報告', statuses: ['visit_completed'] },
  { key: 'billing', label: '算定', statuses: ['reported'] },
];

/** overall_status → 現在工程キー。フロー外(on_hold / cancelled / 未知)は null。 */
export function getProcessStepKeyForStatus(status: string): ProcessStepKey | null {
  const step = PROCESS_STEPS_9.find((candidate) => candidate.statuses.includes(status));
  return step?.key ?? null;
}

/** 工程キー → PROCESS_STEPS_9 内のインデックス(未知キーは -1)。 */
export function getProcessStepIndex(key: ProcessStepKey): number {
  return PROCESS_STEPS_9.findIndex((step) => step.key === key);
}
