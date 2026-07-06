import { buildPatientHref } from '@/lib/patient/navigation';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';
import { getConferenceTypeLabel } from '@/lib/visits/visit-workflow-projection';
import {
  TIMELINE_SOURCES,
  type TimelineProjectCtx,
  type TimelineSourceResults,
} from '@/server/services/patient-detail-timeline-registry';

export const PRESCRIPTION_SOURCE_LABELS: Record<string, string> = {
  paper: '紙処方箋',
  fax: 'FAX',
  e_prescription: '電子処方箋',
  facility_batch: '施設一括',
  refill: 'リフィル',
  qr_scan: 'QR取込',
};

export const MANAGEMENT_PLAN_STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  approved: '承認済み',
};

export const SELF_REPORT_STATUS_LABELS: Record<string, string> = {
  submitted: '未対応',
  triaged: 'トリアージ済み',
  converted_to_task: 'タスク化済み',
  resolved: '解決済み',
  dismissed: '対応不要',
};

export const CARRY_TYPE_LABELS: Record<string, string> = {
  carry: '持参',
  facility_deposit: '施設預け',
  deferred: '後送',
};

export const VISIT_TYPE_LABELS: Record<string, string> = {
  initial: '初回訪問',
  regular: '定期訪問',
  temporary: '臨時訪問',
  revisit: '再訪問',
  delivery_only: '配薬のみ',
  emergency: '緊急訪問',
  physician_co_visit: '同行訪問',
};

/** Uniform timeline event shape emitted by every source adapter + op_history. */
export type TimelineEvent = {
  id: string;
  event_type: string;
  category: string;
  occurred_at: Date;
  title: string;
  summary: string | null;
  href: string;
  action_label: string | null;
  status: string;
  status_label: string;
  actor_name: string | null;
  metadata: string[];
};

/** Precomputed per-patient href builders shared by source adapters + op_history. */
export type TimelineHrefBundle = {
  patientDetailHref: string;
  patientMedicationHref: string;
  patientDocumentsHref: string;
  patientManagementPlanHref: string;
  patientMcsHref: string;
  patientCollaborationHref: string;
  patientShareHref: string;
  patientBillingCandidatesHref: string;
  patientConferencesHref: string;
};

function buildTimelineQueryHref(path: string, params: Array<[string, string]>) {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

export function buildPatientBillingCandidatesHref(
  patientId: string,
  options: { billingMonth?: string } = {},
) {
  const params: Array<[string, string]> = [];
  if (options.billingMonth) {
    params.push(['billing_month', options.billingMonth]);
  }
  params.push(['patient_id', patientId]);
  return buildTimelineQueryHref('/billing/candidates', params);
}

export function buildPatientConferencesHref(patientId: string) {
  return buildTimelineQueryHref('/conferences', [['patient_id', patientId]]);
}

export function buildTimelineHrefBundle(patientId: string): TimelineHrefBundle {
  return {
    patientDetailHref: buildPatientHref(patientId),
    patientMedicationHref: buildPatientHref(patientId, '#card-prescription-section'),
    patientDocumentsHref: buildPatientHref(patientId, '#patient-documents'),
    patientManagementPlanHref: buildPatientHref(patientId, '/management-plan'),
    patientMcsHref: buildPatientHref(patientId, '/mcs'),
    patientCollaborationHref: buildPatientHref(patientId, '/collaboration'),
    patientShareHref: buildPatientHref(patientId, '/share'),
    patientBillingCandidatesHref: buildPatientBillingCandidatesHref(patientId),
    patientConferencesHref: buildPatientConferencesHref(patientId),
  };
}

export type VisitScheduleTimelineSource = {
  id: string;
  visit_type: string;
  scheduled_date: Date | null;
  schedule_status: string;
  priority: string | null;
  pharmacist_id: string;
  confirmed_at: Date | null;
  route_order: number | null;
  created_at: Date;
  updated_at: Date | null;
  visit_record: { id: string; outcome_status: string } | null;
};

export type VisitRecordTimelineSource = {
  id: string;
  pharmacist_id: string;
  visit_date: Date | null;
  outcome_status: string;
  next_visit_suggestion_date: Date | null;
  created_at: Date;
};

export type CareReportTimelineSource = {
  id: string;
  report_type: string;
  status: string;
  created_by: string;
  created_at: Date;
  delivery_records: Array<{
    id: string;
    channel: string;
    recipient_name: string | null;
    status: string;
    sent_at: Date | null;
    confirmed_at: Date | null;
    created_at: Date;
  }>;
};

export type CommunicationTimelineSource = {
  id: string;
  event_type: string;
  channel: string;
  direction: string;
  occurred_at: Date;
};

export type PatientMcsMessageTimelineSource = {
  id: string;
  author_name: string;
  author_role: string | null;
  author_organization: string | null;
  posted_at: Date | null;
  posted_at_label: string;
  reaction_count: number;
  reply_count: number;
  created_at: Date;
};

export type PartnerVisitRecordTimelineSource = {
  id: string;
  status: string;
  pharmacist_name: string | null;
  visit_at: Date;
  submitted_at: Date | null;
  confirmed_at: Date | null;
  updated_at: Date;
  owner_partner_pharmacy: {
    name: string;
  };
};

export type OperationalTaskTimelineSource = {
  id: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: Date | null;
  sla_due_at: Date | null;
  completed_at: Date | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ResidualMedicationTimelineSource = {
  id: string;
  visit_record_id: string;
  is_reduction_target: boolean;
  is_prohibited_reduction: boolean;
  created_at: Date;
  visit_record: {
    id: string;
    visit_date: Date;
    outcome_status: string;
    created_at: Date;
  };
};

export type SelfReportTimelineSource = {
  id: string;
  subject: string | null;
  category: string | null;
  content: string | null;
  relation: string | null;
  status: string;
  reported_by_name: string | null;
  requested_callback: boolean;
  preferred_contact_time: string | null;
  created_at: Date;
};

export type ExternalShareTimelineSource = {
  id: string;
  granted_to_name: string | null;
  expires_at: Date | null;
  accessed_at: Date | null;
  created_at: Date;
};

export type InquiryTimelineSource = {
  id: string;
  result: string | null;
  inquired_at: Date | null;
  resolved_at: Date | null;
  created_at: Date;
  line: { intake: { id: string } | null } | null;
};

export type PrescriptionIntakeTimelineSource = {
  id: string;
  source_type: string;
  prescribed_date: Date | null;
  created_at: Date;
  cycle: { overall_status: string };
};

export type DispenseResultTimelineSource = {
  id: string;
  dispensed_by: string;
  dispensed_at: Date;
  task: { cycle: { overall_status: string } | null };
  line: { intake: { id: string } };
};

export type ManagementPlanTimelineSource = {
  id: string;
  status: string;
  title: string | null;
  effective_from: Date | null;
  next_review_date: Date | null;
  created_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
};

export type FirstVisitDocumentTimelineSource = {
  id: string;
  delivered_at: Date | null;
  created_at: Date;
};

export type ConferenceNoteTimelineSource = {
  id: string;
  note_type: string;
  title: string | null;
  conference_date: Date;
  follow_up_date: Date | null;
  follow_up_completed: boolean;
  generated_report_id: string | null;
  action_items: unknown;
};

export type BillingCandidateTimelineSource = {
  id: string;
  billing_month: Date;
  billing_code: string | null;
  billing_name: string | null;
  points: number | null;
  status: string;
  exclusion_reason: string | null;
  updated_at: Date;
};

type OperationHistoryTimelineSource = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  actor_id: string;
  changes: unknown;
  created_at: Date;
};

export type BuildPatientTimelineEventsInput = {
  patientId: string;
  actorNameMap: ReadonlyMap<string, string>;
  visitSchedules: readonly VisitScheduleTimelineSource[];
  visitRecords: readonly VisitRecordTimelineSource[];
  careReports: readonly CareReportTimelineSource[];
  communicationEvents: readonly CommunicationTimelineSource[];
  patientMcsMessages: readonly PatientMcsMessageTimelineSource[];
  partnerVisitRecords: readonly PartnerVisitRecordTimelineSource[];
  operationalTasks: readonly OperationalTaskTimelineSource[];
  residualMedications: readonly ResidualMedicationTimelineSource[];
  selfReports: readonly SelfReportTimelineSource[];
  externalShares: readonly ExternalShareTimelineSource[];
  inquiryRecords: readonly InquiryTimelineSource[];
  prescriptionIntakes: readonly PrescriptionIntakeTimelineSource[];
  dispenseResults: readonly DispenseResultTimelineSource[];
  managementPlans: readonly ManagementPlanTimelineSource[];
  firstVisitDocuments: readonly FirstVisitDocumentTimelineSource[];
  conferenceNotes: readonly ConferenceNoteTimelineSource[];
  billingCandidates: readonly BillingCandidateTimelineSource[];
  operationHistory: readonly OperationHistoryTimelineSource[];
};

const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat('ja-JP-u-ca-gregory', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatTokyoDateParts(value: Date) {
  const parts = Object.fromEntries(
    TOKYO_DATE_FORMATTER.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return {
    year: parts.year ?? '0000',
    month: parts.month ?? '00',
    day: parts.day ?? '00',
  };
}

export function formatTimelineDate(value: Date | null | undefined) {
  if (!value) return null;
  const { year, month, day } = formatTokyoDateParts(value);
  return `${year}/${month}/${day}`;
}

export function formatTokyoMonthStart(value: Date) {
  const { year, month } = formatTokyoDateParts(value);
  return `${year}-${month}-01`;
}

export function compactTimelineValues(values: Array<string | null | undefined | false>) {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

export function previewTimelineText(value: string | null | undefined, maxLength = 96) {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const OPERATION_ACTION_LABELS: Record<string, { title: string; statusLabel: string }> = {
  'first_visit_document.generated': { title: '初回文書を生成', statusLabel: '生成' },
  'first_visit_document.printed': { title: '初回文書を印刷', statusLabel: '印刷' },
  'first_visit_document.recovered': { title: '初回文書を回収', statusLabel: '回収' },
  'first_visit_document.image_saved': { title: '初回文書画像を保存', statusLabel: '画像保存' },
  'first_visit_document.replaced': { title: '初回文書を差し替え', statusLabel: '差し替え' },
  'first_visit_document.invalidated': { title: '初回文書を無効化', statusLabel: '無効化' },
  billing_collection_updated: { title: '集金情報を更新', statusLabel: '集金更新' },
  billing_payment_profile_updated: { title: '支払設定を更新', statusLabel: '支払設定' },
  patient_contacts_updated: { title: '連絡先を更新', statusLabel: '連絡先更新' },
  patient_mcs_profile_updated: { title: 'MCS連携状態を更新', statusLabel: 'MCS更新' },
  patient_mcs_check_log_created: { title: 'MCS確認ログを登録', statusLabel: 'MCS確認' },
  'conference_note.created': { title: 'カンファレンス記録を登録', statusLabel: '会議登録' },
  'conference_note.updated': { title: 'カンファレンス記録を更新', statusLabel: '会議更新' },
  'conference_note.report_generated': {
    title: 'カンファレンス報告書を作成',
    statusLabel: '報告書作成',
  },
  prescription_original_management_updated: {
    title: '処方せん原本管理を更新',
    statusLabel: '原本管理',
  },
  prescription_original_document_saved: {
    title: '処方せん画像/PDFを保存',
    statusLabel: '画像保存',
  },
};

const BILLING_EXPORT_LABELS: Record<string, { title: string; statusLabel: string }> = {
  billing_receipt: { title: '領収証PDFを出力', statusLabel: '領収証PDF' },
  billing_invoice: { title: '請求書PDFを出力', statusLabel: '請求書PDF' },
};

const PATIENT_EXPORT_LABELS: Record<string, { title: string; statusLabel: string }> = {
  medication_history: { title: '薬歴PDFを出力', statusLabel: '薬歴PDF' },
  medication_calendar: { title: '服薬カレンダーPDFを出力', statusLabel: '服薬カレンダー' },
  visit_record_list: { title: '訪問記録PDFを出力', statusLabel: '訪問記録PDF' },
  prescription_history: { title: '処方履歴CSVを出力', statusLabel: '処方履歴CSV' },
};

const FIRST_VISIT_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  contract: '契約書',
  important_matters: '重要事項説明書',
  consent: '同意書',
  privacy_consent: '個人情報同意書',
  first_visit_document: '初回訪問文書',
  other: 'その他',
};

const FIRST_VISIT_DOCUMENT_STORAGE_LABELS: Record<string, string> = {
  store: '店舗',
  headquarters: '本部',
  patient_home_copy_only: '患者宅控えのみ',
  electronic: '電子保管',
  unknown: '未確認',
};

const BILLING_COLLECTION_STATUS_LABELS: Record<string, string> = {
  unbilled: '未請求',
  billed: '請求済',
  scheduled: '集金予定',
  collected: '集金済',
  partial: '一部入金',
  unpaid: '未収',
  dunning: '督促中',
  waived: '免除・公費',
  refunded: '返金あり',
  offset: '相殺済',
};

const BILLING_PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: '現金',
  bank_transfer: '振込',
  bank_debit: '口座振替',
  credit_card: 'クレカ',
  facility_billing: '施設請求',
  corporate_billing: '法人請求',
  other: 'その他',
};

const BILLING_RECEIPT_ISSUE_LABELS: Record<string, string> = {
  paper: '紙',
  pdf: 'PDF',
  none: '不要',
};

const BILLING_DOCUMENT_ISSUE_STATUS_LABELS: Record<string, string> = {
  not_required: '不要',
  not_issued: '未発行',
  issued: '発行済み',
};

const MCS_LINKED_STATUS_LABELS: Record<string, string> = {
  linked: 'あり',
  unlinked: 'なし',
  unknown: '不明',
};

const MCS_PARTICIPATION_STATUS_LABELS: Record<string, string> = {
  invited: '招待済',
  joined: '参加済',
  not_joined: '未参加',
  unknown: '不明',
};

const MCS_CHECK_LOG_CATEGORY_LABELS: Record<string, string> = {
  report: '報告確認',
  consultation: '相談確認',
  instruction_check: '指示確認',
  photo_review: '写真確認',
  urgent: '緊急確認',
  other: 'その他',
};

const CONFERENCE_REPORT_TYPE_LABELS: Record<string, string> = {
  physician_report: '医師向け',
  care_manager_report: 'ケアマネ向け',
  facility_handoff: '施設申し送り',
  nurse_share: '訪看共有',
  family_share: '家族共有',
  internal_record: '薬局内記録',
};

const PRESCRIPTION_RECONCILIATION_LABELS: Record<string, string> = {
  not_checked: '未照合',
  matched: '一致',
  discrepancy: '差異あり',
};

const PRESCRIPTION_STORAGE_LABELS: Record<string, string> = {
  not_stored: '未保管',
  store: '店舗保管',
  headquarters: '本部保管',
  electronic: '電子保管',
  patient_copy_only: '患者控えのみ',
};

const E_PRESCRIPTION_ACQUIRED_LABELS: Record<string, string> = {
  not_applicable: '対象外',
  pending: '取得待ち',
  acquired: '取得済み',
};

const DISPENSING_RESULT_REGISTRATION_LABELS: Record<string, string> = {
  not_applicable: '対象外',
  pending: '登録待ち',
  registered: '登録済み',
};

function labelOf(labels: Record<string, string>, value: unknown) {
  const key = readString(value);
  return key ? (labels[key] ?? key) : null;
}

function formatAuditDate(value: unknown) {
  const raw = readString(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return formatTimelineDate(date);
}

function readFirstVisitDocumentAction(item: OperationHistoryTimelineSource) {
  if (item.target_type !== 'first_visit_document') return null;
  if (!item.action.startsWith('first_visit_document.')) return null;
  const changes = isRecord(item.changes) ? item.changes : {};
  const documentAction = isRecord(changes.document_action) ? changes.document_action : {};
  const action =
    readString(documentAction.action) ?? item.action.replace('first_visit_document.', '');
  const documentType = readString(documentAction.document_type);
  const storageLocation = readString(documentAction.storage_location);

  return {
    action,
    documentType,
    documentTypeLabel: documentType
      ? (FIRST_VISIT_DOCUMENT_TYPE_LABELS[documentType] ?? documentType)
      : '初回訪問文書',
    templateName: readString(documentAction.template_name),
    templateVersion: readString(documentAction.template_version),
    storageLabel: storageLocation
      ? (FIRST_VISIT_DOCUMENT_STORAGE_LABELS[storageLocation] ?? storageLocation)
      : null,
    reason: readString(documentAction.reason),
    note: readString(documentAction.note),
    actorId: item.actor_id,
    occurredAt: item.created_at,
  };
}

export type FirstVisitDocumentAction = NonNullable<ReturnType<typeof readFirstVisitDocumentAction>>;

export function latestFirstVisitDocumentActionByDocumentId(
  operationHistory: readonly OperationHistoryTimelineSource[],
) {
  const byDocumentId = new Map<
    string,
    NonNullable<ReturnType<typeof readFirstVisitDocumentAction>>
  >();
  for (const item of operationHistory) {
    const action = readFirstVisitDocumentAction(item);
    if (!action) continue;
    const current = byDocumentId.get(item.target_id);
    if (!current || action.occurredAt.getTime() > current.occurredAt.getTime()) {
      byDocumentId.set(item.target_id, action);
    }
  }
  return byDocumentId;
}

function buildOperationHistorySummary(item: OperationHistoryTimelineSource) {
  const changes = isRecord(item.changes) ? item.changes : {};
  if (item.target_type === 'first_visit_document') {
    return '初回訪問文書の操作履歴が記録されました。内容は共有・文書で確認してください。';
  }
  if (item.target_type === 'prescription_intake') {
    return '処方せん原本または処方関連文書の操作履歴が記録されました。内容は処方詳細で確認してください。';
  }
  const documentAction = isRecord(changes.document_action) ? changes.document_action : {};
  const collection = isRecord(changes.collection) ? changes.collection : {};
  const conferenceNote = isRecord(changes.conference_note) ? changes.conference_note : {};
  const exportFilters = isRecord(changes.filters) ? changes.filters : {};
  const receiptNumber = readString(collection.receipt_number);
  const exchangeNumber = readString(changes.e_prescription_exchange_number);
  const documentUrlType = readString(changes.document_url_type);
  const documentUrlTypeLabel =
    documentUrlType === 'internal_file'
      ? 'PH-OSファイル'
      : documentUrlType === 'external_url'
        ? '外部URL'
        : documentUrlType
          ? '相対URL'
          : null;
  const exportFormat = readString(changes.format)?.toUpperCase();
  const exportRecordCount =
    typeof changes.record_count === 'number' ? `${changes.record_count}件` : null;
  const exportMonth = readString(exportFilters.month);
  const exportDateFrom = readString(exportFilters.date_from);
  const exportDateTo = readString(exportFilters.date_to);
  const exportPeriod =
    exportDateFrom || exportDateTo
      ? `期間 ${exportDateFrom ?? '未指定'} - ${exportDateTo ?? '未指定'}`
      : null;
  const billedAmount =
    typeof collection.billed_amount === 'number'
      ? `請求 ${collection.billed_amount.toLocaleString('ja-JP')}円`
      : null;
  const collectedAmount =
    typeof collection.collected_amount === 'number'
      ? `入金 ${collection.collected_amount.toLocaleString('ja-JP')}円`
      : null;
  const unpaidAmount =
    typeof collection.unpaid_amount === 'number'
      ? `未収 ${collection.unpaid_amount.toLocaleString('ja-JP')}円`
      : null;
  const contactCount =
    typeof changes.contact_count === 'number' ? `連絡先 ${changes.contact_count}件` : null;

  return (
    compactTimelineValues([
      readString(documentAction.document_type)
        ? (FIRST_VISIT_DOCUMENT_TYPE_LABELS[readString(documentAction.document_type) ?? ''] ??
          readString(documentAction.document_type))
        : null,
      readString(documentAction.template_name),
      readString(documentAction.template_version)
        ? `版 ${readString(documentAction.template_version)}`
        : null,
      readString(documentAction.storage_location)
        ? (FIRST_VISIT_DOCUMENT_STORAGE_LABELS[readString(documentAction.storage_location) ?? ''] ??
          readString(documentAction.storage_location))
        : null,
      readString(documentAction.reason),
      readString(changes.payer_name) ? `支払者 ${readString(changes.payer_name)}` : null,
      labelOf(BILLING_PAYMENT_METHOD_LABELS, changes.payment_method)
        ? `方法 ${labelOf(BILLING_PAYMENT_METHOD_LABELS, changes.payment_method)}`
        : null,
      labelOf(BILLING_RECEIPT_ISSUE_LABELS, changes.receipt_issue)
        ? `領収証 ${labelOf(BILLING_RECEIPT_ISSUE_LABELS, changes.receipt_issue)}`
        : null,
      labelOf(BILLING_COLLECTION_STATUS_LABELS, collection.status)
        ? `状態 ${labelOf(BILLING_COLLECTION_STATUS_LABELS, collection.status)}`
        : null,
      billedAmount,
      collectedAmount,
      unpaidAmount,
      formatAuditDate(collection.collected_at)
        ? `入金日 ${formatAuditDate(collection.collected_at)}`
        : null,
      labelOf(BILLING_PAYMENT_METHOD_LABELS, collection.payment_method)
        ? `入金方法 ${labelOf(BILLING_PAYMENT_METHOD_LABELS, collection.payment_method)}`
        : null,
      receiptNumber ? `領収証 ${receiptNumber}` : null,
      labelOf(BILLING_DOCUMENT_ISSUE_STATUS_LABELS, collection.receipt_issue_status)
        ? `領収証状態 ${labelOf(BILLING_DOCUMENT_ISSUE_STATUS_LABELS, collection.receipt_issue_status)}`
        : null,
      labelOf(BILLING_DOCUMENT_ISSUE_STATUS_LABELS, collection.invoice_issue_status)
        ? `請求書状態 ${labelOf(BILLING_DOCUMENT_ISSUE_STATUS_LABELS, collection.invoice_issue_status)}`
        : null,
      readString(collection.payer_name) ? `支払者 ${readString(collection.payer_name)}` : null,
      previewTimelineText(readString(collection.unpaid_reason), 40)
        ? `未収理由 ${previewTimelineText(readString(collection.unpaid_reason), 40)}`
        : null,
      contactCount,
      labelOf(MCS_LINKED_STATUS_LABELS, changes.linked_status)
        ? `MCS ${labelOf(MCS_LINKED_STATUS_LABELS, changes.linked_status)}`
        : null,
      labelOf(MCS_PARTICIPATION_STATUS_LABELS, changes.participation_status)
        ? `参加 ${labelOf(MCS_PARTICIPATION_STATUS_LABELS, changes.participation_status)}`
        : null,
      labelOf(MCS_CHECK_LOG_CATEGORY_LABELS, changes.content_type),
      previewTimelineText(readString(changes.summary), 64),
      readString(changes.next_action) ? `次 ${readString(changes.next_action)}` : null,
      labelOf(PRESCRIPTION_RECONCILIATION_LABELS, changes.reconciliation_result)
        ? `照合 ${labelOf(PRESCRIPTION_RECONCILIATION_LABELS, changes.reconciliation_result)}`
        : null,
      labelOf(PRESCRIPTION_STORAGE_LABELS, changes.storage_location)
        ? `保管 ${labelOf(PRESCRIPTION_STORAGE_LABELS, changes.storage_location)}`
        : null,
      labelOf(E_PRESCRIPTION_ACQUIRED_LABELS, changes.e_prescription_acquired_status)
        ? `電子処方箋 ${labelOf(E_PRESCRIPTION_ACQUIRED_LABELS, changes.e_prescription_acquired_status)}`
        : null,
      exchangeNumber ? `引換番号 ${exchangeNumber}` : null,
      labelOf(DISPENSING_RESULT_REGISTRATION_LABELS, changes.dispensing_result_registration)
        ? `調剤結果 ${labelOf(DISPENSING_RESULT_REGISTRATION_LABELS, changes.dispensing_result_registration)}`
        : null,
      readString(changes.file_id) ? `ファイル ${readString(changes.file_id)}` : null,
      documentUrlTypeLabel ? `保存先 ${documentUrlTypeLabel}` : null,
      readString(conferenceNote.note_type)
        ? getConferenceTypeLabel(readString(conferenceNote.note_type) ?? '')
        : null,
      labelOf(CONFERENCE_REPORT_TYPE_LABELS, conferenceNote.report_type)
        ? `報告用途 ${labelOf(CONFERENCE_REPORT_TYPE_LABELS, conferenceNote.report_type)}`
        : null,
      formatAuditDate(conferenceNote.follow_up_date)
        ? `フォロー期限 ${formatAuditDate(conferenceNote.follow_up_date)}`
        : null,
      typeof conferenceNote.follow_up_completed === 'boolean'
        ? `フォロー ${conferenceNote.follow_up_completed ? '完了' : '未完了'}`
        : null,
      typeof conferenceNote.action_item_count === 'number'
        ? `薬局タスク ${conferenceNote.action_item_count}件`
        : null,
      Array.isArray(conferenceNote.report_draft_ids)
        ? `報告ドラフト ${conferenceNote.report_draft_ids.length}件`
        : null,
      typeof conferenceNote.queued_recipient_count === 'number'
        ? `送付下書き ${conferenceNote.queued_recipient_count}件`
        : null,
      readString(conferenceNote.billing_code)
        ? `算定 ${readString(conferenceNote.billing_code)}`
        : null,
      exportFormat,
      exportRecordCount,
      exportMonth ? `対象月 ${exportMonth}` : null,
      exportPeriod,
    ]).join(' / ') || null
  );
}

function getOperationHistoryCategory(item: OperationHistoryTimelineSource) {
  if (item.action.startsWith('billing_') || item.target_type.startsWith('billing_')) {
    return 'billing';
  }
  if (item.action.startsWith('prescription_')) return 'prescription';
  if (item.target_type === 'prescription_history') return 'prescription';
  if (item.target_type === 'visit_record_list') return 'visit';
  if (item.action === 'patient_contacts_updated') return 'communication';
  if (item.action.startsWith('patient_mcs_')) return 'communication';
  if (item.action.startsWith('conference_note.')) return 'communication';
  return 'document';
}

function getOperationHistoryLabel(item: OperationHistoryTimelineSource) {
  if (item.action === 'export') {
    return (
      BILLING_EXPORT_LABELS[item.target_type] ?? PATIENT_EXPORT_LABELS[item.target_type] ?? null
    );
  }
  return OPERATION_ACTION_LABELS[item.action] ?? null;
}

/**
 * operation_history projection.
 *
 * Stays OUT of the source-adapter registry (load-bearing): op_history is fetched
 * inline with unguarded-throw semantics outside the settled pool. Only its
 * projection lives here, mirroring an adapter's `toEvents`.
 */
export function buildOperationHistoryEvents(
  operationHistory: readonly OperationHistoryTimelineSource[],
  ctx: TimelineProjectCtx,
): TimelineEvent[] {
  const { actorNameMap, hrefs } = ctx;
  return operationHistory.map((item) => {
    const meta = getOperationHistoryLabel(item) ?? {
      title: '患者操作履歴を記録',
      statusLabel: item.action,
    };
    const isBilling = item.action.startsWith('billing_') || item.target_type.startsWith('billing_');
    const isPrescription = item.action.startsWith('prescription_');
    const isMcs = item.action.startsWith('patient_mcs_');
    const isConference = item.action.startsWith('conference_note.');
    const isFirstVisitDocument = item.target_type === 'first_visit_document';

    return {
      id: `operation_history:${item.id}`,
      event_type: 'operation_history',
      category: getOperationHistoryCategory(item),
      occurred_at: item.created_at,
      title: meta.title,
      summary: buildOperationHistorySummary(item),
      href: isBilling
        ? hrefs.patientBillingCandidatesHref
        : isPrescription
          ? buildPrescriptionHref(item.target_id)
          : isMcs
            ? hrefs.patientMcsHref
            : isConference
              ? hrefs.patientConferencesHref
              : isFirstVisitDocument
                ? hrefs.patientDocumentsHref
                : hrefs.patientDetailHref,
      action_label: isBilling
        ? '請求を開く'
        : isPrescription
          ? '処方受付を開く'
          : isMcs
            ? 'MCS連携を開く'
            : isConference
              ? '会議を開く'
              : isFirstVisitDocument
                ? '文書状態を開く'
                : '患者詳細を開く',
      status: item.action,
      status_label: meta.statusLabel,
      actor_name: actorNameMap.get(item.actor_id) ?? null,
      metadata: compactTimelineValues([item.target_type, item.target_id]),
    };
  });
}

export function buildPatientTimelineEvents(
  input: BuildPatientTimelineEventsInput,
): TimelineEvent[] {
  const {
    patientId,
    actorNameMap,
    visitSchedules,
    visitRecords,
    careReports,
    communicationEvents,
    patientMcsMessages,
    partnerVisitRecords,
    operationalTasks,
    residualMedications,
    selfReports,
    externalShares,
    inquiryRecords,
    prescriptionIntakes,
    dispenseResults,
    managementPlans,
    firstVisitDocuments,
    conferenceNotes,
    billingCandidates,
    operationHistory,
  } = input;
  const projectCtx: TimelineProjectCtx = {
    patientId,
    actorNameMap,
    firstVisitDocumentActions: latestFirstVisitDocumentActionByDocumentId(operationHistory),
    hrefs: buildTimelineHrefBundle(patientId),
  };
  const sourceResults: TimelineSourceResults = {
    visitSchedules,
    visitRecords,
    careReports,
    communicationEvents,
    patientMcsMessages,
    partnerVisitRecords,
    operationalTasks,
    residualMedications,
    selfReports,
    externalShares,
    inquiryRecords,
    prescriptionIntakes,
    dispenseResults,
    managementPlans,
    firstVisitDocuments,
    conferenceNotes,
    billingCandidates,
  };

  return [
    ...TIMELINE_SOURCES.flatMap((source) =>
      source.toEvents(sourceResults[source.key] as never, projectCtx),
    ),
    ...buildOperationHistoryEvents(operationHistory, projectCtx),
  ]
    .sort(
      (left, right) =>
        right.occurred_at.getTime() - left.occurred_at.getTime() || right.id.localeCompare(left.id),
    )
    .slice(0, 40);
}
