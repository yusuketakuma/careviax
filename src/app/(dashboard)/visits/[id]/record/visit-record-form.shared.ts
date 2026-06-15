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
