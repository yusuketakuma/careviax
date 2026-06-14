/**
 * p1_14「気になる処方の表示設定」の表示モデル(純関数)。
 * 処方安全アラートルール(drug-alert-rules)を「強く表示/標準」の
 * 項目別トグルへ射影し、保存時の差分(作成/有効化/無効化)を計算する。
 */

// 表示ラベルは p1_14 デザインの左リスト/カードタグに合わせる。
// alertType は drug-alert-rules API の許可値(renal_dose / pim_elderly /
// high_risk / duplicate / interaction)へ射影する(新規アラート種別は追加しない)。
export const SIGNAL_TUNING_ITEMS = [
  { alertType: 'renal_dose', label: '腎機能に注意', tagLabel: '腎機能注意', tone: 'red' },
  { alertType: 'pim_elderly', label: '転倒リスク', tagLabel: '転倒注意', tone: 'amber' },
  { alertType: 'high_risk', label: '低血糖リスク', tagLabel: '低血糖', tone: 'red' },
  { alertType: 'duplicate', label: '残薬多め', tagLabel: '残薬', tone: 'blue' },
  { alertType: 'interaction', label: '飲み合わせ', tagLabel: '飲み合わせ', tone: 'blue' },
] as const;

export type SignalTuningAlertType = (typeof SIGNAL_TUNING_ITEMS)[number]['alertType'];

export type SignalTuningRule = {
  id: string;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  is_active: boolean;
};

export type SignalTuningState = Record<
  SignalTuningAlertType,
  { ruleId: string | null; strong: boolean }
>;

/** alert_type ごとに「critical ルール」を探し、強く表示(=active)状態を読む。 */
export function buildSignalTuningState(rules: SignalTuningRule[]): SignalTuningState {
  const state = {} as SignalTuningState;
  for (const item of SIGNAL_TUNING_ITEMS) {
    const rule = rules.find(
      (candidate) => candidate.alert_type === item.alertType && candidate.severity === 'critical',
    );
    state[item.alertType] = {
      ruleId: rule?.id ?? null,
      strong: Boolean(rule?.is_active),
    };
  }
  return state;
}

export type SignalTuningDiff = {
  create: SignalTuningAlertType[];
  activate: string[];
  deactivate: string[];
};

/** 希望状態(strong: true/false)との差分を保存操作へ変換する。 */
export function diffSignalTuning(
  current: SignalTuningState,
  desired: Record<SignalTuningAlertType, boolean>,
): SignalTuningDiff {
  const diff: SignalTuningDiff = { create: [], activate: [], deactivate: [] };
  for (const item of SIGNAL_TUNING_ITEMS) {
    const entry = current[item.alertType];
    const wantStrong = desired[item.alertType];
    if (wantStrong === entry.strong) continue;
    if (wantStrong) {
      if (entry.ruleId) diff.activate.push(entry.ruleId);
      else diff.create.push(item.alertType);
    } else if (entry.ruleId) {
      diff.deactivate.push(entry.ruleId);
    }
  }
  return diff;
}
