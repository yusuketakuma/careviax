const AUDITED_CONSENT_DOCUMENT_PATH_PATTERN = /^\/api\/files\/([^/?#]+)\/presigned-download$/;

export const CONSENT_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

export function buildAuditedConsentDocumentUrl(fileId: string) {
  return `/api/files/${encodeURIComponent(fileId)}/presigned-download?download=1`;
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

  return buildAuditedConsentDocumentUrl(decodeURIComponent(match[1]));
}

export function serializeConsentRecordDocumentUrl<T extends { document_url: string | null }>(
  record: T,
) {
  const safeDocumentUrl = normalizeAuditedConsentDocumentUrl(record.document_url);
  return {
    ...record,
    document_url: safeDocumentUrl,
    has_document_url: Boolean(record.document_url),
    document_url_redacted: Boolean(record.document_url && !safeDocumentUrl),
  };
}
