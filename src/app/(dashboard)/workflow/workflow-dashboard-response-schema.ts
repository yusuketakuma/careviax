import { z } from 'zod';
import type { WorkflowData } from './workflow-dashboard.types';

const count = z.number().int().nonnegative();
const finiteNumber = z.number().finite();
const text = (max = 1_000) => z.string().trim().min(1).max(max);
const nullableText = (max = 1_000) => z.string().max(max).nullable();
const dateTime = z.string().datetime({ offset: true });
const temporal = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid date');
const internalHref = z
  .string()
  .max(2_000)
  .refine((value) => value.startsWith('/') && !value.startsWith('//'));
const priority = z.enum(['urgent', 'high', 'normal', 'low']);
const action = { action_href: internalHref, action_label: text(500) };

const communicationQueueSchema = z
  .object({
    summary: z
      .object({
        pending_count: count,
        overdue_count: count,
        self_reports: count,
        callback_followups: count,
        inbound_communications: count,
        open_requests: count,
        delivery_backlog: count,
        expiring_external_shares: count,
        unconfirmed_count: count,
        reply_waiting_count: count,
        failed_count: count,
      })
      .strict(),
    items: z
      .array(
        z
          .object({
            id: text(255),
            queue_type: text(200),
            title: text(),
            summary: text(4_000),
            channel: text(200),
            status: text(200),
            priority: z.enum(['urgent', 'high', 'normal']),
            patient_name: nullableText(),
            due_at: temporal.nullable(),
            ...action,
          })
          .strict(),
      )
      .max(100),
    timeline: z
      .array(
        z
          .object({
            id: text(255),
            source_type: z.enum([
              'care_report',
              'tracing_report',
              'communication_request',
              'delivery_record',
            ]),
            patient_name: nullableText(),
            title: text(),
            summary: text(4_000),
            status: text(200),
            occurred_at: temporal.nullable(),
            ...action,
          })
          .strict(),
      )
      .max(100),
    emergency_drafts: z
      .array(
        z
          .object({
            id: text(255),
            patient_id: text(255),
            template_key: text(255),
            request_type: text(255),
            target_name: nullableText(),
            target_role: text(255),
            title: text(),
            summary: text(4_000),
            subject: text(),
            content: text(20_000),
            ...action,
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

const homeCareFeatureSchema = z
  .object({
    key: z.enum([
      'emergency_medication_playbook',
      'after_hours_rotation_board',
      'home_visit_gap_detection',
      'previsit_preparation_pack',
      'emergency_contact_template',
      'adherence_residual_triage',
      'medication_safety_prioritizer',
      'dosage_form_support',
      'caregiver_self_report_intake',
      'carry_item_fallback',
      'multidisciplinary_share_summary',
      'inquiry_workbench',
      'facility_batch_tracker',
      'consent_plan_huddle',
      'refill_auto_revisit',
      'callback_sla_monitor',
      'change_delta_view',
      'billing_blocker_alert',
      'regional_resource_map',
      'mobile_visit_mode',
    ]),
    title: text(),
    description: text(4_000),
    group: z.enum(['emergency', 'preparation', 'communication', 'safety', 'continuity']),
    action_href: internalHref,
    action_label: text(500),
    status: z.enum(['ready', 'monitoring', 'attention', 'blocked']),
    severity: priority,
    count,
    summary: text(4_000),
    evidence: z.array(text(2_000)).max(50),
  })
  .strict();

const workflowDataSchema = z
  .object({
    cycle_status_counts: z.record(z.string().trim().min(1).max(200), count),
    workflow_exceptions: z
      .object({
        open: count,
        items: z
          .array(
            z
              .object({
                id: text(255),
                exception_type: text(200),
                description: text(4_000),
                severity: text(100),
                patient_name: nullableText(),
                created_at: dateTime,
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
    communication_requests: z.object({ pending: count, overdue: count }).strict(),
    delivery: z.object({ failures: count }).strict(),
    visit_operations: z
      .object({
        overdue: count,
        awaiting_reports: count,
        missing_visit_consent: count,
        missing_management_plan: count,
        missing_first_visit_doc: count,
        missing_emergency_contact: count,
        missing_primary_physician: count,
      })
      .strict(),
    operations_queue: z
      .object({
        visit_demands: count,
        callback_followups: count,
        management_plan_reviews: count,
        preparation_pending: count,
        geocode_reviews: count,
        intake_linkages: count,
        self_reports_triage: count,
      })
      .strict(),
    role_inboxes: z
      .object({
        current_role: text(100),
        buckets: z
          .array(
            z
              .object({
                role: z.enum(['pharmacist', 'clerk', 'admin']),
                label: text(),
                open_items: count,
                urgent_items: count,
                communication_items: count,
                action_href: internalHref,
              })
              .strict(),
          )
          .max(3),
      })
      .strict(),
    communication_queue: communicationQueueSchema,
    patient_risk_queue: z
      .object({
        high_risk_count: count,
        items: z
          .array(
            z
              .object({
                patient_id: text(255),
                patient_name: text(),
                score: finiteNumber.nonnegative(),
                level: z.enum(['stable', 'watch', 'high']),
                reasons: z.array(text(2_000)).max(50),
                unresolved_self_reports: count,
                open_issues: count,
                disrupted_visits_30d: count,
                pending_reports: count,
                open_tasks: count,
                missing_visit_consent: z.boolean(),
                missing_management_plan: z.boolean(),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
    inquiry_workbench: z
      .array(
        z
          .object({
            id: text(255),
            item_type: z.enum(['issue', 'inquiry']),
            inquiry_id: nullableText(255),
            issue_id: nullableText(255),
            line_id: nullableText(255),
            cycle_id: nullableText(255),
            case_id: nullableText(255),
            patient_id: text(255),
            patient_name: text(),
            title: text(),
            summary: text(4_000),
            reason: text(4_000),
            inquiry_to_physician: text(4_000),
            proposal_origin: z.enum(['post_inquiry', 'pre_issuance']).nullable(),
            residual_adjustment: z.boolean().nullable(),
            change_detail: nullableText(4_000),
            line: z
              .object({
                id: text(255),
                drug_name: text(),
                dose: text(),
                frequency: text(),
                days: count,
              })
              .strict()
              .nullable(),
            request_status: nullableText(200),
            queue_state: text(200),
            due_at: temporal.nullable(),
            created_at: dateTime,
            can_create: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    remediation_guidance: z
      .array(
        z
          .object({
            id: text(255),
            title: text(),
            description: text(4_000),
            severity: z.enum(['urgent', 'high', 'normal']),
            count,
            ...action,
          })
          .strict(),
      )
      .max(50),
    unified_workbench: z
      .array(
        z
          .object({
            id: text(255),
            item_type: z.enum(['task', 'proposal', 'visit', 'self_report', 'aggregate']),
            queue_label: text(),
            title: text(),
            summary: text(4_000),
            priority,
            due_at: temporal.nullable(),
            ...action,
            owner_name: nullableText(),
            patient_name: nullableText(),
            badges: z.array(text(500)).max(30),
          })
          .strict(),
      )
      .max(100),
    facility_visibility: z
      .object({
        clusters: z
          .array(
            z
              .object({
                id: text(1_000),
                date: dateTime,
                label: text(),
                site_name: nullableText(),
                pharmacist_name: nullableText(),
                patient_count: count,
                patient_names: z.array(text()).max(100),
                route_window: text(100),
              })
              .strict(),
          )
          .max(6),
      })
      .strict(),
    exception_command_center: z
      .array(
        z
          .object({
            id: text(255),
            type: text(200),
            severity: text(100),
            title: text(),
            description: text(4_000),
            patient_name: nullableText(),
            created_at: temporal.nullable(),
            ...action,
          })
          .strict(),
      )
      .max(8),
    workload_metrics: z
      .object({
        pharmacists: z
          .array(
            z
              .object({
                pharmacist_id: text(255),
                pharmacist_name: text(),
                confirmed_visits: count,
                pending_tasks: count,
                urgent_items: count,
                callback_followups: count,
                facility_clusters: count,
              })
              .strict(),
          )
          .max(6),
      })
      .strict(),
    route_operations: z
      .object({
        locked_confirmed_visits: count,
        fallback_assignments: count,
        override_pending: count,
        emergency_candidates: count,
      })
      .strict(),
    outcome_metrics: z
      .object({
        completed_last_7_days: count,
        disrupted_last_7_days: count,
        urgent_completed_last_7_days: count,
        awaiting_reports: count,
        open_exceptions: count,
      })
      .strict(),
    route_control: z
      .object({
        locked_schedules: count,
        pending_override_requests: count,
        emergency_impact_items: count,
      })
      .strict(),
    after_hours_readiness: z
      .object({
        emergency_capable_shift_count: count,
        holiday_gap_count: count,
        holiday_gaps: z
          .array(
            z
              .object({
                id: text(255),
                date: dateTime,
                name: text(),
                site_id: nullableText(255),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
    inventory_readiness: z.object({ blocked: count, partial: count }).strict(),
    regional_pipeline: z
      .object({
        follow_up_activities: count,
        conference_action_items: count,
        intake_cases: count,
        top_followups: z
          .array(
            z
              .object({
                id: text(255),
                title: text(),
                partner_name: nullableText(),
                activity_type: text(200),
                activity_date: dateTime,
                referrals_generated: count.nullable(),
              })
              .strict(),
          )
          .max(5),
      })
      .strict(),
    billing_prevention: z
      .object({
        previsit_blockers: count,
        review_tasks: count,
        report_delivery_backlog: count,
      })
      .strict(),
    home_care_feature_summary: z
      .object({
        totals: z
          .object({ blocked: count, attention: count, monitoring: count, ready: count })
          .strict(),
        features: z.array(homeCareFeatureSchema).max(20),
      })
      .strict(),
    intake_linkage: z
      .array(
        z
          .object({
            id: text(255),
            patient_name: text(),
            reason: text(4_000),
            due_at: temporal.nullable(),
            ...action,
            category: text(200),
          })
          .strict(),
      )
      .max(6),
    conference_follow_ups: z.object({ pending_tasks: count, undelivered_reports: count }).strict(),
    self_reports: z
      .array(
        z
          .object({
            id: text(255),
            patient_name: text(),
            reported_by_name: text(),
            relation: nullableText(),
            subject: text(),
            category: text(200),
            requested_callback: z.boolean(),
            preferred_contact_time: nullableText(),
            status: text(200),
            created_at: dateTime,
          })
          .strict(),
      )
      .max(100),
    refill_upcoming: z
      .array(
        z
          .object({
            id: text(255),
            cycle_id: text(255),
            case_id: nullableText(255),
            upcoming_kind: z.enum(['refill', 'split']),
            remaining_count: count,
            refill_remaining_count: count,
            split_dispense_total: count.nullable(),
            split_dispense_current: count.nullable(),
            prescribed_date: temporal,
            refill_next_dispense_date: temporal.nullable(),
            split_next_dispense_date: temporal.nullable(),
            next_dispense_date: temporal.nullable(),
            suggested_start_date: temporal.nullable(),
            has_existing_route: z.boolean(),
            cycle: z
              .object({
                patient_id: text(255),
                case_: z
                  .object({ patient: z.object({ id: text(255), name: text() }).strict() })
                  .strict(),
              })
              .strict(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .superRefine((data, context) => {
    const unique = <T>(items: T[], key: (item: T) => string) =>
      new Set(items.map(key)).size === items.length;
    const featuresByStatus = data.home_care_feature_summary.features.reduce(
      (totals, feature) => ({ ...totals, [feature.status]: totals[feature.status] + 1 }),
      { blocked: 0, attention: 0, monitoring: 0, ready: 0 },
    );
    if (
      data.patient_risk_queue.high_risk_count !==
        data.patient_risk_queue.items.filter((item) => item.level === 'high').length ||
      data.facility_visibility.clusters.some(
        (cluster) => cluster.patient_count !== cluster.patient_names.length,
      ) ||
      data.after_hours_readiness.holiday_gap_count !==
        data.after_hours_readiness.holiday_gaps.length ||
      Object.entries(featuresByStatus).some(
        ([status, value]) =>
          data.home_care_feature_summary.totals[
            status as keyof typeof data.home_care_feature_summary.totals
          ] !== value,
      ) ||
      !unique(data.workflow_exceptions.items, (item) => item.id) ||
      !unique(data.communication_queue.items, (item) => item.id) ||
      !unique(data.communication_queue.timeline, (item) => `${item.source_type}:${item.id}`) ||
      !unique(data.communication_queue.emergency_drafts, (item) => item.id) ||
      !unique(data.patient_risk_queue.items, (item) => item.patient_id) ||
      !unique(data.inquiry_workbench, (item) => item.id) ||
      !unique(data.unified_workbench, (item) => item.id) ||
      !unique(data.home_care_feature_summary.features, (item) => item.key) ||
      !unique(data.self_reports, (item) => item.id) ||
      !unique(data.refill_upcoming, (item) => item.id)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Workflow dashboard aggregate or identity drift',
      });
    }
  });

export const workflowDashboardResponseSchema = z
  .object({ data: workflowDataSchema })
  .strict()
  .transform(({ data }): { data: WorkflowData } => {
    const { conference_follow_ups: _unusedConferenceFollowUps, ...consumed } = data;
    void _unusedConferenceFollowUps;
    return { data: consumed };
  });
