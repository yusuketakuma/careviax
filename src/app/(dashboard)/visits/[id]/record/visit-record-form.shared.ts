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
