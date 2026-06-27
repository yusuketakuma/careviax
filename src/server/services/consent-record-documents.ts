import { encodePathSegment } from '@/lib/http/path-segment';

const AUDITED_CONSENT_DOCUMENT_PATH_PATTERN = /^\/api\/files\/([^/?#]+)\/presigned-download$/;

export const CONSENT_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

export function buildAuditedConsentDocumentUrl(fileId: string) {
  return `/api/files/${encodePathSegment(fileId)}/presigned-download?download=1`;
}

export function normalizeAuditedConsentDocumentUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('/')) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed, 'http://local.invalid');
  } catch {
    return null;
  }

  const match = parsed.pathname.match(AUDITED_CONSENT_DOCUMENT_PATH_PATTERN);
  if (!match || parsed.searchParams.get('download') !== '1') return null;

  try {
    return buildAuditedConsentDocumentUrl(decodeURIComponent(match[1]));
  } catch (err) {
    if (err instanceof URIError || err instanceof RangeError) return null;
    throw err;
  }
}

export function serializeConsentRecordDocumentUrl<
  T extends { document_url: string | null; document_file_id?: string | null },
>(record: T) {
  const safeDocumentUrl = record.document_file_id
    ? buildAuditedConsentDocumentUrl(record.document_file_id)
    : normalizeAuditedConsentDocumentUrl(record.document_url);
  const hasDocumentUrl = Boolean(record.document_file_id || record.document_url);
  return {
    ...record,
    document_url: safeDocumentUrl,
    has_document_url: hasDocumentUrl,
    document_url_redacted: Boolean(hasDocumentUrl && !safeDocumentUrl),
  };
}
