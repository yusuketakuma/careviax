/** 取込経路レーン(PrescriptionSourceType を 3 レーンへ集約) */
export type IntakeTriageLane = 'fax' | 'online' | 'walk_in';

/** トリアージ状態(取込観点の語彙。MedicationCycleStatus から導出) */
export type IntakeTriageStatusKey =
  | 'unblock_related'
  | 'acceptance_pending'
  | 'duplicate_suspected'
  | 'entry_pending'
  | 'inquiry_waiting'
  | 'entered_in_progress'
  | 'imported'
  | 'on_hold';

/** 行末アクション種別(状態ごとに導線が変わる) */
export type IntakeTriageActionKey =
  | 'send_to_entry'
  | 'compare'
  | 'to_dashboard'
  | 'to_audit'
  | 'to_dispensing'
  | 'to_set'
  | 'to_card';

export type IntakeTriageRow = {
  intake_id: string;
  cycle_id: string;
  patient_id: string;
  patient_name: string;
  /** 受信日時(ISO) */
  received_at: string;
  lane: IntakeTriageLane;
  /** 発行元(医療機関名等)。不明は null */
  issuer: string | null;
  /** 内容ラベル(「定期処方」「処方変更(照会回答の反映)」等) */
  content_label: string;
  /** RX 番号(formatPrescriptionCardNumber 済み)。入力済以降の行に付く */
  rx_number: string | null;
  /** 自動読取の確からしさ(%)。スコア未保持(FAX 等)は null = 「—」 */
  auto_read_percent: number | null;
  status: IntakeTriageStatusKey;
  /** 重複の疑い: 一致した既存取込の日付(M/d)。それ以外は null */
  duplicate_of_date: string | null;
  action: IntakeTriageActionKey;
};

export type IntakeTriageDuplicateNotice = {
  /** 重複ペアの新しい方の intake */
  intake_id: string;
  patient_name: string;
  lane: IntakeTriageLane;
  /** 一致した既存取込の日付(M/d) */
  matched_date: string;
};

export type IntakeTriageEvidence = {
  /** 元 FAX 画像の件数(original_document_url を持つ FAX 取込) */
  fax_document_count: number;
  /** 読取モデル(QR パーサ)のスキーマ版。未使用は null */
  reader_model_version: string | null;
  /** 当月の破棄ログ件数(QrScanDraft discarded) */
  discard_count_this_month: number;
};

export type IntakeTriageResponse = {
  generated_at: string;
  /** 本日受信の件数(ヘッダー「新着n件」) */
  new_today_count: number;
  /** 人の判断待ち件数(受入判断待ち+重複の疑い+保留) */
  needs_decision_count: number;
  lane_counts: Record<IntakeTriageLane, number>;
  rows: IntakeTriageRow[];
  duplicate_notices: IntakeTriageDuplicateNotice[];
  evidence: IntakeTriageEvidence;
};
