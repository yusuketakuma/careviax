const REDACTED_REJECT_REASON = '却下理由の自由記載は出力対象外です';

type AuditLogLike = {
  action: string;
  changes: unknown;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function redactAuditLogChangesForResponse<T extends AuditLogLike>(log: T): T {
  if (log.action !== 'visit_schedule_proposal_rejected' || !isPlainRecord(log.changes)) {
    return log;
  }

  if (!Object.prototype.hasOwnProperty.call(log.changes, 'reject_reason')) {
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
