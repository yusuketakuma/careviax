import type {
  AuditLogRedactionState,
  AuditLogReviewState,
  AuditLogRiskTier,
} from '@/lib/audit-logs/review';

export type AuditLogListRow = {
  id: string;
  actor_id: string;
  actor_name?: string;
  action: string;
  target_type: string;
  target_id: string;
  risk_tier: AuditLogRiskTier;
  risk_label: string;
  risk_reasons: string[];
  redaction_state: AuditLogRedactionState;
  review_state: AuditLogReviewState;
  reviewed_at: string | null;
  reviewed_by: string | null;
  ip_address: string | null;
  created_at: string;
};

export type AuditLogReviewDashboardSummary = {
  scope: 'filtered';
  generated_at: string;
  total_count: number;
  risk_tier: {
    high: number;
    standard: number;
  };
  review_state: {
    pending: number;
    reviewed: number;
  };
  high_risk: {
    total: number;
    pending_review: number;
    reviewed: number;
  };
  filters: {
    risk_tier: AuditLogRiskTier | null;
    review_state: AuditLogReviewState | null;
    target_type: string | null;
    action: string | null;
    date_from: string | null;
    date_to: string | null;
    actor_used: boolean;
    actor_pharmacy_used: boolean;
    actor_site_used: boolean;
    patient_used: boolean;
  };
};

export type AuditLogsResponse = {
  data: AuditLogListRow[];
  summary?: {
    high_risk_unreviewed_count: number;
    review_dashboard?: AuditLogReviewDashboardSummary;
  };
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};
