export type AuditLogRiskTier = 'high' | 'standard';
export type AuditLogRedactionState = 'redacted' | 'minimized' | 'not_applicable';

export type AuditLogReviewFields = {
  risk_tier: AuditLogRiskTier;
  risk_label: string;
  risk_reasons: string[];
  redaction_state: AuditLogRedactionState;
};

type AuditLogForReview = {
  action: string;
  target_type?: string | null;
  changes?: unknown;
};

const HIGH_RISK_ACTIONS = [
  'break_glass',
  'export',
  'file_download',
  'audit_log_viewed',
  'consent_records_viewed',
  'consent_record_viewed',
  'patient_details_viewed',
  'care_report_print_requested',
  'care_report_delivery_attempted',
  'care_report.send',
  'care_report_confirmed',
  'patient_share_case_activated',
  'patient_share_consent_registered',
  'patient_share_consent_revoked',
  'patient_link_accepted',
  'pharmacy_invoice_issued',
  'pharmacy_invoice_sent',
  'pharmacy_invoice_cancelled',
] as const;

const HIGH_RISK_ACTION_FRAGMENTS = [
  'break_glass',
  'export',
  'download',
  'print',
  'send',
  'delivery',
  'share',
  'confirm',
  'approve',
  'delete',
  'revoke',
  'revoked',
  'cancel',
  'cancelled',
  'override',
] as const;

const EXTERNAL_SHARE_TARGETS = new Set([
  'PatientShareCase',
  'PatientShareConsent',
  'patient_share_consent',
  'PatientLink',
  'care_report',
  'CareReport',
  'file_asset',
]);

const PATIENT_DATA_TARGETS = new Set(['patient', 'consent_record']);
const BILLING_TARGETS = new Set(['billing_candidate', 'PharmacyInvoice']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function actionContains(action: string, fragment: string) {
  return action.toLowerCase().includes(fragment);
}

function hasRedactedMarker(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (key.endsWith('_redacted') && item === true) return true;
    if (key === 'redacted' && item === true) return true;
    if (hasRedactedMarker(item)) return true;
  }
  return false;
}

function classifyAuditLogRiskReasons(log: AuditLogForReview) {
  const reasons = new Set<string>();
  const action = log.action;
  const targetType = log.target_type ?? '';

  if ((HIGH_RISK_ACTIONS as readonly string[]).includes(action)) {
    reasons.add('high_risk_action');
  }

  if (actionContains(action, 'break_glass')) {
    reasons.add('break_glass');
  }

  if (
    actionContains(action, 'export') ||
    actionContains(action, 'download') ||
    actionContains(action, 'print')
  ) {
    reasons.add('data_output');
  }

  if (
    EXTERNAL_SHARE_TARGETS.has(targetType) &&
    (actionContains(action, 'share') ||
      actionContains(action, 'send') ||
      actionContains(action, 'delivery') ||
      actionContains(action, 'activated') ||
      actionContains(action, 'accepted') ||
      actionContains(action, 'registered') ||
      actionContains(action, 'revoked'))
  ) {
    reasons.add('external_share');
  }

  if (PATIENT_DATA_TARGETS.has(targetType) && actionContains(action, 'viewed')) {
    reasons.add('patient_data_access');
  }

  if (
    BILLING_TARGETS.has(targetType) &&
    (actionContains(action, 'confirm') ||
      actionContains(action, 'issued') ||
      actionContains(action, 'sent') ||
      actionContains(action, 'export') ||
      actionContains(action, 'cancel'))
  ) {
    reasons.add('billing_decision');
  }

  if (
    actionContains(action, 'delete') ||
    actionContains(action, 'revoke') ||
    actionContains(action, 'revoked') ||
    actionContains(action, 'cancel')
  ) {
    reasons.add('destructive_or_revocation');
  }

  if (actionContains(action, 'override')) {
    reasons.add('override');
  }

  if (targetType === 'audit_log' && actionContains(action, 'export')) {
    reasons.add('audit_export');
  }

  return [...reasons];
}

export function classifyAuditLogRisk(log: AuditLogForReview): {
  risk_tier: AuditLogRiskTier;
  risk_label: string;
  risk_reasons: string[];
} {
  const riskReasons = classifyAuditLogRiskReasons(log);
  if (riskReasons.length === 0) {
    return {
      risk_tier: 'standard',
      risk_label: '通常',
      risk_reasons: [],
    };
  }

  return {
    risk_tier: 'high',
    risk_label: '高リスク',
    risk_reasons: riskReasons,
  };
}

export function classifyAuditLogRedactionState(log: AuditLogForReview): AuditLogRedactionState {
  if (hasRedactedMarker(log.changes)) {
    return 'redacted';
  }

  if (log.action === 'export' || log.action === 'file_download') {
    return 'minimized';
  }

  return 'not_applicable';
}

export function enrichAuditLogForReview<T extends AuditLogForReview>(
  log: T,
): T & AuditLogReviewFields {
  return {
    ...log,
    ...classifyAuditLogRisk(log),
    redaction_state: classifyAuditLogRedactionState(log),
  };
}

export function enrichAuditLogsForReview<T extends AuditLogForReview>(
  logs: T[],
): Array<T & AuditLogReviewFields> {
  return logs.map(enrichAuditLogForReview);
}

export function isAuditLogRiskTier(value: string | null | undefined): value is AuditLogRiskTier {
  return value === 'high' || value === 'standard';
}

export function buildAuditLogRiskTierWhere(riskTier: AuditLogRiskTier) {
  const highRiskWhere = {
    OR: [
      { action: { in: [...HIGH_RISK_ACTIONS] } },
      ...HIGH_RISK_ACTION_FRAGMENTS.map((fragment) => ({
        action: { contains: fragment },
      })),
    ],
  };

  if (riskTier === 'high') {
    return highRiskWhere;
  }

  return {
    NOT: highRiskWhere,
  };
}
