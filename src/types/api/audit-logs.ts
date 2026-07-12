import { z } from 'zod';
import type {
  AuditLogRedactionState,
  AuditLogReviewReasonCode,
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
  reason_code: AuditLogReviewReasonCode | null;
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
    reviewed_by_used: boolean;
  };
};

export type AuditLogsResponse = {
  data: AuditLogListRow[];
  meta?: {
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
};

const auditLogListRowSchema = z.custom<AuditLogListRow>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.action === 'string' &&
    typeof row.target_type === 'string' &&
    typeof row.target_id === 'string' &&
    typeof row.created_at === 'string'
  );
});

const auditLogReviewDashboardSummarySchema: z.ZodType<AuditLogReviewDashboardSummary> = z
  .object({
    scope: z.literal('filtered'),
    generated_at: z.string(),
    total_count: z.number().int().nonnegative(),
    risk_tier: z.object({ high: z.number(), standard: z.number() }).strict(),
    review_state: z.object({ pending: z.number(), reviewed: z.number() }).strict(),
    high_risk: z
      .object({
        total: z.number(),
        pending_review: z.number(),
        reviewed: z.number(),
      })
      .strict(),
    filters: z
      .object({
        risk_tier: z.enum(['high', 'standard']).nullable(),
        review_state: z.enum(['pending', 'reviewed']).nullable(),
        target_type: z.string().nullable(),
        action: z.string().nullable(),
        date_from: z.string().nullable(),
        date_to: z.string().nullable(),
        actor_used: z.boolean(),
        actor_pharmacy_used: z.boolean(),
        actor_site_used: z.boolean(),
        patient_used: z.boolean(),
        reviewed_by_used: z.boolean(),
      })
      .strict(),
  })
  .strict();

const auditLogsMetaSchema = z
  .object({
    summary: z
      .object({
        high_risk_unreviewed_count: z.number().int().nonnegative(),
        review_dashboard: auditLogReviewDashboardSummarySchema.optional(),
      })
      .strict()
      .optional(),
    pagination: z
      .object({
        total: z.number().int().nonnegative(),
        page: z.number().int().positive(),
        limit: z.number().int().positive(),
        totalPages: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function auditLogsResponseSchemaFor<T extends z.ZodTypeAny>(rowSchema: T) {
  return z
    .object({
      data: z.array(rowSchema),
      meta: auditLogsMetaSchema.optional(),
    })
    .strict();
}

export const auditLogsResponseSchema: z.ZodType<AuditLogsResponse> =
  auditLogsResponseSchemaFor(auditLogListRowSchema);

export function auditLogReviewResponseSchemaFor(expectedAuditLogId: string) {
  return z
    .object({
      data: z
        .object({
          audit_log_id: z.string().min(1),
          review_state: z.enum(['reviewed', 'pending']),
        })
        .strip(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      if (data.audit_log_id !== expectedAuditLogId) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'audit_log_id'],
          message: 'Audit log review response identity must match the requested audit log',
        });
      }
    });
}

export type AuditLogReviewResponse = z.infer<ReturnType<typeof auditLogReviewResponseSchemaFor>>;
