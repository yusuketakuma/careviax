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
