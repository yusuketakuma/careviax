import type { MemberRole, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { formatOptionalDate } from '@/lib/patient/home-visit-intake';
import { resolvePatientMcsOpenTargets } from '@/lib/patient-mcs/source';
import { listPatientBillingCaseRefs } from '@/server/services/patient-detail-billing-refs';
import { buildPatientDetailWhere } from '@/server/services/patient-detail-scope';
import type {
  PatientHomeOperationAlert,
  PatientHomeOperationItem,
  PatientHomeOperationsSnapshot,
} from '@/types/patient-home-operations';

type DbClient = typeof prisma | Prisma.TransactionClient;

type DetailArgs = {
  orgId: string;
  patientId: string;
  role: MemberRole;
  userId: string;
};

const PRESCRIPTION_SOURCE_LABELS: Record<string, string> = {
  paper: '紙',
  fax: 'FAX先行',
  e_prescription: '電子処方せん',
  facility_batch: '施設一括',
  refill: 'リフィル',
  qr_scan: 'QR取込',
};

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatDate(value: Date | null | undefined) {
  return value ? formatOptionalDate(value.toISOString().slice(0, 10)) : '未設定';
}

function formatTokyoDateKey(value: Date) {
  const parts = Object.fromEntries(
    TOKYO_DATE_FORMATTER.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatCurrency(value: number | null | undefined) {
  return value == null ? '未記録' : `${value.toLocaleString('ja-JP')}円`;
}

function compact(values: Array<string | null | undefined | false>) {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function compactMetricText(value: string | null | undefined, maxLength = 32) {
  if (!value) return '未入力';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function elapsedWholeDays(from: Date | null | undefined, to: Date) {
  if (!from) return null;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / PRESCRIPTION_DAY_MS));
}

function formatExpiryMetric(args: {
  expiresAt: Date | null;
  now: Date;
  dispensingCompleted: boolean;
}) {
  if (!args.expiresAt) return '未設定';
  const dateLabel = formatDate(args.expiresAt);
  if (args.dispensingCompleted) return `${dateLabel} / 調剤完了`;

  const remainingMs = args.expiresAt.getTime() - args.now.getTime();
  if (remainingMs < 0) {
    const overdueDays = Math.max(1, Math.ceil(Math.abs(remainingMs) / PRESCRIPTION_DAY_MS));
    return `${dateLabel} / ${overdueDays}日超過`;
  }
  if (remainingMs <= PRESCRIPTION_EXPIRY_SOON_MS) {
    const remainingHours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
    return `${dateLabel} / 残り${remainingHours}時間`;
  }
  const remainingDays = Math.max(1, Math.ceil(remainingMs / PRESCRIPTION_DAY_MS));
  return `${dateLabel} / 残り${remainingDays}日`;
}

type BillingCollectionSnapshot = {
  status: string | null;
  billed_amount: number | null;
  collected_amount: number | null;
  unpaid_amount: number | null;
  payment_method: string | null;
  payer_name: string | null;
  billed_at: string | null;
  scheduled_collection_at: string | null;
  collected_at: string | null;
  receipt_number: string | null;
  receipt_issue_status: string | null;
  invoice_issue_status: string | null;
  save_receipt_copy: boolean;
  receipt_copy_url: string | null;
  invoice_copy_url: string | null;
};

type BillingPaymentProfileSnapshot = {
  payer_type: string | null;
  payer_name: string | null;
  payer_relation: string | null;
  billing_address_mode: string | null;
  payment_method: string | null;
  collection_timing: string | null;
  receipt_issue: string | null;
  invoice_issue: string | null;
  unpaid_tolerance: string | null;
  note: string | null;
};

type McsProfileSnapshot = {
  linked_status: string | null;
  participation_status: string | null;
  pharmacy_participants: string[];
  main_counterpart_roles: string[];
  last_checked_at: string | null;
  note: string | null;
};

type PrescriptionOriginalManagementSnapshot = {
  reconciliation_result: string | null;
  reconciliation_checked_at: string | null;
  reconciliation_checked_by: string | null;
  discrepancy_note: string | null;
  storage_location: string | null;
  e_prescription_exchange_number: string | null;
  e_prescription_acquired_status: string | null;
  dispensing_result_registration: string | null;
  note: string | null;
};

type ConferenceSyncSummarySnapshot = {
  report_draft_ids: string[];
  billing_candidate_id: string | null;
  visit_proposal_id: string | null;
  tasks_created: number;
  medication_issues_created: number;
};

type ConferenceOperationSnapshot = {
  location: string | null;
  agenda: string | null;
  pharmacy_participants: string[];
  participant_count: number | null;
};

type ConferenceActionItemSummary = {
  total: number;
  converted: number;
};

type ConferenceOperationNote = {
  id?: string;
  note_type: string;
  title: string;
  conference_date: Date;
  follow_up_date: Date | null;
  follow_up_completed: boolean;
  generated_report_id: string | null;
  metadata: Prisma.JsonValue | null;
  action_items: Prisma.JsonValue | null;
  updated_at: Date;
};

const MCS_LINKED_STATUS_LABELS: Record<string, string> = {
  linked: '連携あり',
  unlinked: '連携なし',
  unknown: '不明',
};

const MCS_PARTICIPATION_STATUS_LABELS: Record<string, string> = {
  invited: '招待済',
  joined: '参加済',
  not_joined: '未参加',
  unknown: '不明',
};

const MCS_COUNTERPART_ROLE_LABELS: Record<string, string> = {
  physician: '医師',
  visiting_nurse: '訪看',
  care_manager: 'CM',
  family: '家族',
  facility: '施設',
  other: 'その他',
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

const E_PRESCRIPTION_STATUS_LABELS: Record<string, string> = {
  not_applicable: '対象外',
  pending: '取得待ち',
  acquired: '取得済み',
};

const DISPENSING_RESULT_REGISTRATION_LABELS: Record<string, string> = {
  not_applicable: '対象外',
  pending: '登録待ち',
  registered: '登録済み',
};

const PRESCRIPTION_COMPLETED_STATUSES = new Set([
  'dispensed',
  'audited',
  'visit_ready',
  'delivered',
  'closed',
]);
const PRESCRIPTION_EXPIRY_SOON_MS = 24 * 60 * 60 * 1000;
const PRESCRIPTION_DAY_MS = 24 * 60 * 60 * 1000;
const PRESCRIPTION_FAX_ORIGINAL_OVERDUE_DAYS = 2;

const BILLING_PAYER_TYPE_LABELS: Record<string, string> = {
  self: '本人',
  family: '家族',
  guardian: '後見人',
  facility: '施設',
  other: 'その他',
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

const BILLING_COLLECTION_TIMING_LABELS: Record<string, string> = {
  per_visit: '毎回',
  month_end: '月末',
  next_month: '翌月',
  facility_batch: '施設一括',
  other: 'その他',
};

const BILLING_RECEIPT_ISSUE_LABELS: Record<string, string> = {
  paper: '紙',
  pdf: 'PDF',
  none: '不要',
};

const BILLING_DOCUMENT_ISSUE_STATUS_LABELS: Record<string, string> = {
  issued: '発行済み',
  not_issued: '未発行',
  not_required: '不要',
};

const BILLING_INVOICE_ISSUE_LABELS: Record<string, string> = {
  yes: 'あり',
  no: 'なし',
};

const BILLING_UNPAID_TOLERANCE_LABELS: Record<string, string> = {
  none: 'なし',
  one_month: '1か月',
  custom: '個別対応',
};

const FIRST_VISIT_TEMPLATE_LABELS: Record<string, string> = {
  contract_document: '契約書',
  important_matters: '重要事項説明書',
  privacy_consent: '個人情報同意書',
  consent_form: '同意書',
};

const FIRST_VISIT_TEMPLATE_TYPES = Object.keys(FIRST_VISIT_TEMPLATE_LABELS);
const FIRST_VISIT_DOCUMENT_TYPES = [
  { documentType: 'contract', templateType: 'contract_document', label: '契約書' },
  {
    documentType: 'important_matters',
    templateType: 'important_matters',
    label: '重要事項説明書',
  },
  {
    documentType: 'privacy_consent',
    templateType: 'privacy_consent',
    label: '個人情報同意書',
  },
  { documentType: 'consent', templateType: 'consent_form', label: '同意書' },
] as const;
const TOP_ALERT_LIMIT = 8;
const HOME_OPERATION_ALERT_PRIORITY: Record<PatientHomeOperationItem['key'], number> = {
  documents: 0,
  prescription: 1,
  billing: 2,
  conference: 3,
  mcs: 4,
};

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

type FirstVisitDocumentHomeSource = {
  id: string;
  document_url: string | null;
  delivered_at: Date | null;
  delivered_to: string | null;
  created_at: Date;
  updated_at: Date;
};

type FirstVisitDocumentHomeAction = {
  documentId: string;
  action: string;
  documentType: string | null;
  templateName: string | null;
  templateVersion: string | null;
  printBatchId: string | null;
  storageLocation: string | null;
  createdAt: Date;
};

const FIRST_VISIT_DOCUMENT_STATUS_LABELS: Record<string, string> = {
  not_created: '未作成',
  created: '作成済み',
  printed: '印刷済み',
  recovered: '回収済み',
  image_saved: '画像保存済み',
  replaced: '差替え済み',
  invalidated: '失効',
};

function readFirstVisitDocumentAction(log: {
  target_id: string;
  action: string;
  changes: Prisma.JsonValue | null;
  created_at: Date;
}): FirstVisitDocumentHomeAction | null {
  if (!log.action.startsWith('first_visit_document.')) return null;
  const changes = readJsonObject(log.changes);
  const documentAction = readJsonObject(changes?.document_action);

  return {
    documentId: log.target_id,
    action: readString(documentAction?.action) ?? log.action.replace('first_visit_document.', ''),
    documentType: readString(documentAction?.document_type),
    templateName: readString(documentAction?.template_name),
    templateVersion: readString(documentAction?.template_version),
    printBatchId: readString(documentAction?.print_batch_id),
    storageLocation: readString(documentAction?.storage_location),
    createdAt: log.created_at,
  };
}

function deriveFirstVisitDocumentHomeStatuses(args: {
  documents: FirstVisitDocumentHomeSource[];
  actions: FirstVisitDocumentHomeAction[];
}) {
  return FIRST_VISIT_DOCUMENT_TYPES.map(({ documentType, templateType, label }) => {
    const matchingActions = args.actions
      .filter((action) => action.documentType === documentType)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const latestAction = matchingActions[0] ?? null;
    const latestPrintAction = matchingActions.find((action) => action.action === 'printed') ?? null;
    const latestDocument = latestAction
      ? (args.documents.find((document) => document.id === latestAction.documentId) ?? null)
      : null;
    const hasFile = Boolean(latestDocument?.document_url);
    const deliveredAt = latestDocument?.delivered_at ?? null;
    const status = latestAction
      ? latestAction.action === 'invalidated'
        ? 'invalidated'
        : latestAction.action === 'replaced'
          ? 'replaced'
          : hasFile && (latestAction.action === 'image_saved' || deliveredAt)
            ? 'image_saved'
            : latestAction.action === 'recovered' || deliveredAt
              ? 'recovered'
              : latestAction.action === 'printed'
                ? 'printed'
                : 'created'
      : 'not_created';

    return {
      documentType,
      templateType,
      label,
      status,
      statusLabel: FIRST_VISIT_DOCUMENT_STATUS_LABELS[status],
      templateName: latestAction?.templateName ?? null,
      templateVersion: latestAction?.templateVersion ?? null,
      storageLocation: latestAction?.storageLocation ?? null,
      latestActionAt: latestAction?.createdAt ?? null,
      latestPrintedAt: latestPrintAction?.createdAt ?? null,
      latestPrintBatchId: latestPrintAction?.printBatchId ?? null,
      latestDocument,
      hasFile,
      deliveredAt,
      alerts: compact([
        !latestAction && `${label}が未作成です`,
        latestAction && ['created', 'printed'].includes(status) && !deliveredAt
          ? `${label}の回収が未記録です`
          : null,
        latestAction && status !== 'invalidated' && !hasFile
          ? `${label}の画像/PDFが未保存です`
          : null,
        status === 'invalidated' ? `${label}は失効中です` : null,
      ]),
    };
  });
}

function readBillingCollection(calculationBreakdown: unknown): BillingCollectionSnapshot | null {
  const collection = readJsonObject(readJsonObject(calculationBreakdown)?.collection);
  if (!collection) return null;

  return {
    status: readString(collection.status),
    billed_amount: readNumber(collection.billed_amount),
    collected_amount: readNumber(collection.collected_amount),
    unpaid_amount: readNumber(collection.unpaid_amount),
    payment_method: readString(collection.payment_method),
    payer_name: readString(collection.payer_name),
    billed_at: readString(collection.billed_at),
    scheduled_collection_at: readString(collection.scheduled_collection_at),
    collected_at: readString(collection.collected_at),
    receipt_number: readString(collection.receipt_number),
    receipt_issue_status: readString(collection.receipt_issue_status),
    invoice_issue_status: readString(collection.invoice_issue_status),
    save_receipt_copy: readBoolean(collection.save_receipt_copy),
    receipt_copy_url: readString(collection.receipt_copy_url),
    invoice_copy_url: readString(collection.invoice_copy_url),
  };
}

function readBillingPaymentProfile(metadata: unknown): BillingPaymentProfileSnapshot | null {
  const value = readJsonObject(metadata);
  if (!value) return null;

  return {
    payer_type: readString(value.payer_type),
    payer_name: readString(value.payer_name),
    payer_relation: readString(value.payer_relation),
    billing_address_mode: readString(value.billing_address_mode),
    payment_method: readString(value.payment_method),
    collection_timing: readString(value.collection_timing),
    receipt_issue: readString(value.receipt_issue),
    invoice_issue: readString(value.invoice_issue),
    unpaid_tolerance: readString(value.unpaid_tolerance),
    note: readString(value.note),
  };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function readNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function readMcsProfile(metadata: unknown): McsProfileSnapshot | null {
  const value = readJsonObject(metadata);
  if (!value) return null;
  const mainCounterpartRoles = readStringArray(value.main_counterpart_roles);
  const counterpartRoles =
    mainCounterpartRoles.length > 0
      ? mainCounterpartRoles
      : readStringArray(value.counterpart_roles);

  return {
    linked_status: readString(value.linked_status),
    participation_status: readString(value.participation_status),
    pharmacy_participants: readStringArray(value.pharmacy_participants),
    main_counterpart_roles: counterpartRoles.map(
      (role) => MCS_COUNTERPART_ROLE_LABELS[role] ?? role,
    ),
    last_checked_at: readString(value.last_checked_at),
    note: readString(value.note),
  };
}

function readPrescriptionOriginalManagement(
  metadata: unknown,
): PrescriptionOriginalManagementSnapshot | null {
  const value = readJsonObject(metadata);
  if (!value) return null;

  return {
    reconciliation_result: readString(value.reconciliation_result),
    reconciliation_checked_at: readString(value.reconciliation_checked_at),
    reconciliation_checked_by: readString(value.reconciliation_checked_by),
    discrepancy_note: readString(value.discrepancy_note),
    storage_location: readString(value.storage_location),
    e_prescription_exchange_number: readString(value.e_prescription_exchange_number),
    e_prescription_acquired_status: readString(value.e_prescription_acquired_status),
    dispensing_result_registration: readString(value.dispensing_result_registration),
    note: readString(value.note),
  };
}

function readConferenceSyncSummary(metadata: unknown): ConferenceSyncSummarySnapshot | null {
  const syncSummary = readJsonObject(readJsonObject(metadata)?.sync_summary);
  if (!syncSummary) return null;

  return {
    report_draft_ids: readStringArray(syncSummary.report_draft_ids),
    billing_candidate_id: readString(syncSummary.billing_candidate_id),
    visit_proposal_id: readString(syncSummary.visit_proposal_id),
    tasks_created: readNonNegativeNumber(syncSummary.tasks_created),
    medication_issues_created: readNonNegativeNumber(syncSummary.medication_issues_created),
  };
}

function readConferenceOperation(metadata: unknown): ConferenceOperationSnapshot | null {
  const conferenceOperation = readJsonObject(readJsonObject(metadata)?.conference_operation);
  if (!conferenceOperation) return null;

  return {
    location: readString(conferenceOperation.location),
    agenda: readString(conferenceOperation.agenda),
    pharmacy_participants: readStringArray(conferenceOperation.pharmacy_participants),
    participant_count: readNonNegativeNumber(conferenceOperation.participant_count),
  };
}

function hasConferenceReportDraft(conference: ConferenceOperationNote) {
  return Boolean(
    conference.generated_report_id ||
    (readConferenceSyncSummary(conference.metadata)?.report_draft_ids.length ?? 0) > 0,
  );
}

function readConferenceActionItemSummary(actionItems: unknown): ConferenceActionItemSummary {
  const items = Array.isArray(actionItems)
    ? actionItems.flatMap((item) => {
        const object = readJsonObject(item);
        return object && readString(object.title) ? [object] : [];
      })
    : [];
  const converted = items.filter(
    (item) => readString(item.converted_task_id) || readString(item.converted_at),
  ).length;

  return {
    total: items.length,
    converted,
  };
}

function estimateCandidateAmount(candidate: {
  points: number | null;
  calculation_breakdown: Prisma.JsonValue | null;
}) {
  const breakdown = readJsonObject(candidate.calculation_breakdown);
  const amountYen = readNumber(breakdown?.amount_yen);
  if (amountYen != null) return amountYen;
  return candidate.points;
}

function buildDocumentItem(args: {
  patientId: string;
  documents: FirstVisitDocumentHomeSource[];
  documentActions: FirstVisitDocumentHomeAction[];
  latestTemplates: Array<{
    template_type: string;
    name: string;
    version: number;
    effective_from: Date | null;
    effective_to: Date | null;
  }>;
}): PatientHomeOperationItem {
  const templatesByType = new Map<string, (typeof args.latestTemplates)[number]>();
  for (const template of args.latestTemplates) {
    if (!templatesByType.has(template.template_type)) {
      templatesByType.set(template.template_type, template);
    }
  }
  const documentStatuses = deriveFirstVisitDocumentHomeStatuses({
    documents: args.documents,
    actions: args.documentActions,
  });
  const missingTemplateLabels = FIRST_VISIT_DOCUMENT_TYPES.filter(
    ({ templateType }) => !templatesByType.has(templateType),
  ).map(({ label }) => label);
  const alerts = [
    ...documentStatuses.flatMap((status) => status.alerts),
    ...compact([
      missingTemplateLabels.length > 0
        ? `既定テンプレート未設定: ${missingTemplateLabels.join(' / ')}`
        : null,
    ]),
  ];
  const readyCount = documentStatuses.filter(
    (status) => status.status !== 'not_created' && status.alerts.length === 0,
  ).length;
  const fileCount = documentStatuses.filter((status) => status.hasFile).length;
  const recoveredCount = documentStatuses.filter((status) =>
    ['recovered', 'image_saved', 'replaced'].includes(status.status),
  ).length;
  const latestPrint = documentStatuses
    .filter((status) => status.latestPrintedAt)
    .sort((left, right) => right.latestPrintedAt!.getTime() - left.latestPrintedAt!.getTime())[0];
  const latestUpdatedAt =
    [
      ...args.documents.map((document) => document.updated_at ?? document.created_at),
      ...args.documentActions.map((action) => action.createdAt),
    ].sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
  const latestDelivered = args.documents
    .filter((document) => document.delivered_at)
    .sort((left, right) => right.delivered_at!.getTime() - left.delivered_at!.getTime())[0];
  const firstAlert = alerts[0] ?? null;

  return {
    key: 'documents',
    label: '契約・同意・書類',
    status: alerts.length === 0 ? '整備済み' : `${readyCount}/${documentStatuses.length}件整備`,
    description: firstAlert
      ? firstAlert
      : latestDelivered
        ? `交付先 ${latestDelivered.delivered_to ?? '未記録'} / 交付日 ${formatDate(latestDelivered.delivered_at)}`
        : '契約書、重要事項説明書、同意書、初回訪問文書の作成・印刷・回収を確認します。',
    href: `/patients/${args.patientId}#patient-documents`,
    action_label: '文書状態へ',
    tone: alerts.length > 0 ? 'attention' : 'ok',
    updated_at: toIso(latestUpdatedAt),
    metrics: [
      { label: 'PDF/画像', value: `${fileCount}/${documentStatuses.length}件保存` },
      { label: '回収/画像', value: `${recoveredCount}/${documentStatuses.length}件完了` },
      {
        label: '最終印刷',
        value: latestPrint?.latestPrintedAt
          ? `${formatDate(latestPrint.latestPrintedAt)} / ${latestPrint.latestPrintBatchId ?? 'バッチ未記録'}`
          : '未記録',
      },
      ...documentStatuses.map((status) => {
        const template = templatesByType.get(status.templateType);
        const templateText = status.templateName
          ? `${status.templateName}${status.templateVersion ? ` ${status.templateVersion}` : ''}`
          : template
            ? `${template.name} v${template.version}`
            : '既定テンプレート未設定';
        return {
          label: status.label,
          value: `${status.statusLabel} / ${templateText}`,
        };
      }),
    ],
    alerts,
  };
}

function buildMcsItem(args: {
  patientId: string;
  link: {
    source_url: string | null;
    mcs_patient_url: string | null;
    mcs_project_url: string | null;
    project_title: string | null;
    last_synced_at: Date | null;
    last_sync_attempt_at: Date | null;
    last_sync_status: string | null;
    last_sync_error: string | null;
    updated_at: Date;
  } | null;
  profile: McsProfileSnapshot | null;
  now: Date;
}): PatientHomeOperationItem {
  const link = args.link;
  const profile = args.profile;
  const lastCheckedAt = profile?.last_checked_at ? new Date(profile.last_checked_at) : null;
  const lastCheckedAtValid = lastCheckedAt && !Number.isNaN(lastCheckedAt.getTime());
  const staleCheckedAt =
    lastCheckedAtValid && args.now.getTime() - lastCheckedAt.getTime() > 7 * 24 * 60 * 60 * 1000;
  const alerts = compact([
    !link && '患者別MCS URLが未登録です',
    link?.last_sync_error && 'MCS同期エラーがあります',
    link && profile?.linked_status === 'unlinked' && 'MCS連携なしとして記録されています',
    link && staleCheckedAt && 'MCS最終確認日から7日以上経過しています',
  ]);
  const linkedStatusLabel = profile?.linked_status
    ? (MCS_LINKED_STATUS_LABELS[profile.linked_status] ?? profile.linked_status)
    : link
      ? '登録済み'
      : '未登録';
  const participationStatusLabel = profile?.participation_status
    ? (MCS_PARTICIPATION_STATUS_LABELS[profile.participation_status] ??
      profile.participation_status)
    : '未記録';
  const openTargets = resolvePatientMcsOpenTargets(
    link
      ? {
          sourceUrl: link.source_url,
          projectUrl: link.mcs_project_url,
          patientUrl: link.mcs_patient_url,
        }
      : null,
  );
  const externalHref = openTargets.mcsUrl ?? null;

  return {
    key: 'mcs',
    label: 'MCS・外部連携',
    status: link?.last_sync_error ? '同期エラー' : linkedStatusLabel,
    description: link
      ? `${link.project_title ?? 'MCS患者タイムライン'} / 最終確認 ${formatDate(lastCheckedAtValid ? lastCheckedAt : null)}`
      : 'MCS URL、参加状況、最終確認日、連携ログを患者単位で管理します。',
    href: `/patients/${args.patientId}/mcs`,
    action_label: link ? 'MCS連携を管理' : 'MCSを登録',
    external_href: externalHref,
    external_action_label: externalHref ? 'MCSを開く' : null,
    tone: alerts.length > 0 ? (link ? 'attention' : 'neutral') : 'ok',
    updated_at: toIso(link?.updated_at ?? link?.last_sync_attempt_at),
    metrics: [
      { label: '最終同期', value: formatDate(link?.last_synced_at) },
      { label: '最終確認', value: formatDate(lastCheckedAtValid ? lastCheckedAt : null) },
      { label: '連携状態', value: linkedStatusLabel },
      { label: '参加状況', value: participationStatusLabel },
      {
        label: '薬局側参加者',
        value: profile?.pharmacy_participants.length
          ? profile.pharmacy_participants.join(' / ')
          : '未記録',
      },
      {
        label: '主な連携先',
        value: profile?.main_counterpart_roles.length
          ? profile.main_counterpart_roles.join(' / ')
          : '未記録',
      },
      { label: '同期状態', value: link?.last_sync_status ?? (link ? '登録済み' : '未登録') },
    ],
    alerts,
    quick_actions: link
      ? [
          {
            key: 'record_mcs_check_log',
            label: 'MCS確認ログを記録',
            resource_id: args.patientId,
          },
        ]
      : [],
  };
}

function buildPrescriptionItem(args: {
  patientId: string;
  latestIntake: {
    id: string;
    cycle_id: string;
    source_type: string;
    prescribed_date: Date;
    prescription_expiry_date: Date | null;
    original_collected_at: Date | null;
    original_collected_by: string | null;
    original_document_url: string | null;
    prescriber_name: string | null;
    prescriber_institution: string | null;
    created_at: Date;
    updated_at: Date;
    cycle: { overall_status: string };
  } | null;
  originalManagement: PrescriptionOriginalManagementSnapshot | null;
  unresolvedInquiryCount: number;
  now: Date;
}): PatientHomeOperationItem {
  const intake = args.latestIntake;
  const originalManagement = args.originalManagement;
  const sourceLabel = intake
    ? (PRESCRIPTION_SOURCE_LABELS[intake.source_type] ?? intake.source_type)
    : null;
  const expiresAt = intake?.prescription_expiry_date ?? null;
  const expired = Boolean(expiresAt && expiresAt < args.now);
  const dispensingCompleted = intake
    ? PRESCRIPTION_COMPLETED_STATUSES.has(intake.cycle.overall_status)
    : false;
  const expirySoon = Boolean(
    expiresAt &&
    !expired &&
    !dispensingCompleted &&
    expiresAt.getTime() - args.now.getTime() <= PRESCRIPTION_EXPIRY_SOON_MS,
  );
  const inquiryPending =
    intake?.cycle.overall_status === 'inquiry_pending' || args.unresolvedInquiryCount > 0;
  const faxOriginalMissing = intake?.source_type === 'fax' && !intake.original_collected_at;
  const faxElapsedDays =
    intake?.source_type === 'fax' ? elapsedWholeDays(intake.created_at, args.now) : null;
  const faxOriginalOverdue = Boolean(
    faxOriginalMissing &&
    faxElapsedDays != null &&
    faxElapsedDays >= PRESCRIPTION_FAX_ORIGINAL_OVERDUE_DAYS,
  );
  const reconciliationResult = originalManagement?.reconciliation_result ?? null;
  const reconciliationCheckedAt = originalManagement?.reconciliation_checked_at
    ? new Date(originalManagement.reconciliation_checked_at)
    : null;
  const reconciliationCheckedDate =
    reconciliationCheckedAt && !Number.isNaN(reconciliationCheckedAt.getTime())
      ? reconciliationCheckedAt
      : null;
  const reconciliationLabel = reconciliationResult
    ? (PRESCRIPTION_RECONCILIATION_LABELS[reconciliationResult] ?? reconciliationResult)
    : '未照合';
  const reconciliationMetric =
    reconciliationResult && reconciliationResult !== 'not_checked' && reconciliationCheckedDate
      ? `${reconciliationLabel} / ${formatDate(reconciliationCheckedDate)}`
      : reconciliationLabel;
  const storageLabel = originalManagement?.storage_location
    ? (PRESCRIPTION_STORAGE_LABELS[originalManagement.storage_location] ??
      originalManagement.storage_location)
    : '未保管';
  const ePrescriptionLabel = originalManagement?.e_prescription_acquired_status
    ? (E_PRESCRIPTION_STATUS_LABELS[originalManagement.e_prescription_acquired_status] ??
      originalManagement.e_prescription_acquired_status)
    : intake?.source_type === 'e_prescription'
      ? '取得待ち'
      : '対象外';
  const dispensingResultLabel = originalManagement?.dispensing_result_registration
    ? (DISPENSING_RESULT_REGISTRATION_LABELS[originalManagement.dispensing_result_registration] ??
      originalManagement.dispensing_result_registration)
    : '未登録';
  const alerts = compact([
    !intake && '処方せん受付がまだありません',
    faxOriginalOverdue && `FAX受信から${faxElapsedDays}日経過しても原本到着が未記録です`,
    faxOriginalMissing && !faxOriginalOverdue && 'FAX先行受付の原本到着が未記録です',
    inquiryPending &&
      `疑義照会が未完了です${args.unresolvedInquiryCount > 0 ? ` (${args.unresolvedInquiryCount}件)` : ''}`,
    expired && '処方せん有効期限を過ぎています',
    expirySoon && '処方せん有効期限が24時間以内です',
    intake && !intake.original_document_url && '処方せん画像/PDFが未保存です',
    intake?.original_collected_at &&
      (!originalManagement || reconciliationResult === 'not_checked') &&
      '原本到着後の照合結果が未記録です',
    reconciliationResult === 'discrepancy' &&
      !originalManagement?.discrepancy_note &&
      'FAX・原本差異の内容が未記録です',
    reconciliationResult === 'discrepancy' &&
      originalManagement?.discrepancy_note &&
      'FAX・原本差異があります',
    intake &&
      dispensingCompleted &&
      (!originalManagement?.storage_location ||
        originalManagement.storage_location === 'not_stored') &&
      '処方せん保管場所が未記録です',
    intake?.source_type === 'e_prescription' &&
      originalManagement?.e_prescription_acquired_status !== 'acquired' &&
      '電子処方せんの取得状態が未完了です',
    intake &&
      dispensingCompleted &&
      originalManagement?.dispensing_result_registration !== 'registered' &&
      '調剤結果登録が未完了です',
  ]);

  return {
    key: 'prescription',
    label: '処方せん',
    status: !intake
      ? '未受付'
      : expired
        ? '期限切れ'
        : inquiryPending
          ? '疑義照会中'
          : expirySoon
            ? '期限間近'
            : faxOriginalMissing
              ? '原本未着'
              : '受付あり',
    description: intake
      ? `${sourceLabel} / ${intake.prescriber_institution ?? intake.prescriber_name ?? '処方元未記録'} / ${formatDate(intake.prescribed_date)}`
      : 'FAX受信、原本到着、電子処方せん、疑義照会、調剤結果登録、保管状況を確認します。',
    href: `/patients/${args.patientId}/prescriptions`,
    action_label: '処方履歴へ',
    tone: alerts.length > 0 ? 'attention' : 'ok',
    updated_at: toIso(intake?.updated_at ?? intake?.created_at),
    metrics: [
      {
        label: '期限',
        value: formatExpiryMetric({ expiresAt, now: args.now, dispensingCompleted }),
      },
      { label: '原本', value: intake?.original_collected_at ? '到着済み' : '未着/未記録' },
      { label: '原本到着日', value: formatDate(intake?.original_collected_at ?? null) },
      { label: '原本受領者', value: intake?.original_collected_by ?? '未記録' },
      { label: '原本照合日', value: formatDate(reconciliationCheckedDate) },
      {
        label: 'FAX経過',
        value:
          intake?.source_type === 'fax'
            ? intake.original_collected_at
              ? '到着済み'
              : faxElapsedDays == null
                ? '未記録'
                : `${faxElapsedDays}日未着`
            : '対象外',
      },
      { label: '照合', value: reconciliationMetric },
      { label: '保管', value: storageLabel },
      { label: '電子処方', value: ePrescriptionLabel },
      { label: '結果登録', value: dispensingResultLabel },
      {
        label: '疑義照会',
        value: inquiryPending ? `${args.unresolvedInquiryCount || 1}件未完了` : '未解決なし',
      },
      { label: '工程', value: intake?.cycle.overall_status ?? '未受付' },
    ],
    alerts,
    quick_actions: intake
      ? [
          ...(faxOriginalMissing
            ? [
                {
                  key: 'mark_fax_original_collected' as const,
                  label: '原本到着を記録',
                  resource_id: intake.id,
                },
              ]
            : []),
          ...(!intake.original_document_url
            ? [
                {
                  key: 'save_prescription_document' as const,
                  label: '画像/PDFを保存',
                  resource_id: intake.id,
                },
              ]
            : []),
          {
            key: 'record_prescription_original_management' as const,
            label: originalManagement ? '原本管理を更新' : '原本管理を記録',
            resource_id: intake.id,
          },
        ]
      : [],
  };
}

function buildBillingItem(args: {
  patientId: string;
  billingSupportFlag: boolean;
  paymentProfile: BillingPaymentProfileSnapshot | null;
  candidates: Array<{
    id: string;
    billing_month: Date;
    billing_name: string;
    points: number | null;
    status: string;
    exclusion_reason: string | null;
    calculation_breakdown: Prisma.JsonValue | null;
    updated_at: Date;
  }>;
}): PatientHomeOperationItem {
  const openCandidates = args.candidates.filter((item) =>
    ['candidate', 'confirmed'].includes(item.status),
  );
  const excluded = args.candidates.filter((item) => item.status === 'excluded');
  const latest = args.candidates[0] ?? null;
  const candidateCollections = args.candidates.map((candidate) => ({
    candidate,
    collection: readBillingCollection(candidate.calculation_breakdown),
  }));
  const latestCollection = candidateCollections[0]?.collection ?? null;
  const paymentProfile = args.paymentProfile;
  const estimatedAmount = latest ? estimateCandidateAmount(latest) : null;
  const candidateUnpaidRows = candidateCollections.flatMap(({ candidate, collection }) => {
    if (!collection || candidate.status === 'excluded') {
      return [];
    }
    const unpaid =
      collection.unpaid_amount ??
      (collection.billed_amount != null
        ? Math.max(collection.billed_amount - (collection.collected_amount ?? 0), 0)
        : 0);
    return unpaid > 0 ? [{ candidate, unpaid }] : [];
  });
  const hasCollectionRecord = candidateCollections.some(({ collection }) => collection);
  const totalUnpaidAmount =
    candidateUnpaidRows.length > 0 || hasCollectionRecord
      ? candidateUnpaidRows.reduce((sum, row) => sum + row.unpaid, 0)
      : null;
  const unpaidCandidate = candidateUnpaidRows[0]?.candidate ?? null;
  const scheduledCollectionAt = latestCollection?.scheduled_collection_at
    ? new Date(latestCollection.scheduled_collection_at)
    : null;
  const scheduledCollectionDate =
    scheduledCollectionAt && !Number.isNaN(scheduledCollectionAt.getTime())
      ? scheduledCollectionAt
      : null;
  const receiptRequired =
    paymentProfile?.receipt_issue != null && paymentProfile.receipt_issue !== 'none';
  const missingReceiptCollections = receiptRequired
    ? candidateCollections.filter(({ collection }) => {
        if (!collection || collection.receipt_number) {
          return false;
        }
        if (collection.status === 'collected') {
          return true;
        }
        return collection.status === 'partial' && (collection.collected_amount ?? 0) > 0;
      })
    : [];
  const missingReceiptCandidate = missingReceiptCollections[0]?.candidate ?? null;
  const focusCandidate = missingReceiptCandidate ?? unpaidCandidate ?? latest;
  const alerts = compact([
    !args.billingSupportFlag && '請求支援フラグが未設定です',
    !paymentProfile && '患者ごとの支払者・支払方法が未設定です',
    openCandidates.length > 0 && `未処理の算定候補が${openCandidates.length}件あります`,
    excluded.length > 0 && `除外・ブロック中の算定候補が${excluded.length}件あります`,
    latest &&
      !latestCollection &&
      ['confirmed', 'exported'].includes(latest.status) &&
      '集金ステータスが未記録です',
    latestCollection?.status === 'scheduled' &&
      !scheduledCollectionDate &&
      '集金予定日が未記録です',
    missingReceiptCollections.length > 0 &&
      `領収証番号が未記録の入金記録が${missingReceiptCollections.length}件あります`,
    totalUnpaidAmount != null &&
      totalUnpaidAmount > 0 &&
      `未収額 ${formatCurrency(totalUnpaidAmount)} があります`,
  ]);

  return {
    key: 'billing',
    label: '請求・集金',
    status:
      openCandidates.length > 0 ? '確認待ち' : args.billingSupportFlag ? '支援対象' : '未設定',
    description: latest
      ? `${formatDate(latest.billing_month)} ${latest.billing_name} / ${latest.status}`
      : paymentProfile
        ? `${paymentProfile.payer_name ?? BILLING_PAYER_TYPE_LABELS[paymentProfile.payer_type ?? ''] ?? '支払者未記録'} / ${BILLING_PAYMENT_METHOD_LABELS[paymentProfile.payment_method ?? ''] ?? '支払方法未記録'}`
        : '支払者、支払方法、請求候補、未収・集金予定、領収証の確認導線です。',
    href: `/billing/candidates?${new URLSearchParams({
      patient_id: args.patientId,
      ...(focusCandidate
        ? { billing_month: focusCandidate.billing_month.toISOString().slice(0, 10) }
        : {}),
    }).toString()}`,
    action_label: '請求候補を確認',
    tone: alerts.length > 0 ? 'attention' : args.billingSupportFlag ? 'ok' : 'neutral',
    updated_at: toIso(latest?.updated_at),
    metrics: [
      { label: '算定候補', value: `${openCandidates.length}件` },
      { label: 'ブロック', value: `${excluded.length}件` },
      {
        label: '支払設定',
        value: paymentProfile
          ? (BILLING_PAYER_TYPE_LABELS[paymentProfile.payer_type ?? ''] ??
            paymentProfile.payer_type ??
            '設定済み')
          : '未設定',
      },
      {
        label: '支払方法',
        value: paymentProfile
          ? (BILLING_PAYMENT_METHOD_LABELS[paymentProfile.payment_method ?? ''] ??
            paymentProfile.payment_method ??
            '未記録')
          : '未記録',
      },
      {
        label: '集金タイミング',
        value: paymentProfile
          ? (BILLING_COLLECTION_TIMING_LABELS[paymentProfile.collection_timing ?? ''] ??
            paymentProfile.collection_timing ??
            '未記録')
          : '未記録',
      },
      {
        label: '今月請求額',
        value: formatCurrency(latestCollection?.billed_amount ?? estimatedAmount),
      },
      { label: '未収額', value: formatCurrency(totalUnpaidAmount) },
      { label: '次回集金予定', value: formatDate(scheduledCollectionDate) },
      {
        label: '支払者',
        value: latestCollection?.payer_name ?? paymentProfile?.payer_name ?? '未記録',
      },
      { label: '領収証', value: latestCollection?.receipt_number ?? '未発行/未記録' },
      {
        label: '領収証状態',
        value: latestCollection?.receipt_issue_status
          ? (BILLING_DOCUMENT_ISSUE_STATUS_LABELS[latestCollection.receipt_issue_status] ??
            latestCollection.receipt_issue_status)
          : '未記録',
      },
      {
        label: '請求書状態',
        value: latestCollection?.invoice_issue_status
          ? (BILLING_DOCUMENT_ISSUE_STATUS_LABELS[latestCollection.invoice_issue_status] ??
            latestCollection.invoice_issue_status)
          : '未記録',
      },
      {
        label: '領収証控え',
        value: latestCollection?.receipt_copy_url
          ? '保存済み'
          : latestCollection?.save_receipt_copy
            ? '保存予定'
            : '保存しない',
      },
      {
        label: '請求書控え',
        value: latestCollection?.invoice_copy_url ? '保存済み' : '未保存',
      },
      {
        label: '領収証発行',
        value: paymentProfile
          ? (BILLING_RECEIPT_ISSUE_LABELS[paymentProfile.receipt_issue ?? ''] ??
            paymentProfile.receipt_issue ??
            '未記録')
          : '未記録',
      },
      {
        label: '請求書発行',
        value: paymentProfile
          ? (BILLING_INVOICE_ISSUE_LABELS[paymentProfile.invoice_issue ?? ''] ??
            paymentProfile.invoice_issue ??
            '未記録')
          : '未記録',
      },
      {
        label: '未収許容',
        value: paymentProfile
          ? (BILLING_UNPAID_TOLERANCE_LABELS[paymentProfile.unpaid_tolerance ?? ''] ??
            paymentProfile.unpaid_tolerance ??
            '未記録')
          : '未記録',
      },
      { label: '支払者区分コード', value: paymentProfile?.payer_type ?? '' },
      { label: '支払方法コード', value: paymentProfile?.payment_method ?? '' },
      { label: '集金タイミングコード', value: paymentProfile?.collection_timing ?? '' },
      { label: '領収証発行コード', value: paymentProfile?.receipt_issue ?? '' },
      { label: '請求書発行コード', value: paymentProfile?.invoice_issue ?? '' },
      { label: '領収証状態コード', value: latestCollection?.receipt_issue_status ?? '' },
      { label: '請求書状態コード', value: latestCollection?.invoice_issue_status ?? '' },
      { label: '領収証控えコード', value: latestCollection?.save_receipt_copy ? 'yes' : 'no' },
      { label: '領収証控えURL', value: latestCollection?.receipt_copy_url ?? '' },
      { label: '請求書控えURL', value: latestCollection?.invoice_copy_url ?? '' },
      { label: '未収許容コード', value: paymentProfile?.unpaid_tolerance ?? '' },
      { label: '続柄', value: paymentProfile?.payer_relation ?? '' },
      { label: '請求先住所区分コード', value: paymentProfile?.billing_address_mode ?? '' },
      { label: '備考', value: paymentProfile?.note ?? '' },
    ],
    alerts,
    quick_actions: [
      {
        key: 'record_billing_payment_profile',
        label: paymentProfile ? '支払設定を更新' : '支払設定を登録',
        resource_id: args.patientId,
      },
      ...(latest
        ? [
            {
              key: 'record_billing_collection' as const,
              label: latestCollection ? '集金記録を更新' : '集金記録を登録',
              resource_id: missingReceiptCandidate?.id ?? unpaidCandidate?.id ?? latest.id,
            },
          ]
        : []),
    ],
  };
}

function buildConferenceItem(args: {
  patientId: string;
  activeCaseId: string | null;
  conferences: ConferenceOperationNote[];
  openConferenceTasks: number;
}): PatientHomeOperationItem {
  const now = new Date();
  const upcomingNote =
    args.conferences
      .filter((conference) => conference.conference_date.getTime() > now.getTime())
      .sort((left, right) => left.conference_date.getTime() - right.conference_date.getTime())[0] ??
    null;
  const dueConferences = args.conferences.filter(
    (conference) => conference.conference_date.getTime() <= now.getTime(),
  );
  const dueWorkNote =
    dueConferences.find(
      (conference) =>
        !hasConferenceReportDraft(conference) ||
        Boolean(conference.follow_up_date && !conference.follow_up_completed) ||
        readConferenceActionItemSummary(conference.action_items).total >
          Math.max(
            readConferenceActionItemSummary(conference.action_items).converted,
            readConferenceSyncSummary(conference.metadata)?.tasks_created ?? 0,
          ),
    ) ??
    dueConferences[0] ??
    null;
  const note = dueWorkNote ?? upcomingNote ?? args.conferences[0] ?? null;
  const syncSummary = readConferenceSyncSummary(note?.metadata);
  const conferenceOperation = readConferenceOperation(note?.metadata);
  const actionItemSummary = readConferenceActionItemSummary(note?.action_items);
  const syncedActionTaskCount = Math.min(actionItemSummary.total, syncSummary?.tasks_created ?? 0);
  const convertedActionItemCount = Math.max(actionItemSummary.converted, syncedActionTaskCount);
  const openActionItemCount = Math.max(0, actionItemSummary.total - convertedActionItemCount);
  const todayTokyoKey = formatTokyoDateKey(new Date());
  const conferenceUpcoming = Boolean(upcomingNote);
  const reportDraftCount = new Set([
    ...(syncSummary?.report_draft_ids ?? []),
    ...(note?.generated_report_id ? [note.generated_report_id] : []),
  ]).size;
  const reportMissing = Boolean(dueWorkNote && !hasConferenceReportDraft(dueWorkNote));
  const followUpOpen = Boolean(note?.follow_up_date && !note.follow_up_completed);
  const followUpOverdue = Boolean(
    followUpOpen && note?.follow_up_date && formatTokyoDateKey(note.follow_up_date) < todayTokyoKey,
  );
  const alerts = compact([
    !note && 'カンファレンス予定・記録が未登録です',
    upcomingNote && `会議予定: ${formatDate(upcomingNote.conference_date)} ${upcomingNote.title}`,
    reportMissing && '会議後の報告書が未作成です',
    followUpOverdue && '会議後フォローアップ期限を過ぎています',
    followUpOpen && '会議後フォローアップが未完了です',
    args.openConferenceTasks > 0 && `会議関連タスクが${args.openConferenceTasks}件残っています`,
    openActionItemCount > 0 && `薬局タスク${openActionItemCount}件が運用タスクへ未変換です`,
  ]);

  return {
    key: 'conference',
    label: 'カンファレンス',
    status: !note
      ? '未登録'
      : !dueWorkNote && conferenceUpcoming
        ? '予定あり'
        : alerts.length > 0
          ? '後処理あり'
          : '記録あり',
    description: note
      ? `${note.title} / ${formatDate(note.conference_date)}`
      : '退院前カンファ、担当者会議、デスカンファの予定・議事録・報告書を管理します。',
    href: `/conferences?${new URLSearchParams({
      patient_id: args.patientId,
      ...(args.activeCaseId ? { case_id: args.activeCaseId } : {}),
      focus: 'notes',
      context: 'patient_detail',
    }).toString()}`,
    action_label: note ? '会議要点へ' : '会議を登録',
    tone: alerts.length > 0 ? 'attention' : 'ok',
    updated_at: toIso(args.conferences[0]?.updated_at ?? note?.updated_at ?? note?.conference_date),
    metrics: [
      {
        label: '報告書',
        value:
          reportDraftCount > 0
            ? `ドラフト${reportDraftCount}件`
            : !dueWorkNote && conferenceUpcoming
              ? '予定前'
              : '未作成',
      },
      {
        label: 'フォロー',
        value: followUpOverdue
          ? '期限超過'
          : followUpOpen
            ? '未完了'
            : note
              ? '完了/不要'
              : '未登録',
      },
      { label: '議題', value: note ? compactMetricText(conferenceOperation?.agenda) : '未登録' },
      { label: '場所', value: note ? compactMetricText(conferenceOperation?.location) : '未登録' },
      {
        label: '参加者',
        value: note
          ? conferenceOperation?.participant_count != null
            ? `${conferenceOperation.participant_count}名`
            : conferenceOperation?.pharmacy_participants.length
              ? `薬局 ${conferenceOperation.pharmacy_participants.length}名`
              : '未入力'
          : '未登録',
      },
      { label: 'タスク', value: `${args.openConferenceTasks}件` },
      {
        label: '予定連動',
        value: syncSummary?.visit_proposal_id ? '訪問提案あり' : note ? '未連動' : '未登録',
      },
      {
        label: '自動生成',
        value: note ? `${syncSummary?.tasks_created ?? 0}件` : '未登録',
      },
      {
        label: '薬剤課題',
        value: note ? `${syncSummary?.medication_issues_created ?? 0}件` : '未登録',
      },
      {
        label: '薬局タスク',
        value: actionItemSummary.total
          ? `${convertedActionItemCount}/${actionItemSummary.total}件変換`
          : '未登録',
      },
    ],
    alerts,
    quick_actions: [
      {
        key: 'record_conference_note',
        label: note ? '会議要点を追記' : '会議要点を登録',
        resource_id: args.activeCaseId ?? args.patientId,
      },
    ],
  };
}

function buildTopAlerts(items: PatientHomeOperationItem[]): PatientHomeOperationAlert[] {
  const alertsByItem = items
    .filter((item) => item.alerts.length > 0)
    .sort(
      (left, right) =>
        HOME_OPERATION_ALERT_PRIORITY[left.key] - HOME_OPERATION_ALERT_PRIORITY[right.key],
    )
    .map((item) =>
      item.alerts.map((message, index) => ({
        id: `${item.key}:${index}:${message}`,
        key: item.key,
        label: item.label,
        message,
        href: item.href,
        action_label: item.action_label,
      })),
    );
  const firstByDomain = alertsByItem.flatMap((alerts) => alerts.slice(0, 1));
  const remaining = alertsByItem.flatMap((alerts) => alerts.slice(1));

  return [...firstByDomain, ...remaining].slice(0, TOP_ALERT_LIMIT);
}

export async function getPatientHomeOperationsData(
  db: DbClient,
  args: DetailArgs,
): Promise<PatientHomeOperationsSnapshot | null> {
  const patient = await db.patient.findFirst({
    where: buildPatientDetailWhere(args),
    select: {
      id: true,
      billing_support_flag: true,
      cases: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((careCase) => careCase.id);
  const activeCaseId =
    patient.cases.find((careCase) => careCase.status === 'active')?.id ?? caseIds[0] ?? null;
  const billingRefs = await listPatientBillingCaseRefs(db, args, caseIds);
  const now = new Date();
  const conferenceScopeWhere = {
    org_id: args.orgId,
    OR: [
      { patient_id: args.patientId },
      ...(caseIds.length > 0 ? [{ case_id: { in: caseIds } }] : []),
    ],
  };
  const conferenceSelect = {
    id: true,
    note_type: true,
    title: true,
    conference_date: true,
    follow_up_date: true,
    follow_up_completed: true,
    generated_report_id: true,
    metadata: true,
    action_items: true,
    updated_at: true,
  };

  const [
    firstVisitDocuments,
    firstVisitTemplates,
    mcsLink,
    mcsProfileTask,
    latestIntake,
    billingCandidates,
    billingPaymentProfileTask,
    nextConference,
    unresolvedDueConferences,
    latestDueConference,
    openConferenceTasks,
  ] = await Promise.all([
    caseIds.length === 0
      ? Promise.resolve([])
      : db.firstVisitDocument.findMany({
          where: {
            org_id: args.orgId,
            patient_id: args.patientId,
            case_id: { in: caseIds },
          },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: 16,
          select: {
            id: true,
            document_url: true,
            delivered_at: true,
            delivered_to: true,
            created_at: true,
            updated_at: true,
          },
        }),
    db.template.findMany({
      where: {
        org_id: args.orgId,
        template_type: { in: FIRST_VISIT_TEMPLATE_TYPES },
        is_default: true,
        OR: [{ effective_from: null }, { effective_from: { lte: new Date() } }],
        AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: new Date() } }] }],
      },
      orderBy: [{ template_type: 'asc' }, { version: 'desc' }, { updated_at: 'desc' }],
      select: {
        template_type: true,
        name: true,
        version: true,
        effective_from: true,
        effective_to: true,
      },
    }),
    db.patientMcsLink.findFirst({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
      },
      orderBy: [{ updated_at: 'desc' }],
      select: {
        source_url: true,
        mcs_patient_url: true,
        mcs_project_url: true,
        project_title: true,
        last_synced_at: true,
        last_sync_attempt_at: true,
        last_sync_status: true,
        last_sync_error: true,
        updated_at: true,
      },
    }),
    db.task.findFirst({
      where: {
        org_id: args.orgId,
        task_type: 'patient_mcs_profile',
        related_entity_type: 'patient',
        related_entity_id: args.patientId,
      },
      orderBy: [{ updated_at: 'desc' }],
      select: {
        metadata: true,
      },
    }),
    caseIds.length === 0
      ? Promise.resolve(null)
      : db.prescriptionIntake.findFirst({
          where: {
            org_id: args.orgId,
            cycle: {
              case_id: { in: caseIds },
            },
          },
          orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
          select: {
            id: true,
            cycle_id: true,
            source_type: true,
            prescribed_date: true,
            prescription_expiry_date: true,
            original_collected_at: true,
            original_collected_by: true,
            original_document_url: true,
            prescriber_name: true,
            prescriber_institution: true,
            created_at: true,
            updated_at: true,
            cycle: {
              select: {
                overall_status: true,
              },
            },
          },
        }),
    db.billingCandidate.findMany({
      where: {
        org_id: args.orgId,
        OR: [
          { patient_id: args.patientId },
          { billing_target_type: 'patient', billing_target_id: args.patientId },
          ...(billingRefs.cycleIds.length > 0 ? [{ cycle_id: { in: billingRefs.cycleIds } }] : []),
        ],
      },
      orderBy: [{ billing_month: 'desc' }, { updated_at: 'desc' }],
      select: {
        id: true,
        billing_month: true,
        billing_name: true,
        points: true,
        status: true,
        exclusion_reason: true,
        calculation_breakdown: true,
        updated_at: true,
      },
    }),
    db.task.findFirst({
      where: {
        org_id: args.orgId,
        task_type: 'patient_billing_payment_profile',
        related_entity_type: 'patient',
        related_entity_id: args.patientId,
      },
      orderBy: [{ updated_at: 'desc' }],
      select: {
        metadata: true,
      },
    }),
    db.conferenceNote.findFirst({
      where: {
        ...conferenceScopeWhere,
        conference_date: { gt: now },
      },
      orderBy: [{ conference_date: 'asc' }, { created_at: 'asc' }],
      select: conferenceSelect,
    }),
    db.conferenceNote.findMany({
      where: {
        AND: [
          conferenceScopeWhere,
          { conference_date: { lte: now } },
          {
            OR: [
              { generated_report_id: null },
              { follow_up_date: { not: null }, follow_up_completed: false },
            ],
          },
        ],
      },
      orderBy: [{ conference_date: 'desc' }, { created_at: 'desc' }],
      take: 16,
      select: conferenceSelect,
    }),
    db.conferenceNote.findFirst({
      where: {
        ...conferenceScopeWhere,
        conference_date: { lte: now },
      },
      orderBy: [{ conference_date: 'desc' }, { created_at: 'desc' }],
      select: conferenceSelect,
    }),
    db.task.count({
      where: {
        org_id: args.orgId,
        status: { in: ['pending', 'in_progress'] },
        task_type: { contains: 'conference' },
        OR: [
          { related_entity_type: 'patient', related_entity_id: args.patientId },
          ...(caseIds.length > 0
            ? [{ related_entity_type: 'case', related_entity_id: { in: caseIds } }]
            : []),
        ],
      },
    }),
  ]);
  const firstVisitDocumentIds = firstVisitDocuments.map((document) => document.id);
  const firstVisitDocumentActions =
    firstVisitDocumentIds.length === 0
      ? []
      : (
          await db.auditLog.findMany({
            where: {
              org_id: args.orgId,
              target_type: 'first_visit_document',
              target_id: { in: firstVisitDocumentIds },
              action: { startsWith: 'first_visit_document.' },
            },
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            take: 40,
            select: {
              target_id: true,
              action: true,
              changes: true,
              created_at: true,
            },
          })
        ).flatMap((log) => {
          const action = readFirstVisitDocumentAction(log);
          return action ? [action] : [];
        });
  const mcsProfile = readMcsProfile(mcsProfileTask?.metadata);
  const billingPaymentProfile = readBillingPaymentProfile(billingPaymentProfileTask?.metadata);
  const originalManagementTask = latestIntake
    ? await db.task.findFirst({
        where: {
          org_id: args.orgId,
          task_type: 'prescription_original_management',
          related_entity_type: 'prescription_intake',
          related_entity_id: latestIntake.id,
        },
        orderBy: [{ updated_at: 'desc' }],
        select: {
          metadata: true,
        },
      })
    : null;
  const originalManagement = readPrescriptionOriginalManagement(originalManagementTask?.metadata);
  const unresolvedPrescriptionInquiryCount =
    caseIds.length === 0
      ? 0
      : await db.inquiryRecord.count({
          where: {
            org_id: args.orgId,
            cycle: {
              patient_id: args.patientId,
              case_id: { in: caseIds },
            },
            OR: [{ result: null }, { result: 'pending' }],
          },
        });
  const selectedConferenceNotes = [
    nextConference,
    ...unresolvedDueConferences,
    latestDueConference,
  ].filter(Boolean) as ConferenceOperationNote[];
  const conferenceNotes = [
    ...new Map(
      selectedConferenceNotes.map((conference) => [
        conference.id ?? `${conference.conference_date.toISOString()}:${conference.title}`,
        conference,
      ]),
    ).values(),
  ];

  const items = [
    buildDocumentItem({
      patientId: args.patientId,
      documents: firstVisitDocuments,
      documentActions: firstVisitDocumentActions,
      latestTemplates: firstVisitTemplates,
    }),
    buildMcsItem({
      patientId: args.patientId,
      link: mcsLink,
      profile: mcsProfile,
      now: new Date(),
    }),
    buildPrescriptionItem({
      patientId: args.patientId,
      latestIntake,
      originalManagement,
      unresolvedInquiryCount: unresolvedPrescriptionInquiryCount,
      now: new Date(),
    }),
    buildBillingItem({
      patientId: args.patientId,
      billingSupportFlag: patient.billing_support_flag,
      paymentProfile: billingPaymentProfile,
      candidates: billingCandidates,
    }),
    buildConferenceItem({
      patientId: args.patientId,
      activeCaseId,
      conferences: conferenceNotes,
      openConferenceTasks,
    }),
  ];

  return {
    generated_at: new Date().toISOString(),
    attention_count: items.filter((item) => item.tone === 'attention').length,
    top_alerts: buildTopAlerts(items),
    items,
  };
}
