const blockedAuditKeyPattern =
  /(patient_?ids?|patientIds?|storage_?key|object_?key|token|secret|url|href|raw|error|stack|address|phone|insurance|note|memo|text|body|content)/i;
const blockedAuditValuePattern =
  /(token=|secret|https?:\/\/|signed\.|storageKey|objectKey|bulk-exports|raw\.(pdf|zip)|provider raw error|\d{2,4}-\d{2,4}-\d{3,4}|保険者番号)/i;
const lowerCodePattern = /^[a-z0-9_.:-]{1,128}$/;
const safeMimeTypePattern = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const shaLikePattern = /^(?:sha256[:_-])?[a-f0-9]{16,128}$/;
const safePatientAggregateKeys = new Set([
  'patient_count',
  'patient_selection_hash',
  'requested_count',
  'success_count',
  'failed_count',
  'exported_patient_count',
  'exported_patient_id_hashes',
  'exported_patient_id_hashes_truncated',
]);

const safeExportAuditFormats = new Set([
  'csv',
  'json',
  'zip',
  'pdf',
  'print',
  'claims-xml',
  'file',
]);

const safeCodeStringKeys = new Set([
  'action',
  'actor',
  'actorPharmacy',
  'actorSite',
  'case_status',
  'consent_record_id',
  'context_type',
  'contract_document_id',
  'contract_id',
  'document_type',
  'export_format',
  'export_surface_id',
  'export_snapshot_id',
  'file_id',
  'file_purpose',
  'job_id',
  'patient',
  'patient_selection_hash',
  'patient_share_consent_id',
  'profile',
  'purpose',
  'redaction_profile',
  'request_type',
  'response_mode',
  'riskTier',
  'share_case_id',
  'source',
  'status',
  'surface',
  'targetType',
  'version_id',
]);
const numericKeys = new Set([
  'expires_in_seconds',
  'exported_patient_count',
  'exported_request_count',
  'failed_count',
  'intake_count',
  'patient_count',
  'record_count',
  'requested_count',
  'size_bytes',
  'success_count',
]);
const booleanKeys = new Set([
  'care_report_rows_excluded',
  'consent_revoked',
  'exported_patient_id_hashes_truncated',
  'exported_request_id_hashes_truncated',
  'has_consent_record',
  'has_expiry_date',
  'has_valid_until',
  'truncated',
]);
const safeCodeArrayKeys = new Set(['exported_patient_id_hashes', 'exported_request_id_hashes']);
const safeStatusValues = new Set([
  'active',
  'blocked',
  'closed',
  'completed',
  'draft',
  'exported',
  'failed',
  'open',
  'pending',
  'queued',
  'responded',
  'sent',
  'succeeded',
  'uploaded',
]);
const safeSourceValues = new Set(['admin', 'meeting', 'pharmacy_drug_stocks_export']);
const safeExportFormatValues = new Set([
  'claims-xml',
  'csv',
  'file',
  'json',
  'pdf',
  'print',
  'zip',
]);
const safePurposeValues = new Set([
  'audit',
  'bulk-export',
  'consent-document',
  'contract-document',
  'operations',
  'pharmacist_review',
  'posting',
  'prescription',
  'report',
  'visit-photo',
]);
const safeProfileValues = new Set(['external', 'internal']);
const safeRiskTierValues = new Set(['high', 'standard']);
const safeSurfaceValues = new Set([
  'care_report_pdf',
  'conference_note_pdf',
  'files_download',
  'files_presigned_download',
  'tracing_report_pdf',
  'visit_record_pdf',
]);
const safeResponseModeValues = new Set(['json', 'redirect']);
const safeContextTypeValues = new Set([
  'consent_attachment',
  'consent_record_document',
  'contract_document',
]);
const safeDocumentTypeValues = new Set(['basic_contract']);

const reportPdfMetadataProfileByTarget = {
  care_report: {
    surface: 'care_report_pdf',
    output_profile: 'external_submission_pdf',
    allowReportUpdatedAt: true,
  },
  tracing_report: {
    surface: 'tracing_report_pdf',
    output_profile: 'internal_pdf',
    allowReportUpdatedAt: false,
  },
  visit_record: {
    surface: 'visit_record_pdf',
    output_profile: 'internal_pdf',
    allowReportUpdatedAt: false,
  },
  conference_note: {
    surface: 'conference_note_pdf',
    output_profile: 'internal_pdf',
    allowReportUpdatedAt: false,
  },
} as const satisfies Record<
  string,
  { surface: string; output_profile: string; allowReportUpdatedAt: boolean }
>;

export type ReportPdfAuditTarget = keyof typeof reportPdfMetadataProfileByTarget;

const allowedFilterKeysByTarget = new Map<string, Set<string>>([
  [
    'audit_log',
    new Set([
      'actor',
      'actorPharmacy',
      'actorSite',
      'patient',
      'targetType',
      'action',
      'riskTier',
      'from',
      'to',
    ]),
  ],
  ['patient_list', new Set(['case_status', 'truncated'])],
  ['patients', new Set(['status'])],
  ['prescription_history', new Set(['intake_count', 'truncated'])],
  [
    'billing_candidate',
    new Set(['month', 'status', 'review_state', 'resolution_state', 'truncated']),
  ],
  [
    'communication_request',
    new Set([
      'status',
      'request_type',
      'profile',
      'redaction_profile',
      'care_report_rows_excluded',
      'truncated',
      'from',
      'to',
    ]),
  ],
  ['pharmacy_drug_stock', new Set(['purpose'])],
]);

const allowedMetadataKeysByTarget = new Map<string, Set<string>>([
  [
    'medication_history',
    new Set([
      'job_id',
      'file_id',
      'status',
      'patient_count',
      'requested_count',
      'success_count',
      'failed_count',
      'failure_codes',
      'patient_selection_hash',
    ]),
  ],
  [
    'file_asset',
    new Set([
      'file_id',
      'file_purpose',
      'mime_type',
      'size_bytes',
      'expires_in_seconds',
      'surface',
      'response_mode',
      'context_type',
      'patient_share_consent_id',
      'share_case_id',
      'has_consent_record',
      'has_valid_until',
      'consent_revoked',
      'consent_record_id',
      'has_expiry_date',
      'contract_document_id',
      'contract_id',
      'version_id',
      'document_type',
    ]),
  ],
  ['billing_candidate', new Set(['export_format', 'export_surface_id'])],
  ['patients', new Set(['source'])],
  ['patient_list', new Set(['source'])],
  [
    'communication_request',
    new Set([
      'export_snapshot_id',
      'export_surface_id',
      'exported_request_id_hashes',
      'exported_request_count',
      'exported_request_id_hashes_truncated',
      'exported_patient_id_hashes',
      'exported_patient_count',
      'exported_patient_id_hashes_truncated',
    ]),
  ],
  ['pharmacy_drug_stock', new Set(['source'])],
  ['care_report', new Set(['surface', 'output_profile', 'report_updated_at'])],
  ['tracing_report', new Set(['surface', 'output_profile'])],
  ['visit_record', new Set(['surface', 'output_profile'])],
  ['conference_note', new Set(['surface', 'output_profile'])],
]);

const globalSafeFilterKeys = new Set([
  'status',
  'case_status',
  'targetType',
  'action',
  'from',
  'to',
  'truncated',
  'intake_count',
  'request_type',
  'profile',
  'redaction_profile',
  'riskTier',
  'care_report_rows_excluded',
  'purpose',
]);
const globalSafeMetadataKeys = new Set([
  ...[...allowedMetadataKeysByTarget.values()].flatMap((keys) => [...keys]),
  // Legacy audit rows may contain the downloaded file id inside changes.
  // New writes use target_id for file identity, but response/export redaction
  // can preserve this identifier when it is already present and value-safe.
  'file_id',
]);

export function isPlainAuditRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isBlockedExportAuditKey(key: string) {
  return !safePatientAggregateKeys.has(key) && blockedAuditKeyPattern.test(key);
}

export function isSafeExportAuditFormat(value: unknown): value is string {
  return typeof value === 'string' && safeExportAuditFormats.has(value);
}

export function sanitizeExportAuditScalar(value: unknown): unknown {
  if (typeof value === 'string') {
    if (blockedAuditValuePattern.test(value)) return undefined;
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  return undefined;
}

export function sanitizeExportAuditValue(value: unknown): unknown {
  const scalar = sanitizeExportAuditScalar(value);
  if (scalar !== undefined) return scalar;

  if (Array.isArray(value)) {
    const sanitizedValues = value
      .map((item) => sanitizeExportAuditScalar(item))
      .filter((item) => item !== undefined);
    return sanitizedValues.length === value.length ? sanitizedValues : undefined;
  }

  if (isPlainAuditRecord(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (isBlockedExportAuditKey(key)) continue;
      const sanitizedValue = sanitizeExportAuditValue(item);
      if (sanitizedValue !== undefined) {
        sanitized[key] = sanitizedValue;
      }
    }

    return sanitized;
  }

  return undefined;
}

function isLowerCodeString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    lowerCodePattern.test(value) &&
    !blockedAuditValuePattern.test(value)
  );
}

function isSafeIsoLikeString(value: unknown): value is string {
  if (!isLowerCodeString(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function sanitizeSafeCodeArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const sanitized = value.filter(isSafeHashOrPrefixedHash);
  return sanitized.length === value.length ? sanitized : undefined;
}

function sanitizeFailureCodes(value: unknown) {
  if (Array.isArray(value)) {
    return sanitizeSafeCodeArray(value);
  }

  if (!isPlainAuditRecord(value)) return undefined;
  const sanitized: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isLowerCodeString(key) && typeof item === 'number' && Number.isFinite(item)) {
      sanitized[key] = item;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeEnumValue(value: unknown, allowedValues: Set<string>) {
  return typeof value === 'string' && allowedValues.has(value) ? value : undefined;
}

function hasSafePrefix(value: string, prefixes: readonly string[]) {
  return prefixes.some(
    (prefix) => value.startsWith(`${prefix}_`) || value.startsWith(`${prefix}-`),
  );
}

function sanitizePrefixedId(value: unknown, prefixes: readonly string[]) {
  if (typeof value !== 'string' || blockedAuditValuePattern.test(value)) return undefined;
  if (uuidPattern.test(value)) return value;
  return lowerCodePattern.test(value) && hasSafePrefix(value, prefixes) ? value : undefined;
}

function isSafeHashOrPrefixedHash(value: unknown): value is string {
  if (typeof value !== 'string' || blockedAuditValuePattern.test(value)) return false;
  if (shaLikePattern.test(value)) return true;
  return (
    lowerCodePattern.test(value) &&
    hasSafePrefix(value, ['hash', 'patient', 'patient-hash', 'request', 'request-hash', 'snapshot'])
  );
}

function sanitizeExportAuditFieldValue(key: string, value: unknown): unknown {
  if (value === null) return null;

  if (numericKeys.has(key)) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  if (booleanKeys.has(key)) {
    return typeof value === 'boolean' ? value : undefined;
  }

  if (key === 'mime_type') {
    return typeof value === 'string' &&
      safeMimeTypePattern.test(value) &&
      !blockedAuditValuePattern.test(value)
      ? value
      : undefined;
  }

  if (key === 'from' || key === 'to') {
    return isSafeIsoLikeString(value) ? value : undefined;
  }

  if (key === 'failure_codes') {
    return sanitizeFailureCodes(value);
  }

  if (safeCodeArrayKeys.has(key)) {
    return sanitizeSafeCodeArray(value);
  }

  switch (key) {
    case 'job_id':
      return sanitizePrefixedId(value, ['job']);
    case 'file_id':
      return sanitizePrefixedId(value, ['contract_file', 'file']);
    case 'patient_selection_hash':
      return isSafeHashOrPrefixedHash(value) ? value : undefined;
    case 'export_snapshot_id':
      return isSafeHashOrPrefixedHash(value) ? value : undefined;
    case 'patient_share_consent_id':
      return sanitizePrefixedId(value, ['share_consent']);
    case 'share_case_id':
      return sanitizePrefixedId(value, ['share_case']);
    case 'consent_record_id':
      return sanitizePrefixedId(value, ['consent']);
    case 'contract_document_id':
      return sanitizePrefixedId(value, ['contract_document']);
    case 'contract_id':
      return sanitizePrefixedId(value, ['contract']);
    case 'version_id':
      return sanitizePrefixedId(value, ['version']);
    case 'status':
      return sanitizeEnumValue(value, safeStatusValues);
    case 'source':
      return sanitizeEnumValue(value, safeSourceValues);
    case 'export_format':
      return sanitizeEnumValue(value, safeExportFormatValues);
    case 'file_purpose':
    case 'purpose':
      return sanitizeEnumValue(value, safePurposeValues);
    case 'profile':
    case 'redaction_profile':
      return sanitizeEnumValue(value, safeProfileValues);
    case 'riskTier':
      return sanitizeEnumValue(value, safeRiskTierValues);
    case 'surface':
      return sanitizeEnumValue(value, safeSurfaceValues);
    case 'response_mode':
      return sanitizeEnumValue(value, safeResponseModeValues);
    case 'context_type':
      return sanitizeEnumValue(value, safeContextTypeValues);
    case 'document_type':
      return sanitizeEnumValue(value, safeDocumentTypeValues);
  }

  if (safeCodeStringKeys.has(key)) {
    return isLowerCodeString(value) ? value : undefined;
  }

  return undefined;
}

export function isReportPdfAuditTarget(
  targetType: string | null | undefined,
): targetType is ReportPdfAuditTarget {
  return Boolean(targetType && targetType in reportPdfMetadataProfileByTarget);
}

function isCanonicalIsoDateTime(value: string) {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function sanitizeReportPdfAuditMetadata(targetType: ReportPdfAuditTarget, values: unknown) {
  if (!isPlainAuditRecord(values)) return {};
  const profile = reportPdfMetadataProfileByTarget[targetType];
  const sanitized: Record<string, unknown> = {};

  if (values.surface === profile.surface) {
    sanitized.surface = profile.surface;
  }

  if (values.output_profile === profile.output_profile) {
    sanitized.output_profile = profile.output_profile;
  }

  if (
    profile.allowReportUpdatedAt &&
    typeof values.report_updated_at === 'string' &&
    isCanonicalIsoDateTime(values.report_updated_at)
  ) {
    sanitized.report_updated_at = values.report_updated_at;
  }

  return sanitized;
}

export function sanitizeExportAuditSection(args: {
  targetType: string | null | undefined;
  values: unknown;
  section: 'filters' | 'metadata';
  fallbackToGlobalKeys?: boolean;
}) {
  if (!isPlainAuditRecord(args.values)) return {};
  if (args.section === 'metadata' && isReportPdfAuditTarget(args.targetType)) {
    return sanitizeReportPdfAuditMetadata(args.targetType, args.values);
  }

  const keyMap =
    args.section === 'filters' ? allowedFilterKeysByTarget : allowedMetadataKeysByTarget;
  const fallbackKeys = args.section === 'filters' ? globalSafeFilterKeys : globalSafeMetadataKeys;
  const allowedKeys = args.targetType ? keyMap.get(args.targetType) : undefined;
  const effectiveAllowedKeys =
    allowedKeys ?? (args.fallbackToGlobalKeys ? fallbackKeys : undefined);
  if (!effectiveAllowedKeys) return {};

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args.values)) {
    if (!effectiveAllowedKeys.has(key)) continue;
    const sanitizedValue = sanitizeExportAuditFieldValue(key, value);
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue;
    }
  }

  return sanitized;
}
