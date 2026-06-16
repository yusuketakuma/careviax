/**
 * p0_47(帳票・印刷プレビュー)の共有語彙と純関数。
 * /reports/print の左カラム(印刷するもの)で選ぶ帳票それぞれについて、
 * 既存 API レスポンス(set-plans / patients/{id}/prescriptions / care-reports)を
 * A4 プレビューの帳票行へ射影する。副作用なし(vitest 対象)。
 */

import { SET_METHOD_LABELS } from '@/lib/dispensing/set-methods';
import {
  CHANNEL_LABELS,
  REPORT_STATUS_CONFIG,
  REPORT_TYPE_LABELS,
} from '@/lib/constants/status-labels';

// ─── 帳票種別 ────────────────────────────────────────────────────────────────

export type PrintDocumentTypeKey =
  | 'set_instruction'
  | 'medication_calendar'
  | 'visit_report'
  | 'document_receipt'
  | 'medication_label'
  | 'first_visit_documents';

export type PrintDocumentTypeOption = {
  key: PrintDocumentTypeKey;
  label: string;
};

/** 左カラム「印刷するもの」のカード(target の並び順) */
export const PRINT_DOCUMENT_TYPES: readonly PrintDocumentTypeOption[] = [
  { key: 'set_instruction', label: 'セット指示書' },
  { key: 'medication_calendar', label: '服薬カレンダー' },
  { key: 'visit_report', label: '訪問報告書' },
  { key: 'document_receipt', label: '文書交付控え' },
  { key: 'medication_label', label: '薬袋ラベル' },
  { key: 'first_visit_documents', label: '契約・同意控え' },
] as const;

const PRINT_DOCUMENT_TYPE_KEYS = new Set<string>(PRINT_DOCUMENT_TYPES.map((type) => type.key));

/** ?type= クエリの解釈。未指定・不正値は先頭(セット指示書)に倒す */
export function parsePrintDocumentType(raw: string | null | undefined): PrintDocumentTypeKey {
  if (raw && PRINT_DOCUMENT_TYPE_KEYS.has(raw)) {
    return raw as PrintDocumentTypeKey;
  }
  return 'set_instruction';
}

export function printDocumentTypeLabel(key: PrintDocumentTypeKey): string {
  return PRINT_DOCUMENT_TYPES.find((type) => type.key === key)?.label ?? key;
}

export function buildFirstVisitPrintCopyUrl({
  patientId,
  documentId,
}: {
  patientId: string;
  documentId: string;
}): string {
  const params = new URLSearchParams({
    type: 'first_visit_documents',
    patient_id: patientId,
    document_id: documentId,
    copy: '1',
  });
  return `/reports/print?${params.toString()}`;
}

// ─── 出力設定(右カラム) ─────────────────────────────────────────────────────

export type PrintOutputSettings = {
  /** 患者名を表示 */
  showPatientName: boolean;
  /** 施設名(発行元)を表示 */
  showFacilityName: boolean;
  /** QRコードを付ける(プレースホルダ矩形) */
  showQr: boolean;
  /** 控えを保存(印刷ダイアログでの PDF 保存を促す) */
  saveCopy: boolean;
};

export const DEFAULT_PRINT_OUTPUT_SETTINGS: PrintOutputSettings = {
  showPatientName: true,
  showFacilityName: true,
  showQr: true,
  saveCopy: true,
};

// ─── API レスポンスの最小型(既存 API の select に合わせる)──────────────────

export type SetPlanForPrint = {
  id: string;
  cycle_id: string;
  target_period_start: string;
  target_period_end: string;
  set_method: string;
  packaging_summary_snapshot: {
    packaging_method_name?: string | null;
    special_instructions?: string[];
    tag_labels?: string[];
  } | null;
  notes: string | null;
  created_at: string;
  packaging_method_ref?: { id: string; name: string } | null;
  cycle: {
    id: string;
    patient_id: string;
    case_: { patient: { id: string; name: string; name_kana: string } };
  };
  audits: Array<{ id: string; result: string; audited_at: string }>;
};

export type PrescriptionLineForPrint = {
  id: string;
  line_number: number;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  days: number | null;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
};

export type PrescriptionIntakeForPrint = {
  id: string;
  cycle_id: string;
  prescribed_date: string | null;
  prescriber_name: string | null;
  prescriber_institution: string | null;
  lines: PrescriptionLineForPrint[];
};

export type DeliveryRecordForPrint = {
  id: string;
  channel: string;
  recipient_name: string;
  status: string;
  sent_at: string | null;
};

export type CareReportForPrint = {
  id: string;
  patient_id: string;
  patient_name?: string | null;
  report_type: string;
  status: string;
  content: unknown;
  created_at: string;
  delivery_records: DeliveryRecordForPrint[];
};

export type FirstVisitDocumentHistoryForPrint = {
  id: string;
  action: string;
  document_type: string | null;
  template_name: string | null;
  template_version: string | null;
  storage_location: string | null;
  reason: string | null;
  note: string | null;
  actor_id: string | null;
  created_at: string;
};

export type EmergencyContactForPrint = {
  id: string | null;
  name: string;
  relation: string | null;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  is_primary: boolean;
  is_emergency_contact: boolean;
};

export type FirstVisitDocumentForPrint = {
  id: string;
  case_id: string;
  document_url: string | null;
  delivered_at: string | null;
  delivered_to: string | null;
  created_at: string;
  updated_at: string;
  emergency_contacts: EmergencyContactForPrint[];
  history: FirstVisitDocumentHistoryForPrint[];
};

export type FirstVisitDocumentPrintRow = {
  documentId: string;
  createdAtLabel: string;
  deliveredAtLabel: string;
  deliveredToLabel: string;
  documentUrlLabel: string;
  latestActionLabel: string;
  latestStorageLabel: string;
  latestTemplateLabel: string;
};

export type FirstVisitDocumentPrintContact = {
  contactId: string;
  name: string;
  relationLabel: string;
  organizationLabel: string;
  contactLabel: string;
  priorityLabel: string;
};

export type FirstVisitDocumentPrintSummary = {
  patientName: string;
  rows: FirstVisitDocumentPrintRow[];
  contacts: FirstVisitDocumentPrintContact[];
};

export type FirstVisitPrintReadinessForPrint = {
  overall_status: 'ready' | 'warning' | 'blocked';
  missing_required_count: number;
  warning_count: number;
  template_versions: Array<{
    document_type: string;
    label: string;
    template_name: string | null;
    template_version: string | null;
    effective_from: string | null;
    effective_to: string | null;
  }>;
  checks: Array<{
    key: string;
    label: string;
    completed: boolean;
    severity: 'required' | 'warning';
    description: string;
    action_href: string;
    action_label: string;
  }>;
};

export type FirstVisitPrintReadinessSummary = {
  status: 'ready' | 'warning' | 'blocked';
  label: string;
  message: string;
  blocked: boolean;
  missingRequiredCount: number;
  warningCount: number;
  missingRequiredLabels: string[];
  warningLabels: string[];
  templateLabels: string[];
};

// ─── 日付整形 ────────────────────────────────────────────────────────────────

/** ISO 文字列 → 「2026/6/1」。不正値は「—」 */
export function formatPrintDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ja-JP');
}

/** 対象期間ラベル「2026/6/1 〜 2026/6/28」 */
export function formatPrintPeriod(startIso: string, endIso: string): string {
  return `${formatPrintDate(startIso)} 〜 ${formatPrintDate(endIso)}`;
}

// ─── セットプラン選択 ────────────────────────────────────────────────────────

/**
 * セット指示書の既定プラン選択。
 * 対象期間が最も長いプラン(=訪問サイクル全体を覆う主帳票)を優先し、
 * 同じ長さなら作成が新しいものを選ぶ。施設の当日 1 日分プランより
 * 在宅 28 日分プラン(デモでは田中一郎)が前に出る。
 */
export function pickPrintSetPlan(plans: readonly SetPlanForPrint[]): SetPlanForPrint | null {
  if (plans.length === 0) return null;
  const spanOf = (plan: SetPlanForPrint) =>
    new Date(plan.target_period_end).getTime() - new Date(plan.target_period_start).getTime();
  return plans.reduce((best, candidate) => {
    const bestSpan = spanOf(best);
    const candidateSpan = spanOf(candidate);
    if (candidateSpan > bestSpan) return candidate;
    if (
      candidateSpan === bestSpan &&
      new Date(candidate.created_at).getTime() > new Date(best.created_at).getTime()
    ) {
      return candidate;
    }
    return best;
  });
}

/** プランのサイクルに紐づく処方受付を選ぶ(一致なしは先頭=最新) */
export function pickIntakeForCycle(
  intakes: readonly PrescriptionIntakeForPrint[],
  cycleId: string | null | undefined,
): PrescriptionIntakeForPrint | null {
  if (intakes.length === 0) return null;
  if (cycleId) {
    const matched = intakes.find((intake) => intake.cycle_id === cycleId);
    if (matched) return matched;
  }
  return intakes[0];
}

// ─── 用法 → スロット射影 ────────────────────────────────────────────────────

export type CalendarSlotKey = 'morning' | 'noon' | 'evening' | 'bedtime' | 'prn';

export const CALENDAR_SLOT_LABELS: Record<CalendarSlotKey, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕',
  bedtime: '眠前',
  prn: '頓用',
};

const FIXED_SLOT_ORDER: readonly CalendarSlotKey[] = ['morning', 'noon', 'evening', 'bedtime'];

/**
 * 用法文字列(「朝」「毎食後」「朝夕」「疼痛時」等)を服薬スロットへ射影する。
 * 判定できない用法は空配列(=「—」表示)。
 */
export function deriveCalendarSlots(frequency: string | null | undefined): CalendarSlotKey[] {
  const text = frequency ?? '';
  if (!text) return [];

  const slots = new Set<CalendarSlotKey>();
  if (text.includes('毎食')) {
    slots.add('morning');
    slots.add('noon');
    slots.add('evening');
  }
  if (text.includes('朝')) slots.add('morning');
  if (text.includes('昼')) slots.add('noon');
  if (text.includes('夕')) slots.add('evening');
  if (/眠前|就寝前|寝る前/.test(text)) slots.add('bedtime');
  // 頓用系(「〜時」表現)。「時間」等の誤検知を避けるため代表パターンのみ
  if (/頓用|頓服|疼痛時|発作時|不眠時|便秘時|必要時/.test(text)) slots.add('prn');

  const ordered: CalendarSlotKey[] = FIXED_SLOT_ORDER.filter((slot) => slots.has(slot));
  if (slots.has('prn')) ordered.push('prn');
  return ordered;
}

/** スロット配列 → 「朝・夕」のような表示ラベル(空は「—」) */
export function formatSlotLabel(slots: readonly CalendarSlotKey[]): string {
  if (slots.length === 0) return '—';
  return slots.map((slot) => CALENDAR_SLOT_LABELS[slot]).join('・');
}

// ─── セット指示書 ────────────────────────────────────────────────────────────

export type SetInstructionRow = {
  lineNumber: number;
  drugName: string;
  usageLabel: string;
  slotLabel: string;
  quantityLabel: string;
  note: string | null;
};

export type SetInstructionDocument = {
  patientName: string;
  periodLabel: string;
  setMethodLabel: string;
  packagingLabel: string;
  auditLabel: string;
  specialInstructions: string[];
  notes: string | null;
  rows: SetInstructionRow[];
};

function formatUsageLabel(line: PrescriptionLineForPrint): string {
  const parts = [line.dose, line.frequency].filter(
    (part): part is string => !!part && part.length > 0,
  );
  return parts.length > 0 ? parts.join(' ') : '—';
}

function formatQuantityLabel(line: PrescriptionLineForPrint): string {
  const quantity = line.quantity !== null && line.unit ? `${line.quantity}${line.unit}` : null;
  const days = line.days !== null ? `${line.days}日分` : null;
  if (quantity && days) return `${quantity}(${days})`;
  return quantity ?? days ?? '—';
}

const SET_AUDIT_RESULT_LABELS: Record<string, string> = {
  approved: '監査承認済み',
  partial_approved: '監査一部承認',
  rejected: '監査差戻し',
};

/** セットプラン + 処方明細 → セット指示書の帳票データ */
export function buildSetInstructionDocument(
  plan: SetPlanForPrint | null,
  intake: PrescriptionIntakeForPrint | null,
): SetInstructionDocument | null {
  if (!plan) return null;
  const latestAudit = plan.audits[0] ?? null;
  const packagingLabel =
    plan.packaging_summary_snapshot?.packaging_method_name ??
    plan.packaging_method_ref?.name ??
    '通常(指定なし)';

  return {
    patientName: plan.cycle.case_.patient.name,
    periodLabel: formatPrintPeriod(plan.target_period_start, plan.target_period_end),
    setMethodLabel:
      SET_METHOD_LABELS[plan.set_method as keyof typeof SET_METHOD_LABELS] ?? plan.set_method,
    packagingLabel,
    auditLabel: latestAudit
      ? (SET_AUDIT_RESULT_LABELS[latestAudit.result] ?? latestAudit.result)
      : '監査前',
    specialInstructions: plan.packaging_summary_snapshot?.special_instructions ?? [],
    notes: plan.notes,
    rows: (intake?.lines ?? []).map((line) => ({
      lineNumber: line.line_number,
      drugName: line.drug_name,
      usageLabel: formatUsageLabel(line),
      slotLabel: formatSlotLabel(deriveCalendarSlots(line.frequency)),
      quantityLabel: formatQuantityLabel(line),
      note: line.notes,
    })),
  };
}

// ─── 服薬カレンダー ──────────────────────────────────────────────────────────

export type MedicationCalendarRow = {
  drugName: string;
  usageLabel: string;
  marks: Record<Exclude<CalendarSlotKey, 'prn'>, boolean>;
};

export type MedicationCalendarPrnRow = {
  drugName: string;
  conditionLabel: string;
};

export type MedicationCalendarDocument = {
  patientName: string;
  periodLabel: string;
  rows: MedicationCalendarRow[];
  prnRows: MedicationCalendarPrnRow[];
};

/** 処方明細 → 服薬カレンダー(定時薬の朝/昼/夕/眠前マトリクス + 頓用欄) */
export function buildMedicationCalendarDocument(
  plan: SetPlanForPrint | null,
  intake: PrescriptionIntakeForPrint | null,
): MedicationCalendarDocument | null {
  if (!plan || !intake || intake.lines.length === 0) return null;

  const rows: MedicationCalendarRow[] = [];
  const prnRows: MedicationCalendarPrnRow[] = [];

  for (const line of intake.lines) {
    const slots = deriveCalendarSlots(line.frequency);
    if (slots.includes('prn')) {
      prnRows.push({
        drugName: line.drug_name,
        conditionLabel: line.frequency ?? '頓用',
      });
      continue;
    }
    rows.push({
      drugName: line.drug_name,
      usageLabel: formatUsageLabel(line),
      marks: {
        morning: slots.includes('morning'),
        noon: slots.includes('noon'),
        evening: slots.includes('evening'),
        bedtime: slots.includes('bedtime'),
      },
    });
  }

  return {
    patientName: plan.cycle.case_.patient.name,
    periodLabel: formatPrintPeriod(plan.target_period_start, plan.target_period_end),
    rows,
    prnRows,
  };
}

// ─── 訪問報告書 ──────────────────────────────────────────────────────────────

export type VisitReportItem = { label: string; value: string };

export type VisitReportDocument = {
  reportId: string;
  patientName: string;
  reportTypeLabel: string;
  statusLabel: string;
  reportDateLabel: string;
  items: VisitReportItem[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readStringArray(record: Record<string, unknown> | null, key: string): string[] {
  const value = record?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** 確定度スコア: 確定済み(confirmed/sent)を下書きより優先 */
const REPORT_STATUS_PRIORITY: Record<string, number> = {
  confirmed: 4,
  sent: 3,
  response_waiting: 2,
  failed: 1,
  draft: 0,
};

/** 訪問報告書プレビューに使う報告書を選ぶ(確定済み優先 → 内容の充実度 → 新しさ) */
export function pickVisitReportForPrint(
  reports: readonly CareReportForPrint[],
): CareReportForPrint | null {
  if (reports.length === 0) return null;
  const scoreOf = (report: CareReportForPrint) => {
    const statusScore = (REPORT_STATUS_PRIORITY[report.status] ?? 0) * 10;
    const content = asRecord(report.content);
    const richnessScore =
      (asRecord(content?.['medication_management_summary']) ? 2 : 0) +
      (asRecord(content?.['medication_management']) ? 2 : 0) +
      (asRecord(content?.['residual_status']) ? 1 : 0) +
      (readString(content, 'assessment') ? 1 : 0);
    return statusScore + richnessScore;
  };
  return [...reports].sort((a, b) => {
    const diff = scoreOf(b) - scoreOf(a);
    if (diff !== 0) return diff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  })[0];
}

/** care-report の content(Json)から要約行を防御的に組み立てる */
export function buildVisitReportDocument(
  report: CareReportForPrint | null,
): VisitReportDocument | null {
  if (!report) return null;
  const content = asRecord(report.content);
  const items: VisitReportItem[] = [];

  const management =
    asRecord(content?.['medication_management_summary']) ??
    asRecord(content?.['medication_management']);
  const compliance = readString(management, 'compliance_summary');
  if (compliance) items.push({ label: '服薬状況', value: compliance });
  const selfManagement = readString(management, 'self_management');
  if (selfManagement) items.push({ label: '自己管理', value: selfManagement });

  const residual = asRecord(content?.['residual_status']);
  const residualSummary = readString(residual, 'summary');
  if (residualSummary) items.push({ label: '残薬状況', value: residualSummary });

  const coordination = asRecord(content?.['care_service_coordination']);
  const assistance = readString(coordination, 'medication_assistance');
  if (assistance) items.push({ label: '連携のお願い', value: assistance });

  const assessment = readString(content, 'assessment');
  if (assessment) items.push({ label: '薬学的評価', value: assessment });
  const planText = readString(content, 'plan');
  if (planText) items.push({ label: '今後の計画', value: planText });

  const nextVisit = asRecord(content?.['next_visit_plan']);
  const nextDate = readString(nextVisit, 'date');
  const followups = readStringArray(nextVisit, 'followup_items');
  if (nextDate || followups.length > 0) {
    const datePart = nextDate ? `${formatPrintDate(nextDate)} 予定` : null;
    items.push({
      label: '次回確認',
      value: [datePart, ...followups].filter(Boolean).join(' / '),
    });
  }

  const body = readString(content, 'body');
  if (items.length === 0 && body) items.push({ label: '本文', value: body });

  const contentPatient = asRecord(content?.['patient']);
  const patientName = report.patient_name ?? readString(contentPatient, 'name') ?? '患者名未設定';
  const reportDate = readString(content, 'report_date') ?? report.created_at;

  return {
    reportId: report.id,
    patientName,
    reportTypeLabel: REPORT_TYPE_LABELS[report.report_type] ?? report.report_type,
    statusLabel: REPORT_STATUS_CONFIG[report.status]?.label ?? report.status,
    reportDateLabel: formatPrintDate(reportDate),
    items,
  };
}

// ─── 文書交付控え ────────────────────────────────────────────────────────────

export type DocumentReceiptRow = {
  deliveryId: string;
  documentLabel: string;
  patientName: string;
  recipientName: string;
  channelLabel: string;
  sentAtLabel: string;
  statusLabel: string;
};

/** 報告書の送達記録(delivery_records)を交付控えの行へ平坦化(交付日時降順) */
export function buildDocumentReceiptRows(
  reports: readonly CareReportForPrint[],
): DocumentReceiptRow[] {
  const entries = reports.flatMap((report) => {
    const content = asRecord(report.content);
    const documentLabel =
      readString(content, 'title') ?? REPORT_TYPE_LABELS[report.report_type] ?? report.report_type;
    return report.delivery_records.map((record) => ({
      sentAtValue: record.sent_at ? new Date(record.sent_at).getTime() : 0,
      row: {
        deliveryId: record.id,
        documentLabel,
        patientName: report.patient_name ?? '患者名未設定',
        recipientName: record.recipient_name,
        channelLabel: CHANNEL_LABELS[record.channel] ?? record.channel,
        sentAtLabel: formatPrintDate(record.sent_at),
        statusLabel: REPORT_STATUS_CONFIG[record.status]?.label ?? record.status,
      } satisfies DocumentReceiptRow,
    }));
  });
  return entries.sort((a, b) => b.sentAtValue - a.sentAtValue).map((entry) => entry.row);
}

// ─── 初回訪問文書・契約控え ──────────────────────────────────────────────────

const FIRST_VISIT_DOCUMENT_ACTION_LABELS: Record<string, string> = {
  generated: '作成',
  printed: '印刷',
  recovered: '回収',
  image_saved: '画像保存',
  replaced: '差替え',
  invalidated: '無効化',
};

const FIRST_VISIT_DOCUMENT_STORAGE_LABELS: Record<string, string> = {
  store: '店舗',
  headquarters: '本部',
  patient_home_copy_only: '患者宅控えのみ',
  electronic: '電子保管',
  unknown: '未確認',
};

function pickLatestDocumentHistory(
  histories: readonly FirstVisitDocumentHistoryForPrint[],
): FirstVisitDocumentHistoryForPrint | null {
  if (histories.length === 0) return null;
  return [...histories].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}

function formatTemplateLabel(history: FirstVisitDocumentHistoryForPrint | null): string {
  if (!history?.template_name) return 'テンプレート未記録';
  return [history.template_name, history.template_version].filter(Boolean).join(' ');
}

/** 患者文書スナップショット → 契約・同意控えの帳票データ */
export function buildFirstVisitDocumentPrintSummary(
  patientName: string,
  documents: readonly FirstVisitDocumentForPrint[],
): FirstVisitDocumentPrintSummary {
  const contacts = new Map<string, FirstVisitDocumentPrintContact>();

  for (const document of documents) {
    for (const contact of document.emergency_contacts) {
      const contactId =
        contact.id ?? `${contact.name}-${contact.phone ?? contact.email ?? contact.fax ?? ''}`;
      if (contacts.has(contactId)) continue;
      contacts.set(contactId, {
        contactId,
        name: contact.name,
        relationLabel: contact.relation ?? '連絡先',
        organizationLabel:
          [contact.organization_name, contact.department].filter(Boolean).join(' / ') ||
          '所属未登録',
        contactLabel: contact.phone ?? contact.email ?? contact.fax ?? '連絡先未登録',
        priorityLabel: contact.is_primary
          ? '主連絡先'
          : contact.is_emergency_contact
            ? '緊急連絡先'
            : '連絡先',
      });
    }
  }

  return {
    patientName,
    rows: [...documents]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((document) => {
        const latestHistory = pickLatestDocumentHistory(document.history);
        const latestAction = latestHistory?.action
          ? (FIRST_VISIT_DOCUMENT_ACTION_LABELS[latestHistory.action] ?? latestHistory.action)
          : '履歴未記録';
        const latestStorage = latestHistory?.storage_location
          ? (FIRST_VISIT_DOCUMENT_STORAGE_LABELS[latestHistory.storage_location] ??
            latestHistory.storage_location)
          : '保管未記録';

        return {
          documentId: document.id,
          createdAtLabel: formatPrintDate(document.created_at),
          deliveredAtLabel: formatPrintDate(document.delivered_at),
          deliveredToLabel: document.delivered_to ?? '交付先未記録',
          documentUrlLabel: document.document_url ? '控えあり' : '控え未登録',
          latestActionLabel: latestAction,
          latestStorageLabel: latestStorage,
          latestTemplateLabel: formatTemplateLabel(latestHistory),
        };
      }),
    contacts: [...contacts.values()].sort((a, b) => {
      if (a.priorityLabel === b.priorityLabel) return a.name.localeCompare(b.name, 'ja');
      if (a.priorityLabel === '主連絡先') return -1;
      if (b.priorityLabel === '主連絡先') return 1;
      return a.priorityLabel.localeCompare(b.priorityLabel, 'ja');
    }),
  };
}

export function summarizeFirstVisitPrintReadiness(
  readiness: FirstVisitPrintReadinessForPrint | null | undefined,
): FirstVisitPrintReadinessSummary {
  if (!readiness) {
    return {
      status: 'blocked',
      label: '印刷前チェック未取得',
      message: '患者文書の印刷前チェックを取得できませんでした。再読み込みしてください。',
      blocked: true,
      missingRequiredCount: 1,
      warningCount: 0,
      missingRequiredLabels: ['印刷前チェック'],
      warningLabels: [],
      templateLabels: [],
    };
  }

  const missingRequiredLabels = readiness.checks
    .filter((check) => check.severity === 'required' && !check.completed)
    .map((check) => check.label);
  const warningLabels = readiness.checks
    .filter((check) => check.severity === 'warning' && !check.completed)
    .map((check) => check.label);
  const templateLabels = readiness.template_versions.map((template) =>
    [template.label, template.template_name, template.template_version].filter(Boolean).join(' '),
  );
  const blocked = readiness.overall_status === 'blocked' || readiness.missing_required_count > 0;

  if (blocked) {
    const reason =
      missingRequiredLabels.length > 0
        ? `不足: ${missingRequiredLabels.join('、')}`
        : '必須項目に不足があります。';
    return {
      status: 'blocked',
      label: '不足あり',
      message: `印刷前チェックで必須項目が未完了です。${reason}`,
      blocked: true,
      missingRequiredCount: readiness.missing_required_count,
      warningCount: readiness.warning_count,
      missingRequiredLabels,
      warningLabels,
      templateLabels,
    };
  }

  if (readiness.overall_status === 'warning' || readiness.warning_count > 0) {
    const reason =
      warningLabels.length > 0 ? `確認: ${warningLabels.join('、')}` : '確認推奨項目があります。';
    return {
      status: 'warning',
      label: '確認あり',
      message: `印刷は可能ですが、${reason}`,
      blocked: false,
      missingRequiredCount: readiness.missing_required_count,
      warningCount: readiness.warning_count,
      missingRequiredLabels,
      warningLabels,
      templateLabels,
    };
  }

  return {
    status: 'ready',
    label: '印刷準備OK',
    message: '必須情報とテンプレート版の確認が完了しています。',
    blocked: false,
    missingRequiredCount: readiness.missing_required_count,
    warningCount: readiness.warning_count,
    missingRequiredLabels,
    warningLabels,
    templateLabels,
  };
}

// ─── 薬袋ラベル ──────────────────────────────────────────────────────────────

export type MedicationLabelCard = {
  lineId: string;
  patientName: string;
  drugName: string;
  usageLabel: string;
  slotLabel: string;
  quantityLabel: string;
  note: string | null;
};

/** 処方明細 → 薬袋ラベル(1 明細 = 1 ラベル) */
export function buildMedicationLabelCards(
  plan: SetPlanForPrint | null,
  intake: PrescriptionIntakeForPrint | null,
): MedicationLabelCard[] {
  if (!plan || !intake) return [];
  const patientName = plan.cycle.case_.patient.name;
  return intake.lines.map((line) => ({
    lineId: line.id,
    patientName,
    drugName: line.drug_name,
    usageLabel: formatUsageLabel(line),
    slotLabel: formatSlotLabel(deriveCalendarSlots(line.frequency)),
    quantityLabel: formatQuantityLabel(line),
    note: line.notes,
  }));
}
