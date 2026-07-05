import type { ProcessStepKey } from '@/lib/prescription/cycle-workspace';

/**
 * new_02_patient_list(患者カード一覧)の BFF レスポンス型
 * (docs/design-gap-analysis-new.md new_02_patient_list)。
 * カードの状態語彙(今すぐ対応/待ち解除/受入判断/本日訪問/外部待ち/返信待ち/確認中/順調/休止中)と
 * 現在工程・危険タグ・状態自然文をサーバー側で導出して返す。
 */

/** カードの対応カテゴリ(=左ライン/バッジの状態色)。並びは「対応が必要な順」。 */
export type PatientAttentionKey =
  | 'urgent_now'
  | 'wait_release'
  | 'acceptance'
  | 'visit_today'
  | 'external_wait'
  | 'checking'
  | 'reply_wait'
  | 'steady'
  | 'paused';

/** 状態自然文の色(赤=要対応/緑=待ち解除・順調/橙=確認・受入/青=本日訪問/紫=外部待ち)。 */
export type PatientStatusTone =
  | 'critical'
  | 'positive'
  | 'caution'
  | 'info'
  | 'external'
  | 'neutral';

export type PatientResidenceKind = 'home' | 'facility' | 'hospital';

export type PatientFoundationIssueKey =
  | 'missing_contact'
  | 'missing_consent_plan'
  | 'missing_parking'
  | 'missing_care_level'
  | 'missing_insurance'
  | 'missing_care_team';

export type PatientBoardCard = {
  patient_id: string;
  name: string;
  age: number | null;
  residence_kind: PatientResidenceKind;
  /** 「在宅」「施設GH」「入院中」 */
  residence_label: string;
  attention: PatientAttentionKey;
  /** 危険タグ(narcotic / cold_storage / renal / swallowing / allergy / unit_dose 等)。空=安全タグなし */
  safety_tags: string[];
  /** 次回訪問日(YYYY-MM-DD)。未定は null + next_visit_label */
  next_visit_date: string | null;
  /** 次回訪問時刻(HH:mm) */
  next_visit_time: string | null;
  /** 日付が無いときの表示(「未定(調整中)」「退院連絡待ち」等) */
  next_visit_label: string | null;
  /** 現在工程(休止・受入判断などフロー外は null → 全点灰ドット) */
  current_step: ProcessStepKey | null;
  /** 状態の自然文(対応内容や期限) */
  status_text: string;
  status_tone: PatientStatusTone;
  /** 一覧でクリック前に確認したい訪問条件(連絡先有無/駐車/介護度など、電話番号は含めない) */
  operation_summary?: string[];
  /** 患者カード/詳細の情報基盤として、次に確認すべき正本項目。PHI の生値は含めない */
  foundation_summary?: {
    status: 'ready' | 'needs_confirmation' | 'missing';
    label: string;
    items: string[];
  };
  /** 正本未整備の原因キー。PHI の生値は含めず、UI filter / task routing 用の安定キーだけを返す。 */
  foundation_issue_keys?: PatientFoundationIssueKey[];
  /** 未確認の正本項目へ直接移動する導線。通常は患者詳細の正本確認アンカー */
  foundation_href?: string;
  /** 工程ショートカット(「→ 監査へ」等) */
  link_label: string;
  link_href: string;
};

export type PatientBoardChipCounts = {
  urgent_now: number;
  external_wait: number;
  visit_today: number;
  paused: number;
};

export type PatientBoardFoundationIssueCounts = Record<
  'needs_confirmation' | PatientFoundationIssueKey,
  number
>;

export type PatientBoardNextAction = {
  patient_name: string;
  due_at: string | null;
  has_narcotic: boolean;
};

export type PatientBoardBlockedReason = {
  id: string;
  label: string;
  severity: 'critical' | 'warning';
  category: string;
  age_minutes: number;
  action_label: string;
  action_href: string;
};

export type PatientBoardResponse = {
  generated_at: string;
  scope: 'mine' | 'all';
  /** 担当患者の母数(「私の担当 N名のうち M名を表示」の N) */
  assigned_total: number;
  /**
   * 取得上限で打ち切られたか = assigned_total > 取得行数(フィルタ/slice 前)。
   * true のとき cards は assigned_total の一部(取得上限により返却された部分集合)で、
   * 優先度の高い患者が表示範囲外にいる可能性がある。foundation_issue 等の絞り込みで
   * cards が減るのは truncation ではない(この値は絞り込み前の取得行数で判定する)。
   * UI は検索での絞り込みとは区別した truncation 注意を出す。
   */
  truncated: boolean;
  cards: PatientBoardCard[];
  chip_counts: PatientBoardChipCounts;
  /**
   * Active foundation_issue filter を除いた取得済み board basis 上の正本未整備件数。
   * foundation chip が別 foundation chip の選択で false-zero にならないよう UI はここを使う。
   * truncated=true の場合は取得上限内の件数であり、全母数の厳密件数ではない。
   */
  foundation_issue_counts: PatientBoardFoundationIssueCounts;
  /** 本日訪問のうち施設一括の対象人数(「本日訪問 3+施設12名」の 12) */
  today_facility_patient_count: number;
  /** 個別の本日訪問件数 */
  today_visit_count: number;
  /** 安全タグありの患者数(右レール 根拠・記録) */
  safety_tagged_count: number;
  next_action: PatientBoardNextAction | null;
  blocked_reasons: PatientBoardBlockedReason[];
};
