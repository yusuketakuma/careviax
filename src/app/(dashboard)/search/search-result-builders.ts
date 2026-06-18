/**
 * 全体検索(/search)の結果行タイトル・サブ文の組み立て純関数群。
 * テスト容易化のため UI コンポーネントから分離。
 */

import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { REPORT_TYPE_LABELS, REPORT_STATUS_CONFIG } from '@/lib/constants/status-labels';
import { formatPrescriptionCardNumber } from '@/lib/prescription/rx-number';
import {
  CONTACT_STATUS_LABELS,
  PROPOSAL_STATUS_LABELS,
} from '@/lib/visits/visit-schedule-status-labels';

// ---------------------------------------------------------------------------
// カテゴリバッジ色定義
// ---------------------------------------------------------------------------

/** CLAUDE.md UI ガイドライン準拠の落ち着いた淡色。重大色(赤/橙/黄)は使わない。 */
export const SEARCH_CATEGORY_BADGE_CLASSES: Record<SearchCategory, string> = {
  patient: 'bg-blue-50 text-blue-700 border-blue-200',
  proposal: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  prescription: 'bg-violet-50 text-violet-700 border-violet-200',
  medicationDeadline: 'bg-rose-50 text-rose-700 border-rose-200',
  drug: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  facility: 'bg-sky-50 text-sky-700 border-sky-200',
  report: 'bg-amber-50 text-amber-700 border-amber-200',
  contact: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const SEARCH_CATEGORY_LABELS: Record<SearchCategory, string> = {
  patient: '患者',
  proposal: '訪問候補',
  prescription: '処方カード',
  medicationDeadline: '薬切れ',
  drug: '薬剤',
  facility: '施設',
  report: '報告書',
  contact: '連絡先',
};

export type SearchCategory =
  | 'patient'
  | 'proposal'
  | 'prescription'
  | 'medicationDeadline'
  | 'drug'
  | 'facility'
  | 'report'
  | 'contact';

// ---------------------------------------------------------------------------
// 結果行の共通型
// ---------------------------------------------------------------------------

export type SearchResultRow = {
  id: string;
  badgeLabel: string;
  badgeClassName: string;
  title: string;
  subtitle: string | null;
  href: string;
};

// ---------------------------------------------------------------------------
// API レスポンス型定義
// ---------------------------------------------------------------------------

export type PatientSearchItem = {
  id: string;
  name: string;
  name_kana?: string | null;
  conditions?: Array<{ name: string; is_primary?: boolean }>;
  visit_schedules?: Array<{ scheduled_date: string }>;
};

export type PrescriptionSearchItem = {
  id: string;
  prescribed_date?: string | null;
  prescriber_institution?: { name?: string | null } | null;
  cycle?: {
    overall_status?: string | null;
    case_?: {
      patient?: { name?: string | null } | null;
    } | null;
  } | null;
};

export type DrugSearchItem = {
  id: string;
  drug_name: string;
  generic_name?: string | null;
  therapeutic_category?: string | null;
  yj_code?: string | null;
};

export type FacilitySearchItem = {
  id: string;
  name: string;
  facility_type?: string | null;
};

export type ReportSearchItem = {
  id: string;
  report_type: string;
  status: string;
  created_at: string;
  patient_id?: string | null;
};

export type ContactSearchItem = {
  id: string;
  name: string;
  subtitle?: string | null;
  kind?: string | null;
};

export type ScheduleProposalSearchItem = {
  id: string;
  proposal_status: string;
  patient_contact_status?: string | null;
  proposed_date: string;
  time_window_start?: string | null;
  time_window_end?: string | null;
  proposed_pharmacist?: { name?: string | null } | null;
  case_?: {
    patient?: {
      id?: string | null;
      name?: string | null;
    } | null;
  } | null;
};

export type MedicationDeadlineSearchItem = {
  id: string;
  case_id: string;
  scheduled_date: string;
  medication_end_date: string;
  visit_type?: string | null;
  pharmacist_id?: string | null;
  case_?: {
    patient?: {
      id?: string | null;
      name?: string | null;
    } | null;
  } | null;
};

// ---------------------------------------------------------------------------
// 日付フォーマット helper
// ---------------------------------------------------------------------------

function formatDateMD(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return format(d, 'M/d', { locale: ja });
  } catch {
    return dateStr;
  }
}

function dateKeyFromDateString(dateStr: string): string {
  return dateStr.slice(0, 10);
}

// ---------------------------------------------------------------------------
// build*Result 関数群
// ---------------------------------------------------------------------------

export function buildPatientResult(item: PatientSearchItem): SearchResultRow {
  const conditionNames = (item.conditions ?? [])
    .slice(0, 2)
    .map((c) => c.name)
    .filter(Boolean)
    .join('・');

  const nextSchedule = item.visit_schedules?.[0]?.scheduled_date;
  const nextVisitText = nextSchedule ? `次回訪問 ${formatDateMD(nextSchedule)}` : null;

  const subtitleParts: string[] = [];
  if (conditionNames) subtitleParts.push(conditionNames);
  if (nextVisitText) subtitleParts.push(nextVisitText);

  return {
    id: item.id,
    badgeLabel: SEARCH_CATEGORY_LABELS.patient,
    badgeClassName: SEARCH_CATEGORY_BADGE_CLASSES.patient,
    title: `${item.name} 様`,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join('。') : null,
    href: `/patients/${item.id}`,
  };
}

export function buildPrescriptionResult(item: PrescriptionSearchItem): SearchResultRow {
  const rxNumber = formatPrescriptionCardNumber(item.id, item.prescribed_date);
  const institutionName = item.prescriber_institution?.name ?? null;
  const prescribedDateText = item.prescribed_date
    ? `${formatDateMD(item.prescribed_date)}処方`
    : null;

  const subtitleParts: Array<string> = [];
  if (institutionName) subtitleParts.push(institutionName);
  if (prescribedDateText) subtitleParts.push(prescribedDateText);

  return {
    id: item.id,
    badgeLabel: SEARCH_CATEGORY_LABELS.prescription,
    badgeClassName: SEARCH_CATEGORY_BADGE_CLASSES.prescription,
    title: rxNumber,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(' / ') : null,
    href: `/prescriptions/${item.id}`,
  };
}

export function buildDrugResult(item: DrugSearchItem): SearchResultRow {
  const subtitleParts: string[] = [];
  if (item.generic_name) subtitleParts.push(`一般名 ${item.generic_name}`);
  if (item.therapeutic_category) subtitleParts.push(item.therapeutic_category);
  if (item.yj_code) subtitleParts.push(item.yj_code);

  return {
    id: item.id,
    badgeLabel: SEARCH_CATEGORY_LABELS.drug,
    badgeClassName: SEARCH_CATEGORY_BADGE_CLASSES.drug,
    title: item.drug_name,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(' / ') : null,
    href: `/admin/drug-masters?q=${encodeURIComponent(item.yj_code ?? item.drug_name)}`,
  };
}

export function buildFacilityResult(item: FacilitySearchItem): SearchResultRow {
  return {
    id: item.id,
    badgeLabel: SEARCH_CATEGORY_LABELS.facility,
    badgeClassName: SEARCH_CATEGORY_BADGE_CLASSES.facility,
    title: item.name,
    subtitle: item.facility_type ?? null,
    href: `/admin/facilities?q=${encodeURIComponent(item.name)}`,
  };
}

export function buildReportResult(
  item: ReportSearchItem,
  patientName?: string | null,
): SearchResultRow {
  const dateText = formatDateMD(item.created_at);
  const typeLabel = REPORT_TYPE_LABELS[item.report_type] ?? '報告書';
  const titleBase = `${dateText} ${typeLabel}`;
  const title = patientName ? `${patientName} 様 ${titleBase}` : titleBase;
  const statusLabel = REPORT_STATUS_CONFIG[item.status]?.label ?? item.status;

  return {
    id: item.id,
    badgeLabel: SEARCH_CATEGORY_LABELS.report,
    badgeClassName: SEARCH_CATEGORY_BADGE_CLASSES.report,
    title,
    subtitle: statusLabel,
    href: `/reports/${item.id}`,
  };
}

export function buildContactResult(item: ContactSearchItem): SearchResultRow {
  return {
    id: item.id,
    badgeLabel: SEARCH_CATEGORY_LABELS.contact,
    badgeClassName: SEARCH_CATEGORY_BADGE_CLASSES.contact,
    title: item.name,
    subtitle: item.subtitle ?? null,
    href: `/admin/contact-profiles?q=${encodeURIComponent(item.name)}`,
  };
}

export function buildScheduleProposalResult(item: ScheduleProposalSearchItem): SearchResultRow {
  const patientName = item.case_?.patient?.name ?? '患者未設定';
  const dateText = formatDateMD(item.proposed_date);
  const timeText =
    item.time_window_start && item.time_window_end
      ? `${formatDateMD(item.time_window_start)} ${format(new Date(item.time_window_start), 'HH:mm')}〜${format(
          new Date(item.time_window_end),
          'HH:mm',
        )}`
      : dateText;
  const proposalStatus =
    PROPOSAL_STATUS_LABELS[item.proposal_status as keyof typeof PROPOSAL_STATUS_LABELS] ??
    item.proposal_status;
  const contactStatus = item.patient_contact_status
    ? (CONTACT_STATUS_LABELS[item.patient_contact_status as keyof typeof CONTACT_STATUS_LABELS] ??
      item.patient_contact_status)
    : null;
  const pharmacistName = item.proposed_pharmacist?.name ?? null;
  const subtitleParts = [timeText, proposalStatus, contactStatus, pharmacistName].filter(Boolean);

  return {
    id: item.id,
    badgeLabel: SEARCH_CATEGORY_LABELS.proposal,
    badgeClassName: SEARCH_CATEGORY_BADGE_CLASSES.proposal,
    title: `${patientName} 様の訪問候補`,
    subtitle: subtitleParts.join(' / '),
    href: `/schedules/proposals?workspace=dashboard&detail=${encodeURIComponent(item.id)}`,
  };
}

export function buildMedicationDeadlineResult(item: MedicationDeadlineSearchItem): SearchResultRow {
  const patientName = item.case_?.patient?.name ?? '患者未設定';
  const endDateText = formatDateMD(item.medication_end_date);
  const scheduledDateText = formatDateMD(item.scheduled_date);

  return {
    id: item.id,
    badgeLabel: SEARCH_CATEGORY_LABELS.medicationDeadline,
    badgeClassName: SEARCH_CATEGORY_BADGE_CLASSES.medicationDeadline,
    title: `${patientName} 様の薬切れ予定`,
    subtitle: `薬切れ ${endDateText} / 訪問予定 ${scheduledDateText}`,
    href: `/schedules?date=${encodeURIComponent(dateKeyFromDateString(item.scheduled_date))}`,
  };
}
