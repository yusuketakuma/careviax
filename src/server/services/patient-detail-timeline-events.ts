import { format } from 'date-fns';
import {
  CHANNEL_LABELS,
  PRIORITY_LABELS,
  REPORT_STATUS_CONFIG,
  REPORT_TYPE_LABELS,
  SCHEDULE_STATUS_LABELS,
  VISIT_OUTCOME_LABELS,
} from '@/lib/constants/status-labels';
import {
  getInquiryPresentationBadges,
  getInquiryPrimaryDetail,
} from '@/lib/inquiries/presentation';
import { buildPatientHref } from '@/lib/patient/navigation';
import { CYCLE_STATUS_LABELS } from '@/lib/prescription/cycle-workspace';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildVisitHref, buildVisitRecordHref } from '@/lib/visits/navigation';
import { getConferenceTypeLabel } from '@/lib/visits/visit-workflow-projection';

const PRESCRIPTION_SOURCE_LABELS: Record<string, string> = {
  paper: '紙処方箋',
  fax: 'FAX',
  e_prescription: '電子処方箋',
  facility_batch: '施設一括',
  refill: 'リフィル',
  qr_scan: 'QR取込',
};

const MANAGEMENT_PLAN_STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  approved: '承認済み',
};

const SELF_REPORT_STATUS_LABELS: Record<string, string> = {
  submitted: '未対応',
  triaged: 'トリアージ済み',
  converted_to_task: 'タスク化済み',
  resolved: '解決済み',
  dismissed: '対応不要',
};

const CARRY_TYPE_LABELS: Record<string, string> = {
  carry: '持参',
  facility_deposit: '施設預け',
  deferred: '後送',
};

const VISIT_TYPE_LABELS: Record<string, string> = {
  initial: '初回訪問',
  regular: '定期訪問',
  temporary: '臨時訪問',
  revisit: '再訪問',
  delivery_only: '配薬のみ',
  emergency: '緊急訪問',
  physician_co_visit: '同行訪問',
};

type VisitScheduleTimelineSource = {
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

type VisitRecordTimelineSource = {
  id: string;
  pharmacist_id: string;
  visit_date: Date | null;
  outcome_status: string;
  next_visit_suggestion_date: Date | null;
  cancellation_reason: string | null;
  postpone_reason: string | null;
  revisit_reason: string | null;
  created_at: Date;
};

type CareReportTimelineSource = {
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

type CommunicationTimelineSource = {
  id: string;
  event_type: string;
  channel: string;
  direction: string;
  subject: string | null;
  counterpart_name: string | null;
  occurred_at: Date;
};

type SelfReportTimelineSource = {
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

type ExternalShareTimelineSource = {
  id: string;
  granted_to_name: string | null;
  expires_at: Date | null;
  accessed_at: Date | null;
  created_at: Date;
};

type InquiryTimelineSource = {
  id: string;
  reason: string | null;
  inquiry_to_physician: string | null;
  inquiry_content: string | null;
  result: string | null;
  proposal_origin: string | null;
  residual_adjustment: boolean | null;
  change_detail: string | null;
  inquired_at: Date | null;
  resolved_at: Date | null;
  created_at: Date;
  line: { intake: { id: string } | null } | null;
};

type PrescriptionIntakeTimelineSource = {
  id: string;
  source_type: string;
  prescribed_date: Date | null;
  prescriber_name: string | null;
  prescriber_institution: string | null;
  original_collected_by: string | null;
  created_at: Date;
  cycle: { overall_status: string };
  lines: Array<{ id: string }>;
};

type DispenseResultTimelineSource = {
  id: string;
  actual_drug_name: string | null;
  actual_quantity: number;
  actual_unit: string | null;
  carry_type: string;
  dispensed_by: string;
  dispensed_at: Date;
  task: { cycle: { overall_status: string } | null };
  line: { intake: { id: string } };
};

type ManagementPlanTimelineSource = {
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

type FirstVisitDocumentTimelineSource = {
  id: string;
  document_url: string | null;
  delivered_at: Date | null;
  delivered_to: string | null;
  created_at: Date;
};

type ConferenceNoteTimelineSource = {
  id: string;
  note_type: string;
  title: string | null;
  conference_date: Date;
  follow_up_date: Date | null;
  follow_up_completed: boolean;
  generated_report_id: string | null;
  action_items: unknown;
};

type BillingCandidateTimelineSource = {
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

function formatTimelineDate(value: Date | null | undefined) {
  return value ? format(value, 'yyyy/MM/dd') : null;
}

function compactTimelineValues(values: Array<string | null | undefined | false>) {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function previewTimelineText(value: string | null | undefined, maxLength = 96) {
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

const FIRST_VISIT_DOCUMENT_ACTION_VERBS: Record<string, string> = {
  generated: '作成',
  printed: '印刷',
  recovered: '回収',
  image_saved: '画像保存',
  replaced: '差し替え',
  invalidated: '無効化',
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

function latestFirstVisitDocumentActionByDocumentId(
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

function getCommunicationDirectionLabel(direction: string) {
  if (direction === 'inbound' || direction === 'incoming') return '受信';
  if (direction === 'outbound' || direction === 'outgoing') return '発信';
  return direction;
}

export function buildPatientTimelineEvents(input: BuildPatientTimelineEventsInput) {
  const {
    patientId,
    actorNameMap,
    visitSchedules,
    visitRecords,
    careReports,
    communicationEvents,
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
  const firstVisitDocumentActions = latestFirstVisitDocumentActionByDocumentId(operationHistory);
  const patientDetailHref = buildPatientHref(patientId);
  const patientDocumentsHref = buildPatientHref(patientId, '#patient-documents');
  const patientManagementPlanHref = buildPatientHref(patientId, '/management-plan');
  const patientMcsHref = buildPatientHref(patientId, '/mcs');
  const patientCollaborationHref = buildPatientHref(patientId, '/collaboration');
  const patientShareHref = buildPatientHref(patientId, '/share');
  const patientQuery = new URLSearchParams({ patient_id: patientId }).toString();
  const patientBillingCandidatesHref = `/billing/candidates?${patientQuery}`;
  const patientConferencesHref = `/conferences?${patientQuery}`;

  return [
    ...visitSchedules.map((item) => ({
      id: `visit_schedule:${item.id}`,
      event_type: 'visit_schedule',
      category: 'visit',
      occurred_at: item.confirmed_at ?? item.updated_at ?? item.created_at,
      title: item.confirmed_at ? '訪問予定を確定' : '訪問予定を登録',
      summary:
        compactTimelineValues([
          VISIT_TYPE_LABELS[item.visit_type] ?? item.visit_type,
          formatTimelineDate(item.scheduled_date)
            ? `訪問日 ${formatTimelineDate(item.scheduled_date)}`
            : null,
          item.visit_record ? '訪問記録あり' : null,
        ]).join(' / ') || null,
      href: item.visit_record
        ? buildVisitHref(item.visit_record.id)
        : buildVisitRecordHref(item.id),
      action_label: item.visit_record ? '訪問記録を開く' : '訪問記録を入力',
      status: item.schedule_status,
      status_label: SCHEDULE_STATUS_LABELS[item.schedule_status] ?? item.schedule_status,
      actor_name: actorNameMap.get(item.pharmacist_id) ?? null,
      metadata: compactTimelineValues([
        item.priority ? `優先度 ${PRIORITY_LABELS[item.priority] ?? item.priority}` : null,
        item.route_order ? `ルート順 ${item.route_order}` : null,
      ]),
    })),
    ...visitRecords.map((item) => ({
      id: `visit_record:${item.id}`,
      event_type: 'visit_record',
      category: 'visit',
      occurred_at: item.visit_date ?? item.created_at,
      title: '訪問記録を登録',
      summary:
        compactTimelineValues([
          item.revisit_reason,
          item.postpone_reason,
          item.cancellation_reason,
        ]).join(' / ') || null,
      href: buildVisitHref(item.id),
      action_label: '訪問記録を開く',
      status: item.outcome_status,
      status_label: VISIT_OUTCOME_LABELS[item.outcome_status] ?? item.outcome_status,
      actor_name: actorNameMap.get(item.pharmacist_id) ?? null,
      metadata: compactTimelineValues([
        item.next_visit_suggestion_date
          ? `次回提案 ${formatTimelineDate(item.next_visit_suggestion_date)}`
          : null,
      ]),
    })),
    ...prescriptionIntakes.map((item) => ({
      id: `prescription_intake:${item.id}`,
      event_type: 'prescription_intake',
      category: 'prescription',
      occurred_at: item.created_at,
      title: '処方受付を登録',
      summary:
        compactTimelineValues([
          PRESCRIPTION_SOURCE_LABELS[item.source_type] ?? item.source_type,
          item.prescriber_name ?? item.prescriber_institution,
          formatTimelineDate(item.prescribed_date)
            ? `処方日 ${formatTimelineDate(item.prescribed_date)}`
            : null,
        ]).join(' / ') || null,
      href: buildPrescriptionHref(item.id),
      action_label: '処方受付を開く',
      status: item.cycle.overall_status,
      status_label: CYCLE_STATUS_LABELS[item.cycle.overall_status] ?? item.cycle.overall_status,
      actor_name: item.original_collected_by ?? null,
      metadata: compactTimelineValues([
        item.lines.length > 0 ? `${item.lines.length}剤まで表示` : null,
      ]),
    })),
    ...dispenseResults.map((item) => ({
      id: `dispense_result:${item.id}`,
      event_type: 'dispense_result',
      category: 'prescription',
      occurred_at: item.dispensed_at,
      title: '調剤を記録',
      summary:
        compactTimelineValues([
          item.actual_drug_name,
          `${item.actual_quantity}${item.actual_unit ?? ''}`,
          CARRY_TYPE_LABELS[item.carry_type] ?? item.carry_type,
        ]).join(' / ') || null,
      href: buildPrescriptionHref(item.line.intake.id),
      action_label: '処方記録を開く',
      status: item.task.cycle?.overall_status ?? 'dispensed',
      status_label: CYCLE_STATUS_LABELS[item.task.cycle?.overall_status ?? 'dispensed'] ?? '調剤済',
      actor_name: actorNameMap.get(item.dispensed_by) ?? null,
      metadata: [],
    })),
    ...inquiryRecords.map((item) => {
      const inquiryStatus =
        item.result === 'changed'
          ? '変更あり'
          : item.result === 'unchanged'
            ? '変更なし'
            : '回答待ち';

      return {
        id: `inquiry:${item.id}`,
        event_type: 'inquiry',
        category: 'prescription',
        occurred_at: item.resolved_at ?? item.inquired_at ?? item.created_at,
        title: `疑義照会 ${inquiryStatus}`,
        summary:
          compactTimelineValues([
            item.reason,
            item.inquiry_to_physician,
            getInquiryPrimaryDetail({
              inquiryContent: item.inquiry_content,
              changeDetail: item.change_detail,
            }),
          ]).join(' / ') || null,
        href: item.line?.intake?.id ? buildPrescriptionHref(item.line.intake.id) : '/workflow',
        action_label: item.line?.intake?.id ? '処方受付を開く' : 'ワークフローを開く',
        status: item.result ?? 'pending',
        status_label: inquiryStatus,
        actor_name: null,
        metadata: compactTimelineValues([
          item.inquired_at ? `照会 ${formatTimelineDate(item.inquired_at)}` : null,
          ...getInquiryPresentationBadges({
            proposalOrigin:
              item.proposal_origin === 'pre_issuance' ? 'pre_issuance' : 'post_inquiry',
            residualAdjustment: item.residual_adjustment,
          }),
        ]),
      };
    }),
    ...careReports.flatMap((item) => [
      {
        id: `care_report:${item.id}`,
        event_type: 'care_report',
        category: 'document',
        occurred_at: item.created_at,
        title: '報告書を作成',
        summary:
          compactTimelineValues([
            REPORT_TYPE_LABELS[item.report_type] ?? item.report_type,
            REPORT_STATUS_CONFIG[item.status]?.label ?? item.status,
          ]).join(' / ') || null,
        href: buildReportHref(item.id),
        action_label: '報告書を開く',
        status: item.status,
        status_label: REPORT_STATUS_CONFIG[item.status]?.label ?? item.status,
        actor_name: actorNameMap.get(item.created_by) ?? null,
        metadata: [],
      },
      ...item.delivery_records.map((delivery) => ({
        id: `delivery_record:${delivery.id}`,
        event_type: 'delivery_record',
        category: 'document',
        occurred_at: delivery.confirmed_at ?? delivery.sent_at ?? delivery.created_at,
        title: delivery.status === 'confirmed' ? '報告書の受領を確認' : '報告書を送付',
        summary:
          compactTimelineValues([
            delivery.recipient_name,
            CHANNEL_LABELS[delivery.channel] ?? delivery.channel,
            REPORT_TYPE_LABELS[item.report_type] ?? item.report_type,
          ]).join(' / ') || null,
        href: buildReportHref(item.id),
        action_label: '送付元報告書を開く',
        status: delivery.status,
        status_label: REPORT_STATUS_CONFIG[delivery.status]?.label ?? delivery.status,
        actor_name: actorNameMap.get(item.created_by) ?? null,
        metadata: [],
      })),
    ]),
    ...managementPlans.map((item) => {
      const actorId = item.approved_by ?? item.reviewed_by ?? item.created_by;
      const occurredAt = item.approved_at ?? item.reviewed_at ?? item.created_at;

      return {
        id: `management_plan:${item.id}`,
        event_type: 'management_plan',
        category: 'document',
        occurred_at: occurredAt,
        title: item.approved_at ? '管理計画書を承認' : '管理計画書を作成',
        summary:
          compactTimelineValues([
            item.title,
            item.effective_from ? `適用開始 ${formatTimelineDate(item.effective_from)}` : null,
            item.next_review_date
              ? `次回見直し ${formatTimelineDate(item.next_review_date)}`
              : null,
          ]).join(' / ') || null,
        href: patientManagementPlanHref,
        action_label: '計画書を開く',
        status: item.status,
        status_label: MANAGEMENT_PLAN_STATUS_LABELS[item.status] ?? item.status,
        actor_name: actorNameMap.get(actorId) ?? null,
        metadata: [],
      };
    }),
    ...firstVisitDocuments.map((item) => {
      const isDelivered = Boolean(item.delivered_at);
      const latestAction = firstVisitDocumentActions.get(item.id) ?? null;
      const actionVerb = latestAction
        ? (FIRST_VISIT_DOCUMENT_ACTION_VERBS[latestAction.action] ?? latestAction.action)
        : isDelivered
          ? '交付'
          : '作成';
      const documentLabel = latestAction?.documentTypeLabel ?? '初回訪問文書';
      return {
        id: `first_visit_document:${item.id}`,
        event_type: 'first_visit_document',
        category: 'document',
        occurred_at: latestAction?.occurredAt ?? item.delivered_at ?? item.created_at,
        title: `${documentLabel}を${actionVerb}`,
        summary:
          compactTimelineValues([
            latestAction?.templateName ?? null,
            latestAction?.templateVersion ? `版 ${latestAction.templateVersion}` : null,
            item.delivered_to,
            isDelivered ? '交付記録あり' : '交付未記録',
            latestAction?.storageLabel ? `保管 ${latestAction.storageLabel}` : null,
            latestAction?.reason,
            latestAction?.note,
          ]).join(' / ') || null,
        href: item.document_url ?? patientDocumentsHref,
        action_label: item.document_url ? 'PDFを見る' : '文書状態を開く',
        status: latestAction?.action ?? (isDelivered ? 'delivered' : 'created'),
        status_label: latestAction
          ? (FIRST_VISIT_DOCUMENT_ACTION_VERBS[latestAction.action] ?? latestAction.action)
          : isDelivered
            ? '交付済み'
            : '作成済み',
        actor_name: latestAction ? (actorNameMap.get(latestAction.actorId) ?? null) : null,
        metadata: compactTimelineValues([latestAction?.documentTypeLabel ?? null]),
      };
    }),
    ...conferenceNotes.map((item) => {
      const actionItemCount = Array.isArray(item.action_items) ? item.action_items.length : 0;
      return {
        id: `conference_note:${item.id}`,
        event_type: 'conference_note',
        category: 'communication',
        occurred_at: item.conference_date,
        title: `${getConferenceTypeLabel(item.note_type)}を記録`,
        summary:
          compactTimelineValues([
            item.title,
            actionItemCount > 0 ? `合意事項 ${actionItemCount}件` : null,
            item.generated_report_id ? '報告ドラフトあり' : null,
          ]).join(' / ') || null,
        href: patientConferencesHref,
        action_label: '会議を開く',
        status: item.follow_up_completed ? 'completed' : 'open',
        status_label: item.follow_up_completed ? 'フォロー完了' : 'フォロー中',
        actor_name: null,
        metadata: compactTimelineValues([
          item.follow_up_date ? `フォロー期限 ${formatTimelineDate(item.follow_up_date)}` : null,
        ]),
      };
    }),
    ...billingCandidates.map((item) => ({
      id: `billing_candidate:${item.id}`,
      event_type: 'billing_candidate',
      category: 'billing',
      occurred_at: item.updated_at,
      title: '算定候補を更新',
      summary:
        compactTimelineValues([
          item.billing_name,
          item.points != null ? `${item.points}点` : null,
          item.exclusion_reason,
        ]).join(' / ') || null,
      href: `/billing/candidates?${new URLSearchParams({
        billing_month: format(item.billing_month, 'yyyy-MM-01'),
        patient_id: patientId,
      }).toString()}`,
      action_label: '算定候補を開く',
      status: item.status,
      status_label:
        item.status === 'candidate'
          ? '候補'
          : item.status === 'confirmed'
            ? '確定'
            : item.status === 'excluded'
              ? '除外'
              : item.status === 'exported'
                ? '締め済み'
                : item.status,
      actor_name: null,
      metadata: compactTimelineValues([
        item.billing_code,
        `算定月 ${formatTimelineDate(item.billing_month)}`,
      ]),
    })),
    ...operationHistory.map((item) => {
      const meta = getOperationHistoryLabel(item) ?? {
        title: '患者操作履歴を記録',
        statusLabel: item.action,
      };
      const isBilling =
        item.action.startsWith('billing_') || item.target_type.startsWith('billing_');
      const isPrescription = item.action.startsWith('prescription_');
      const isMcs = item.action.startsWith('patient_mcs_');
      const isConference = item.action.startsWith('conference_note.');

      return {
        id: `operation_history:${item.id}`,
        event_type: 'operation_history',
        category: getOperationHistoryCategory(item),
        occurred_at: item.created_at,
        title: meta.title,
        summary: buildOperationHistorySummary(item),
        href: isBilling
          ? patientBillingCandidatesHref
          : isPrescription
            ? buildPrescriptionHref(item.target_id)
            : isMcs
              ? patientMcsHref
              : isConference
                ? patientConferencesHref
                : patientDetailHref,
        action_label: isBilling
          ? '請求を開く'
          : isPrescription
            ? '処方受付を開く'
            : isMcs
              ? 'MCS連携を開く'
              : isConference
                ? '会議を開く'
                : '患者詳細を開く',
        status: item.action,
        status_label: meta.statusLabel,
        actor_name: actorNameMap.get(item.actor_id) ?? null,
        metadata: compactTimelineValues([item.target_type, item.target_id]),
      };
    }),
    ...selfReports.map((item) => ({
      id: `self_report:${item.id}`,
      event_type: 'self_report',
      category: 'communication',
      occurred_at: item.created_at,
      title: '患者から自己申告を受信',
      summary:
        compactTimelineValues([
          item.subject,
          item.category,
          previewTimelineText(item.content),
        ]).join(' / ') || null,
      href: patientCollaborationHref,
      action_label: '連携を確認',
      status: item.status,
      status_label: SELF_REPORT_STATUS_LABELS[item.status] ?? item.status,
      actor_name: item.reported_by_name,
      metadata: compactTimelineValues([
        item.relation ? `関係 ${item.relation}` : null,
        item.requested_callback ? '折返し希望' : null,
        item.preferred_contact_time ? `希望時間 ${item.preferred_contact_time}` : null,
      ]),
    })),
    ...communicationEvents
      .filter((item) => item.event_type !== 'patient_self_report')
      .map((item) => {
        const directionLabel = getCommunicationDirectionLabel(item.direction);

        return {
          id: `communication:${item.id}`,
          event_type: 'communication',
          category: 'communication',
          occurred_at: item.occurred_at,
          title: directionLabel === '受信' ? '連絡を受信' : '連絡を発信',
          summary:
            compactTimelineValues([
              CHANNEL_LABELS[item.channel] ?? item.channel,
              item.counterpart_name,
              item.subject ?? item.event_type,
            ]).join(' / ') || null,
          href: patientConferencesHref,
          action_label: '連絡履歴を開く',
          status: item.direction,
          status_label: directionLabel,
          actor_name: null,
          metadata: [],
        };
      }),
    ...externalShares.map((item) => ({
      id: `external_share:${item.id}`,
      event_type: 'external_share',
      category: 'communication',
      occurred_at: item.created_at,
      title: '外部共有リンクを発行',
      summary:
        compactTimelineValues([
          item.granted_to_name,
          item.accessed_at ? '閲覧済み' : '未閲覧',
        ]).join(' / ') || null,
      href: patientShareHref,
      action_label: '共有設定を開く',
      status: item.accessed_at ? 'accessed' : 'issued',
      status_label: item.accessed_at ? '閲覧済み' : '共有中',
      actor_name: null,
      metadata: compactTimelineValues([`期限 ${formatTimelineDate(item.expires_at)}`]),
    })),
  ]
    .sort((left, right) => right.occurred_at.getTime() - left.occurred_at.getTime())
    .slice(0, 40);
}
