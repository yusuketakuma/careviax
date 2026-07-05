import {
  isPlainAuditRecord,
  isSafeExportAuditFormat,
  sanitizeExportAuditSection,
} from '@/lib/audit/export-audit-sanitizer';

const REDACTED_REJECT_REASON = '却下理由の自由記載は出力対象外です';

const FORMULARY_CHANGE_REQUEST_AUDIT_ACTIONS = new Set([
  'pharmacy_drug_stock_change_requested',
  'pharmacy_drug_stock_change_approved',
  'pharmacy_drug_stock_change_rejected',
]);

const SENSITIVE_AUDIT_TARGET_TYPES = new Set([
  'patient',
  'consent_record',
  'PatientShareCase',
  'PatientShareConsent',
  'patient_share_consent',
  'PatientLink',
  'PatientShareCorrectionRequest',
  'patient_share_correction_request',
  'prescription',
  'PrescriptionIntake',
  'care_report',
  'CareReport',
  'billing_candidate',
  'PharmacyInvoice',
  'notification',
  'file_asset',
  'visit_record',
  'VisitRecord',
]);

const SAFE_AUDIT_CHANGE_STRING_KEYS = new Set([
  'id',
  'status',
  'old_status',
  'new_status',
  'target_id',
  'target_type',
  'workflow_state',
  'review_state',
  'resolution_state',
  'action',
  'source',
  'format',
  'role',
  'permission',
]);

const SAFE_AUDIT_CHANGE_ID_KEYS = /(^id$|_id$|Id$|_ids$|Ids$)/;
type AuditLogLike = {
  action: string;
  target_type?: string | null;
  changes: unknown;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isPlainAuditRecord(value);
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function minimizeExportAuditChanges(
  changes: Record<string, unknown>,
  targetType: string | null | undefined,
) {
  const minimized: Record<string, unknown> = {};

  if (isSafeExportAuditFormat(changes.format)) {
    minimized.format = changes.format;
  }

  if (typeof changes.record_count === 'number' || changes.record_count === null) {
    minimized.record_count = changes.record_count;
  }

  const filters = sanitizeExportAuditSection({
    targetType,
    values: changes.filters,
    section: 'filters',
    fallbackToGlobalKeys: true,
  });
  const metadata = sanitizeExportAuditSection({
    targetType,
    values: changes.metadata,
    section: 'metadata',
    fallbackToGlobalKeys: true,
  });
  minimized.filters = filters;
  minimized.metadata = metadata;

  if (
    !hasOwn(changes, 'format') &&
    !hasOwn(changes, 'record_count') &&
    Object.keys(filters).length === 0 &&
    Object.keys(metadata).length === 0
  ) {
    return {
      redacted: true,
      field_count: Object.keys(changes).length,
    };
  }

  return minimized;
}

function summarizeFreeText(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return {
      present: trimmed.length > 0,
      length: trimmed.length,
    };
  }

  return {
    present: value !== null && value !== undefined,
    length: 0,
  };
}

function minimizeFreeTextField(record: Record<string, unknown>, key: string) {
  if (!hasOwn(record, key)) {
    return null;
  }

  const summary = summarizeFreeText(record[key]);
  const minimized = { ...record };
  delete minimized[key];
  minimized[`${key}_present`] = summary.present;
  minimized[`${key}_length`] = summary.length;
  minimized[`${key}_redacted`] = true;
  return minimized;
}

function isSafeAuditCodeString(value: string) {
  return (
    /^[A-Za-z0-9_.:-]{1,128}$/.test(value) && !/(https?:\/\/|token|secret|signed\.)/i.test(value)
  );
}

function summarizeSensitiveString(value: string) {
  const trimmed = value.trim();
  return {
    present: trimmed.length > 0,
    length: trimmed.length,
    redacted: true,
  };
}

function minimizeSensitiveAuditValue(key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    if (
      (SAFE_AUDIT_CHANGE_STRING_KEYS.has(key) || SAFE_AUDIT_CHANGE_ID_KEYS.test(key)) &&
      isSafeAuditCodeString(value)
    ) {
      return value;
    }
    return summarizeSensitiveString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return {
      present: value.length > 0,
      count: value.length,
      redacted: true,
    };
  }

  if (isPlainRecord(value)) {
    const minimized: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      const nextValue = minimizeSensitiveAuditValue(nestedKey, nestedValue);
      if (isPlainRecord(nextValue) && 'redacted' in nextValue && 'length' in nextValue) {
        minimized[`${nestedKey}_present`] = nextValue.present;
        minimized[`${nestedKey}_length`] = nextValue.length;
        minimized[`${nestedKey}_redacted`] = true;
      } else if (isPlainRecord(nextValue) && 'redacted' in nextValue && 'count' in nextValue) {
        minimized[`${nestedKey}_present`] = nextValue.present;
        minimized[`${nestedKey}_count`] = nextValue.count;
        minimized[`${nestedKey}_redacted`] = true;
      } else {
        minimized[nestedKey] = nextValue;
      }
    }
    return minimized;
  }

  return undefined;
}

function minimizeSensitiveAuditChanges(changes: Record<string, unknown>) {
  const minimized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    const nextValue = minimizeSensitiveAuditValue(key, value);
    if (isPlainRecord(nextValue) && 'redacted' in nextValue && 'length' in nextValue) {
      minimized[`${key}_present`] = nextValue.present;
      minimized[`${key}_length`] = nextValue.length;
      minimized[`${key}_redacted`] = true;
    } else if (isPlainRecord(nextValue) && 'redacted' in nextValue && 'count' in nextValue) {
      minimized[`${key}_present`] = nextValue.present;
      minimized[`${key}_count`] = nextValue.count;
      minimized[`${key}_redacted`] = true;
    } else if (nextValue !== undefined) {
      minimized[key] = nextValue;
    }
  }
  return minimized;
}

export function minimizeFormularyChangeRequestAuditChanges(
  changes: Record<string, unknown>,
): Record<string, unknown> | null {
  let minimized: Record<string, unknown> | null = null;
  const ensureMinimized = () => {
    minimized ??= { ...changes };
    return minimized;
  };

  const requestedPayload = changes.requested_payload;
  if (isPlainRecord(requestedPayload)) {
    const nextPayload = minimizeFreeTextField(requestedPayload, 'adoption_note');
    if (nextPayload) {
      ensureMinimized().requested_payload = nextPayload;
    }
  }

  const currentSnapshot = changes.current_snapshot;
  if (isPlainRecord(currentSnapshot)) {
    const nextSnapshot = minimizeFreeTextField(currentSnapshot, 'adoption_note');
    if (nextSnapshot) {
      ensureMinimized().current_snapshot = nextSnapshot;
    }
  }

  for (const key of ['reason', 'decision_note']) {
    const nextChanges = minimizeFreeTextField(changes, key);
    if (nextChanges) {
      const next = ensureMinimized();
      delete next[key];
      next[`${key}_present`] = nextChanges[`${key}_present`];
      next[`${key}_length`] = nextChanges[`${key}_length`];
      next[`${key}_redacted`] = nextChanges[`${key}_redacted`];
    }
  }

  return minimized;
}

function isFormularyChangeRequestAuditLog(log: AuditLogLike) {
  return (
    log.target_type === 'FormularyChangeRequest' ||
    FORMULARY_CHANGE_REQUEST_AUDIT_ACTIONS.has(log.action)
  );
}

export function redactAuditLogChangesForResponse<T extends AuditLogLike>(log: T): T {
  if (!isPlainRecord(log.changes)) {
    return log;
  }

  if (isFormularyChangeRequestAuditLog(log)) {
    const changes = minimizeFormularyChangeRequestAuditChanges(log.changes);
    if (!changes) return log;
    return {
      ...log,
      changes,
    };
  }

  if (log.action === 'export' || log.action === 'file_download') {
    return {
      ...log,
      changes: minimizeExportAuditChanges(log.changes, log.target_type),
    };
  }

  if (log.action !== 'visit_schedule_proposal_rejected') {
    if (log.target_type && SENSITIVE_AUDIT_TARGET_TYPES.has(log.target_type)) {
      return {
        ...log,
        changes: minimizeSensitiveAuditChanges(log.changes),
      };
    }
    return log;
  }

  if (!hasOwn(log.changes, 'reject_reason')) {
    return log;
  }

  return {
    ...log,
    changes: {
      ...log.changes,
      reject_reason: REDACTED_REJECT_REASON,
      reject_reason_redacted: true,
    },
  };
}

export function redactAuditLogsForResponse<T extends AuditLogLike>(logs: T[]): T[] {
  return logs.map(redactAuditLogChangesForResponse);
}
