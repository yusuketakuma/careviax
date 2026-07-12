import { z } from 'zod';
import type {
  ReportInboundCandidateAction,
  ReportsTodayWorkspaceResponse,
} from '@/types/reports-today-workspace';

const count = z.number().int().nonnegative();
const text = (max = 1_000) => z.string().trim().min(1).max(max);
const nullableText = (max = 1_000) => z.string().max(max).nullable();
const dateTime = z.string().datetime({ offset: true });
const internalHref = z
  .string()
  .max(2_000)
  .refine((value) => value.startsWith('/') && !value.startsWith('//'));
const actionSchema = z.object({ label: text(500), href: internalHref }).strict();

const failedDeliverySchema = z
  .object({
    delivery_record_id: text(255),
    recipient_label: text(),
    channel: text(100),
    failure_reason: nullableText(4_000),
    retry_count: count,
    failed_at: dateTime,
    action: actionSchema,
  })
  .strict();

const workspaceCountSchema = z
  .object({
    total_count: count,
    visible_count: count,
    hidden_count: count,
    limit: count.nullable(),
    truncated: z.boolean(),
    count_basis: z.enum(['full_result', 'database_total', 'derived_visible_window']),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.total_count !== value.visible_count + value.hidden_count ||
      value.truncated !== value.hidden_count > 0 ||
      (value.limit !== null && value.visible_count > value.limit)
    )
      context.addIssue({ code: 'custom', message: 'Workspace count metadata drift' });
  });

const reportOpenIssueSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: text(255),
      kind: z.literal('report'),
      severity: z.enum(['critical', 'warning', 'info']),
      title: text(),
      description: text(4_000),
      action: actionSchema,
      report_id: text(255),
      failed_delivery: failedDeliverySchema.nullable().optional(),
    })
    .strict(),
  z
    .object({
      id: text(255),
      kind: z.literal('billing_candidate'),
      severity: z.enum(['critical', 'warning', 'info']),
      title: text(),
      description: text(4_000),
      action: actionSchema,
      billing_candidate_id: text(255),
      patient_id: nullableText(255),
    })
    .strict(),
]);

const workspaceDataSchema = z
  .object({
    generated_at: dateTime,
    draft_rows: z
      .array(
        z
          .object({
            id: text(255),
            time_start: dateTime.nullable(),
            patient_label: text(),
            recipient_label: text(),
            status: z.enum(['before_visit', 'ready_to_generate', 'draft_ready', 'report_existing']),
            visit_record_id: nullableText(255),
            visit_record_updated_at: dateTime.nullable(),
            note: nullableText(4_000),
            generation_targets: z
              .array(
                z
                  .object({
                    report_type: z.enum([
                      'physician_report',
                      'care_manager_report',
                      'nurse_share',
                      'facility_handoff',
                    ]),
                    label: text(500),
                  })
                  .strict(),
              )
              .max(4),
            action: actionSchema.nullable(),
          })
          .strict()
          .superRefine((row, context) => {
            if ((row.visit_record_id === null) !== (row.visit_record_updated_at === null))
              context.addIssue({ code: 'custom', message: 'Draft visit-record identity drift' });
          }),
      )
      .max(100),
    waiting_replies: z
      .array(
        z
          .object({
            id: text(255),
            kind: z.enum(['report_delivery', 'inquiry']),
            waiting_days: count,
            title: text(),
            subtitle: nullableText(4_000),
            actions: z
              .array(
                z
                  .object({
                    label: text(500),
                    href: internalHref,
                    kind: z.enum(['button', 'link']),
                  })
                  .strict(),
              )
              .max(10),
          })
          .strict(),
      )
      .max(100),
    resolved_today: z
      .array(
        z
          .object({
            id: text(255),
            received_at: dateTime,
            title: text(),
            subtitle: text(4_000),
            action: actionSchema,
          })
          .strict(),
      )
      .max(100),
    created_reports: z
      .array(
        z
          .object({
            id: text(255),
            patient_id: nullableText(255),
            patient_label: text(),
            report_type: text(200),
            report_type_label: text(),
            status: text(100),
            status_label: text(),
            title: text(),
            created_at: dateTime,
            updated_at: dateTime,
            reported_to_professional: z.boolean(),
            last_sent_at: dateTime.nullable(),
            last_recipient_label: nullableText(),
            last_channel: nullableText(100),
            failed_delivery: failedDeliverySchema.nullable(),
            action: actionSchema,
          })
          .strict(),
      )
      .max(100),
    open_issues: z.array(reportOpenIssueSchema).max(100),
    inbound_report_candidates: z
      .array(
        z
          .object({
            id: text(255),
            signal_id: text(255),
            inbound_event_id: text(255),
            patient_id: nullableText(255),
            case_id: nullableText(255),
            patient_label: text(),
            source_channel: z.enum(['phone', 'fax', 'email', 'mcs', 'manual']),
            source_label: text(),
            received_at: dateTime,
            normalized_summary: text(8_000),
            review_status: z.enum(['needs_review', 'auto_accepted', 'accepted']),
            action_status: z.literal('not_linked'),
            decision: z.enum(['needs_decision', 'include_pending_report']),
          })
          .strip(),
      )
      .max(100),
    counts: z
      .object({
        to_write: count,
        waiting: count,
        resolved: count,
        created: count,
        open_issues: count,
        report_candidates: count,
      })
      .strict(),
    count_metadata: z
      .object({
        to_write: workspaceCountSchema,
        waiting: workspaceCountSchema,
        resolved: workspaceCountSchema,
        created: workspaceCountSchema,
        open_issues: workspaceCountSchema,
        report_candidates: workspaceCountSchema,
      })
      .strict(),
    evidence: z.object({ template_count: count, monthly_delivery_count: count }).strict(),
    action_rail: z
      .object({
        next_action: z
          .object({
            description: text(4_000).optional(),
            actionLabel: text(500),
            actionHref: internalHref.optional(),
          })
          .strict(),
        blocked_reasons: z
          .array(
            z
              .object({
                id: text(255),
                label: text(4_000),
                severity: z.enum(['critical', 'warning']),
                categoryLabel: text(500).optional(),
                ageLabel: text(500).optional(),
                actionLabel: text(500).optional(),
                actionHref: internalHref.optional(),
              })
              .strict()
              .superRefine((item, context) => {
                if ((item.actionLabel === undefined) !== (item.actionHref === undefined))
                  context.addIssue({ code: 'custom', message: 'Blocked reason action drift' });
              }),
          )
          .max(100),
        evidence: z
          .array(
            z
              .object({
                id: text(255),
                label: text(4_000),
                meta: text(1_000).optional(),
                href: internalHref.optional(),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((data, context) => {
    const sections = {
      to_write: data.draft_rows,
      waiting: data.waiting_replies,
      resolved: data.resolved_today,
      created: data.created_reports,
      open_issues: data.open_issues,
      report_candidates: data.inbound_report_candidates,
    };
    const unique = (items: Array<{ id: string }>) =>
      new Set(items.map((item) => item.id)).size === items.length;
    if (
      Object.entries(sections).some(
        ([key, items]) =>
          data.counts[key as keyof typeof data.counts] !==
            data.count_metadata[key as keyof typeof data.count_metadata].total_count ||
          data.count_metadata[key as keyof typeof data.count_metadata].visible_count !==
            items.length ||
          !unique(items),
      ) ||
      new Set(data.inbound_report_candidates.map((item) => item.signal_id)).size !==
        data.inbound_report_candidates.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Workspace section aggregate or identity drift',
      });
  });

export const reportsTodayWorkspaceResponseSchema = z
  .object({ data: workspaceDataSchema })
  .strict()
  .transform(({ data }): { data: ReportsTodayWorkspaceResponse } => ({ data }));

export function buildReportInboundCandidateDecisionResponseSchema(args: {
  signalId: string;
  action: ReportInboundCandidateAction;
}) {
  const expected =
    args.action === 'include_in_report'
      ? { reviewStatus: 'accepted', actionStatus: 'not_linked' }
      : { reviewStatus: 'record_only', actionStatus: 'ignored' };
  return z
    .object({
      data: z
        .object({
          signal_id: z.literal(args.signalId),
          inbound_event_id: text(255),
          review_status: z.enum(['accepted', 'record_only']),
          action_status: z.enum(['not_linked', 'ignored']),
          reviewed_at: dateTime.nullable(),
          review_task_closure_count: count,
        })
        .strict(),
      meta: z.object({ generated_at: dateTime }).strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      if (
        data.review_status !== expected.reviewStatus ||
        data.action_status !== expected.actionStatus
      )
        context.addIssue({ code: 'custom', message: 'Report candidate decision drift' });
    });
}
