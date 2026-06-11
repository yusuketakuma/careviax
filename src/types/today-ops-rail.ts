/**
 * 右レール共通 3 点セット(次にやること / 止まっている理由)の供給ペイロード。
 * design/images/new の 11_billing / 13_master ほか当日オペレーション系画面が共有する
 * (docs/design-gap-analysis-new.md「右レールは画面横断の共通供給源として設計」)。
 */

export type TodayOpsNextAction = {
  /** 主操作ラベル(例: 麻薬監査を開始 — 12:00期限) */
  label: string;
  /** 主操作の補足(例: 14:00訪問(田中様)の持参薬です。完了で午後の予定がすべて確定します。) */
  description: string;
  href: string;
};

export type TodayOpsBlockedReason = {
  id: string;
  label: string;
  severity: 'critical' | 'warning';
  /** カテゴリ色チップ(患者 / 事務 / 医療機関) */
  category: string;
  age_minutes: number;
  /** 個別アクション(例: 再連絡する →) */
  action_label: string;
  action_href: string;
};

export type TodayOpsRail = {
  next_action: TodayOpsNextAction;
  blocked_reasons: TodayOpsBlockedReason[];
};
