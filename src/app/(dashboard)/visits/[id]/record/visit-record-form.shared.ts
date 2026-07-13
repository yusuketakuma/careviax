import type { OfflineSyncStatus } from '@/lib/constants/visual-status-registry';
import type { SyncQueueItemSummary } from '@/lib/stores/sync-engine';

const MAX_VISIT_ATTACHMENTS = 10;
const IMAGE_ATTACHMENT_MAX_MB = 10;
const PDF_ATTACHMENT_MAX_MB = 50;
const IMAGE_ATTACHMENT_MAX_BYTES = IMAGE_ATTACHMENT_MAX_MB * 1024 * 1024;
const PDF_ATTACHMENT_MAX_BYTES = PDF_ATTACHMENT_MAX_MB * 1024 * 1024;
const ALLOWED_VISIT_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export type VisitRecordSaveState = 'checking' | 'unsaved' | 'saving' | OfflineSyncStatus;

type VisitRecordSavePresentationInput = {
  scheduleId: string;
  queueItems: readonly SyncQueueItemSummary[];
  unsyncedEvidenceCount: number;
  draftHydrated: boolean;
  hasLocalDraft: boolean;
  draftSaveStatus: 'idle' | 'saving' | 'saved';
  serverSavePending: boolean;
  serverSaved: boolean;
  medicationStockStatus: 'idle' | 'saving' | 'error' | 'conflict' | 'unavailable';
};

export type VisitRecordSavePresentation = {
  state: VisitRecordSaveState;
  pendingCount: number;
};

function readQueueItemScheduleId(item: SyncQueueItemSummary) {
  const scopedId = item.scope_id?.trim();
  if (scopedId) return scopedId;

  const payloadScheduleId = item.payload.schedule_id;
  return typeof payloadScheduleId === 'string' && payloadScheduleId.trim()
    ? payloadScheduleId.trim()
    : null;
}

/**
 * Resolve record persistence for one visit schedule only. Global queue counts and the
 * queue-wide last-synced timestamp must never imply that this record is queued or synced.
 */
export function resolveVisitRecordSavePresentation({
  scheduleId,
  queueItems,
  unsyncedEvidenceCount,
  draftHydrated,
  hasLocalDraft,
  draftSaveStatus,
  serverSavePending,
  serverSaved,
  medicationStockStatus,
}: VisitRecordSavePresentationInput): VisitRecordSavePresentation {
  const currentQueueItems = queueItems.filter(
    (item) => item.entityType === 'visit_record' && readQueueItemScheduleId(item) === scheduleId,
  );
  const normalizedEvidenceCount = Number.isFinite(unsyncedEvidenceCount)
    ? Math.max(0, Math.trunc(unsyncedEvidenceCount))
    : 0;
  const pendingCount = currentQueueItems.length + normalizedEvidenceCount;

  if (serverSavePending || draftSaveStatus === 'saving' || medicationStockStatus === 'saving') {
    return { state: 'saving', pendingCount };
  }

  if (
    medicationStockStatus === 'conflict' ||
    currentQueueItems.some((item) => item.conflict_state === 'server_conflict')
  ) {
    return { state: 'conflict', pendingCount };
  }

  if (
    medicationStockStatus === 'error' ||
    medicationStockStatus === 'unavailable' ||
    currentQueueItems.some((item) => item.retryCount > 0 || Boolean(item.lastError?.trim()))
  ) {
    return { state: 'failed', pendingCount };
  }

  if (pendingCount > 0) return { state: 'queued', pendingCount };
  if (serverSaved) return { state: 'synced', pendingCount };
  if (!draftHydrated) return { state: 'checking', pendingCount };
  if (hasLocalDraft || draftSaveStatus === 'saved') {
    return { state: 'saved_locally', pendingCount };
  }

  return { state: 'unsaved', pendingCount };
}

export function getVisitAttachmentConstraints() {
  return {
    maxAttachments: MAX_VISIT_ATTACHMENTS,
    imageMaxMb: IMAGE_ATTACHMENT_MAX_MB,
    pdfMaxMb: PDF_ATTACHMENT_MAX_MB,
  };
}

export function buildAttachmentId(file: File) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function classifyVisitAttachment(file: File): 'photo' | 'attachment' {
  return file.type.startsWith('image/') ? 'photo' : 'attachment';
}

export function validateVisitAttachment(file: File) {
  if (!ALLOWED_VISIT_ATTACHMENT_MIME_TYPES.has(file.type)) {
    return 'JPEG / PNG / WEBP / PDF のみ添付できます';
  }

  const isPdf = file.type === 'application/pdf';
  const maxBytes = isPdf ? PDF_ATTACHMENT_MAX_BYTES : IMAGE_ATTACHMENT_MAX_BYTES;
  const maxMegabytes = isPdf ? PDF_ATTACHMENT_MAX_MB : IMAGE_ATTACHMENT_MAX_MB;

  if (file.size > maxBytes) {
    return `${file.name} は ${maxMegabytes}MB を超えるため添付できません`;
  }

  return null;
}

export type VisitReceiptFields = {
  receipt_person_name?: string | null;
  receipt_person_relation?: string | null;
  receipt_at?: string | null;
};

export type VisitReceiptReadiness = {
  hasIdentityInput: boolean;
  hasCompleteIdentity: boolean;
  missingLabels: string[];
};

function normalizeReceiptText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getVisitReceiptReadiness(fields: VisitReceiptFields): VisitReceiptReadiness {
  const hasName = Boolean(normalizeReceiptText(fields.receipt_person_name));
  const hasRelation = Boolean(normalizeReceiptText(fields.receipt_person_relation));
  const hasReceivedAt = Boolean(normalizeReceiptText(fields.receipt_at));
  const hasIdentityInput = hasName || hasRelation;

  if (!hasIdentityInput) {
    return {
      hasIdentityInput: false,
      hasCompleteIdentity: false,
      missingLabels: [],
    };
  }

  return {
    hasIdentityInput: true,
    hasCompleteIdentity: hasName && hasRelation && hasReceivedAt,
    missingLabels: [
      ...(!hasName ? ['受領者名'] : []),
      ...(!hasRelation ? ['続柄'] : []),
      ...(!hasReceivedAt ? ['受領日時'] : []),
    ],
  };
}

export type ReflectPatientIntakeInput = {
  careLevel?: string | null;
  medicationManager?: string | null;
};

/**
 * ⑤ 反映導線: 訪問記録で確認した患者情報のうち、入力された項目だけを
 * 患者詳細(正本)へ送る intake パッチに整形する。
 * 空欄は送らない(= mergeHomeVisitIntake で既存値を変更しない)。全項目が空なら null。
 */
export function buildReflectPatientIntake(
  input: ReflectPatientIntakeInput,
): Record<string, string> | null {
  const intake: Record<string, string> = {};

  const careLevel = input.careLevel?.trim();
  if (careLevel) intake.care_level = careLevel;

  const medicationManager = input.medicationManager?.trim();
  if (medicationManager) intake.medication_manager = medicationManager;

  return Object.keys(intake).length > 0 ? intake : null;
}

export function normalizeVisitReceiptPayload<T extends VisitReceiptFields>(values: T): T {
  const receiptName = normalizeReceiptText(values.receipt_person_name);
  const receiptRelation = normalizeReceiptText(values.receipt_person_relation);

  if (!receiptName && !receiptRelation) {
    return {
      ...values,
      receipt_person_name: undefined,
      receipt_person_relation: undefined,
      receipt_at: undefined,
    };
  }

  return {
    ...values,
    receipt_person_name: receiptName,
    receipt_person_relation: receiptRelation,
    receipt_at: normalizeReceiptText(values.receipt_at),
  };
}
