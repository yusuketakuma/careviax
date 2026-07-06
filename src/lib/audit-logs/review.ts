export type AuditLogRiskTier = 'high' | 'standard';
export type AuditLogRedactionState = 'redacted' | 'minimized' | 'not_applicable';
export type AuditLogReviewState = 'pending' | 'reviewed';
export const AUDIT_LOG_REVIEW_REASON_CODES = [
  'admin_reviewed',
  'expected_access',
  'policy_exception',
  'resolved_elsewhere',
  'false_positive',
] as const;
export type AuditLogReviewReasonCode = (typeof AUDIT_LOG_REVIEW_REASON_CODES)[number];

export type AuditLogReviewFields = {
  risk_tier: AuditLogRiskTier;
  risk_label: string;
  risk_reasons: string[];
  redaction_state: AuditLogRedactionState;
  review_state: AuditLogReviewState;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reason_code: AuditLogReviewReasonCode | null;
};

type AuditLogForReview = {
  id?: string;
  action: string;
  target_type?: string | null;
  changes?: unknown;
};

export type AuditLogReviewRecordLike = {
  audit_log_id: string;
  review_state: string;
  reviewed_at?: Date | string | null;
  reviewed_by?: string | null;
  reason_code?: string | null;
};

export const DEFAULT_AUDIT_LOG_REVIEW_REASON_CODE: AuditLogReviewReasonCode = 'admin_reviewed';

export const AUDIT_LOG_REVIEW_REASON_LABEL_MAP = {
  admin_reviewed: '内容確認済み（問題なし）',
  expected_access: '業務上想定された操作',
  policy_exception: '例外承認済み',
  resolved_elsewhere: '別対応で解決済み',
  false_positive: '誤検知として確認',
} as const satisfies Record<AuditLogReviewReasonCode, string>;

const HIGH_RISK_ACTIONS = [
  'break_glass',
  'export',
  'file_download',
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
  'visit_schedule_updated',
  'visit_schedule_reschedule_requested',
  'risk_finding_waived',
  'risk_finding_override_applied',
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
  'waive',
  'waived',
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

  if (actionContains(action, 'waive') || actionContains(action, 'waived')) {
    reasons.add('risk_waiver');
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
  review?: AuditLogReviewRecordLike | null,
): T & AuditLogReviewFields {
  const isReviewed = review?.review_state === 'reviewed';
  return {
    ...log,
    ...classifyAuditLogRisk(log),
    redaction_state: classifyAuditLogRedactionState(log),
    review_state: isReviewed ? 'reviewed' : 'pending',
    reviewed_at:
      isReviewed && review?.reviewed_at ? new Date(review.reviewed_at).toISOString() : null,
    reviewed_by: isReviewed ? (review.reviewed_by ?? null) : null,
    reason_code:
      isReviewed && isAuditLogReviewReasonCode(review?.reason_code) ? review.reason_code : null,
  };
}

export function enrichAuditLogsForReview<T extends AuditLogForReview>(
  logs: T[],
  reviews: AuditLogReviewRecordLike[] = [],
): Array<T & AuditLogReviewFields> {
  const reviewByAuditLogId = new Map(reviews.map((review) => [review.audit_log_id, review]));
  return logs.map((log) =>
    enrichAuditLogForReview(log, log.id ? reviewByAuditLogId.get(log.id) : null),
  );
}

export function isAuditLogRiskTier(value: string | null | undefined): value is AuditLogRiskTier {
  return value === 'high' || value === 'standard';
}

export function isAuditLogReviewState(
  value: string | null | undefined,
): value is AuditLogReviewState {
  return value === 'pending' || value === 'reviewed';
}

export function isAuditLogReviewReasonCode(
  value: string | null | undefined,
): value is AuditLogReviewReasonCode {
  return (
    typeof value === 'string' &&
    (AUDIT_LOG_REVIEW_REASON_CODES as readonly string[]).includes(value)
  );
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

export function buildAuditLogReviewStateWhere(reviewState: AuditLogReviewState, orgId: string) {
  const reviewedWhere = {
    reviews: {
      some: {
        org_id: orgId,
        review_state: 'reviewed',
      },
    },
  };

  if (reviewState === 'reviewed') {
    return reviewedWhere;
  }

  return {
    reviews: {
      none: {
        org_id: orgId,
        review_state: 'reviewed',
      },
    },
  };
}

export function buildAuditLogReviewerWhere(reviewedBy: string, orgId: string) {
  return {
    reviews: {
      some: {
        org_id: orgId,
        reviewed_by: reviewedBy,
      },
    },
  };
}
