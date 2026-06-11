/**
 * new_04_visit(今日の訪問 — 出発前の準備チェック)の BFF レスポンス型
 * (docs/design-gap-analysis-new.md 04_visit)。
 * 「準備 N/N」のチェック内訳・危険タグ・未完アラート・施設一括の進捗を
 * サーバー側で導出して返す。
 */

/** チェックチップの状態(done=✓ / alert=⚠未完 / progress=進行中 / pending=未着手)。 */
export type VisitPrepCheckState = 'done' | 'alert' | 'progress' | 'pending';

export type VisitPrepCheck = {
  id: string;
  label: string;
  state: VisitPrepCheckState;
};

/** カード左の縦アクセントバー(緑=準備完了 / 橙=要注意 / 青=進行中)。 */
export type VisitPrepAccent = 'ready' | 'caution' | 'progress';

export type VisitPrepAction = {
  label: string;
  href: string;
};

export type VisitPreparationCard = {
  schedule_id: string;
  /** 訪問モード(VisitMode)への遷移先 */
  visit_mode_href: string;
  /** 「10:30」。時間未確定は null */
  time_label: string | null;
  /** 「伊藤 キヨ 様」「施設グリーンヒル」 */
  title: string;
  is_facility: boolean;
  /** 施設一括の対象人数(個別訪問は null) */
  patient_count: number | null;
  /** 「在宅・滞在45分」「12名・滞在90分」 */
  meta_label: string;
  /** 危険タグ(narcotic / cold_storage / allergy / swallowing 等)。隠さない */
  safety_tags: string[];
  prep_done: number;
  prep_total: number;
  accent: VisitPrepAccent;
  checks: VisitPrepCheck[];
  /** 注記(繰り下げ案・残作業など) */
  note: string | null;
  note_tone: 'warning' | 'info' | null;
  /** アウトラインの遷移リンク(「→監査へ」「→カードへ」等) */
  actions: VisitPrepAction[];
};

export type VisitPrepNextAction = {
  patient_name: string;
  due_at: string | null;
  has_narcotic: boolean;
};

export type VisitPrepBlockedReason = {
  id: string;
  label: string;
  severity: 'critical' | 'warning';
  category: string;
  age_minutes: number;
  action_label: string;
  action_href: string;
};

export type VisitPrepEvidence = {
  /** 本日のルート計算時刻(ISO)。未計算は null */
  route_calculated_at: string | null;
  /** 保冷バッグ等を積む車両ラベル */
  vehicle_label: string | null;
  /** 本日訪問患者の前回訪問記録件数 */
  prior_record_count: number;
};

export type VisitPreparationBoardResponse = {
  generated_at: string;
  /** 個別訪問の件数(施設一括はカード 1 枚で別カウント) */
  visit_count: number;
  /** 施設一括の対象人数 */
  facility_patient_count: number;
  cards: VisitPreparationCard[];
  next_action: VisitPrepNextAction | null;
  blocked_reasons: VisitPrepBlockedReason[];
  evidence: VisitPrepEvidence;
};
