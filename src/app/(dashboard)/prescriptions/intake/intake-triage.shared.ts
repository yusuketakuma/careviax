/**
 * new_05_import(処方取込トリアージ)の共有語彙。
 * /api/prescription-intakes/triage のレスポンス型と、
 * 経路(FAX/オンライン/持込)・トリアージ状態の表示マッピングをここに集約する。
 * docs/design-gap-analysis-new.md 05_import セクション準拠。
 */

/** 取込経路レーン(PrescriptionSourceType を 3 レーンへ集約) */
export type IntakeTriageLane = 'fax' | 'online' | 'walk_in';

/** トリアージ状態(取込観点の語彙。MedicationCycleStatus から導出) */
export type IntakeTriageStatusKey =
  | 'unblock_related' // 待ち解除に関連(照会回答の反映)
  | 'acceptance_pending' // 受入判断待ち
  | 'duplicate_suspected' // 重複の疑い
  | 'entry_pending' // 入力待ち
  | 'inquiry_waiting' // 照会回答待ち
  | 'entered_in_progress' // 入力済 → 後工程進行中
  | 'imported' // 取込済
  | 'on_hold'; // 保留中

/** 行末アクション種別(状態ごとに導線が変わる) */
export type IntakeTriageActionKey =
  | 'send_to_entry' // 入力へ送る(主操作)
  | 'compare' // 並べて比較
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

export const INTAKE_LANE_LABELS: Record<IntakeTriageLane, string> = {
  fax: 'FAX',
  online: 'オンライン',
  walk_in: '持込',
};

/** 経路バッジの配色(FAX=青系 / オンライン=紫系 / 持込=グレー系) */
export const INTAKE_LANE_BADGE_CLASSES: Record<IntakeTriageLane, string> = {
  fax: 'bg-blue-100 text-blue-700',
  online: 'bg-violet-100 text-violet-700',
  walk_in: 'bg-slate-200 text-slate-700',
};

export type IntakeTriageStatusPresentation = {
  label: string;
  /** 状態バッジの配色(緑=待ち解除/進行、紫=受入判断、橙=注意、灰=完了系) */
  badgeClassName: string;
  /** 行全体の背景ハイライト(待ち解除=薄緑 / 重複=薄橙) */
  rowClassName?: string;
};

export const INTAKE_STATUS_PRESENTATIONS: Record<
  IntakeTriageStatusKey,
  IntakeTriageStatusPresentation
> = {
  unblock_related: {
    label: '待ち解除に関連',
    badgeClassName: 'bg-emerald-100 text-emerald-700',
    rowClassName: 'bg-emerald-50/60 hover:bg-emerald-50',
  },
  acceptance_pending: {
    label: '受入判断待ち',
    badgeClassName: 'bg-violet-100 text-violet-700',
  },
  duplicate_suspected: {
    label: '重複の疑い',
    badgeClassName: 'bg-amber-100 text-amber-800',
    rowClassName: 'bg-amber-50/60 hover:bg-amber-50',
  },
  entry_pending: {
    label: '入力待ち',
    badgeClassName: 'bg-blue-100 text-blue-700',
  },
  inquiry_waiting: {
    label: '照会回答待ち',
    badgeClassName: 'bg-amber-100 text-amber-800',
  },
  entered_in_progress: {
    label: '入力済',
    badgeClassName: 'bg-emerald-100 text-emerald-700',
  },
  imported: {
    label: '取込済',
    badgeClassName: 'bg-emerald-100 text-emerald-700',
  },
  on_hold: {
    label: '保留中',
    badgeClassName: 'bg-amber-100 text-amber-800',
  },
};

export type IntakeTriageActionPresentation = {
  label: string;
  /** true = 青塗り主操作候補(画面では先頭 1 行だけ primary にする) */
  primary?: boolean;
  href: (row: IntakeTriageRow) => string;
};

export const INTAKE_ACTION_PRESENTATIONS: Record<
  IntakeTriageActionKey,
  IntakeTriageActionPresentation
> = {
  send_to_entry: { label: '入力へ送る', primary: true, href: () => '/prescriptions' },
  compare: { label: '並べて比較', href: () => '/prescriptions' },
  to_dashboard: { label: '→ ダッシュボードへ', href: () => '/dashboard' },
  to_audit: { label: '→ 監査へ', href: () => '/auditing' },
  to_dispensing: { label: '→ 調剤へ', href: () => '/dispense' },
  to_set: { label: '→ セットへ', href: () => '/medication-sets' },
  to_card: { label: '→ カードへ', href: (row) => `/patients/${row.patient_id}` },
};

/**
 * 入力済 → 後工程進行中の行は「入力済 → 監査中」のように工程名まで出す。
 * action から先の工程名を引く。
 */
export function buildStatusLabel(row: IntakeTriageRow): string {
  if (row.status === 'duplicate_suspected') {
    return row.duplicate_of_date
      ? `重複の疑い(${row.duplicate_of_date}取込分と同一?)`
      : '重複の疑い';
  }
  if (row.status === 'entered_in_progress') {
    const stageLabel =
      row.action === 'to_audit'
        ? '監査中'
        : row.action === 'to_dispensing'
          ? '調剤中'
          : row.action === 'to_set'
            ? 'セット監査待ち'
            : '進行中';
    return `入力済 → ${stageLabel}`;
  }
  return INTAKE_STATUS_PRESENTATIONS[row.status].label;
}
