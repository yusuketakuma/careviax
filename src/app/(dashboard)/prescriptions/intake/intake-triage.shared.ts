/**
 * new_05_import(処方取込トリアージ)の共有語彙。
 * /api/prescription-intakes/triage のレスポンス型と、
 * 経路(FAX/オンライン/持込)・トリアージ状態の表示マッピングをここに集約する。
 * docs/design-gap-analysis-new.md 05_import セクション準拠。
 */

import type {
  IntakeTriageActionKey,
  IntakeTriageLane,
  IntakeTriageRow,
  IntakeTriageStatusKey,
} from '@/lib/prescriptions/intake-triage-contract';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';
import { buildPatientHref } from '@/lib/patient/navigation';

export type {
  IntakeTriageActionKey,
  IntakeTriageDuplicateNotice,
  IntakeTriageEvidence,
  IntakeTriageLane,
  IntakeTriageResponse,
  IntakeTriageRow,
  IntakeTriageStatusKey,
} from '@/lib/prescriptions/intake-triage-contract';

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
  send_to_entry: {
    label: '入力へ送る',
    primary: true,
    href: (row) => buildPrescriptionHref(row.intake_id),
  },
  compare: { label: '並べて比較', href: (row) => buildPrescriptionHref(row.intake_id) },
  to_dashboard: { label: '→ ダッシュボードへ', href: () => '/dashboard' },
  to_audit: { label: '→ 監査へ', href: () => '/audit' },
  to_dispensing: { label: '→ 調剤へ', href: () => '/dispense' },
  to_set: { label: '→ セットへ', href: () => '/set' },
  to_card: { label: '→ カードへ', href: (row) => buildPatientHref(row.patient_id) },
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
