import { z } from 'zod';
import type { PatientOperationalSummary } from '@/lib/patient/operational-summary';
import type { ScheduleDayBoardResponse } from '@/types/schedule-day-board';

const id = z.string().trim().min(1).max(200);
const label = z.string().trim().min(1).max(500);
const nullableLabel = z.string().max(1_000).nullable();
const dateKey = z.string().date();
const dateTime = z.string().datetime({ offset: true });
const nonnegativeInt = z.number().int().nonnegative();

const archiveSchema = z
  .object({
    status: z.enum(['active', 'archived']),
    archived: z.boolean(),
    archived_at: dateTime.nullable(),
  })
  .strict()
  .superRefine((archive, context) => {
    if (
      archive.archived !== (archive.status === 'archived') ||
      archive.archived !== (archive.archived_at !== null)
    )
      context.addIssue({ code: 'custom', message: 'Patient archive state drift' });
  });

const patientOperationalSummarySchema = z.custom<PatientOperationalSummary>((value) => {
  const parsed = z
    .object({
      patient_id: id,
      name: label,
      archive: archiveSchema,
      insurance: z
        .object({
          current: z.array(z.record(z.string(), z.unknown())).max(20),
          current_count: nonnegativeInt,
          missing: z.boolean(),
          expires_soon_count: nonnegativeInt,
        })
        .strict(),
      safety: z
        .object({
          has_allergy: z.boolean(),
          allergy_label: nullableLabel,
          critical_lab_count: nonnegativeInt,
          stale_lab_count: nonnegativeInt,
          lab_flags: z
            .array(
              z
                .object({
                  analyte_code: label,
                  analyte_label: label,
                  value_label: label,
                  measured_at: z.string().min(1).max(100),
                  abnormal: z.boolean(),
                  stale: z.boolean(),
                  abnormal_flag: z.string().max(100).nullable(),
                })
                .strict(),
            )
            .max(3),
        })
        .strict(),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success) return false;
  const { insurance, safety } = parsed.data;
  return (
    insurance.current_count === insurance.current.length &&
    insurance.missing === (insurance.current_count === 0) &&
    insurance.expires_soon_count <= insurance.current_count &&
    safety.has_allergy === (safety.allergy_label !== null) &&
    safety.critical_lab_count >= safety.lab_flags.filter((flag) => flag.abnormal).length &&
    safety.stale_lab_count >= safety.lab_flags.filter((flag) => flag.stale).length
  );
});

const preparationBlockerSchema = z
  .object({
    blocked: z.boolean(),
    blocker_count: nonnegativeInt,
    category_labels: z.array(label).max(20),
    preparation_blocker_count: nonnegativeInt,
    onboarding_blocker_count: nonnegativeInt,
    billing_blocker_count: nonnegativeInt,
  })
  .strict()
  .superRefine((summary, context) => {
    const total =
      summary.preparation_blocker_count +
      summary.onboarding_blocker_count +
      summary.billing_blocker_count;
    if (summary.blocker_count !== total || summary.blocked !== total > 0)
      context.addIssue({ code: 'custom', message: 'Preparation blocker aggregate drift' });
  });

const preparationSummarySchema = z
  .object({
    completed_count: nonnegativeInt,
    total_count: nonnegativeInt,
    status: z.enum(['ready', 'incomplete', 'blocked', 'unknown']),
    incomplete_labels: z.array(label).max(50),
    ready_blocker_summary: preparationBlockerSchema.optional(),
    aggregate_visit_count: nonnegativeInt.optional(),
    incomplete_visit_count: nonnegativeInt.optional(),
    blocked_visit_count: nonnegativeInt.optional(),
    unknown_visit_count: nonnegativeInt.optional(),
  })
  .strict()
  .superRefine((summary, context) => {
    if (summary.completed_count > summary.total_count)
      context.addIssue({ code: 'custom', message: 'Preparation completion count drift' });
    if (summary.status === 'ready' && summary.completed_count !== summary.total_count)
      context.addIssue({ code: 'custom', message: 'Ready preparation is incomplete' });
  });

const visitSchema = z
  .object({
    id,
    display_id: z.string().max(200).nullable().optional(),
    case_display_id: z.string().max(200).nullable().optional(),
    patient_id: id.optional(),
    patient_display_id: z.string().max(200).nullable().optional(),
    patient_name: label,
    patient_archive: archiveSchema.nullable().optional(),
    patient_summary: patientOperationalSummarySchema.nullable().optional(),
    visit_type: label,
    schedule_status: label,
    priority: label,
    site_id: id.nullable(),
    route_order: nonnegativeInt.nullable(),
    time_start: dateTime.nullable(),
    time_end: dateTime.nullable(),
    vehicle_resource_id: id.nullable(),
    vehicle_label: nullableLabel,
    vehicle_travel_mode: nullableLabel,
    confirmed: z.boolean(),
    facility_label: nullableLabel,
    facility_batch_id: id.nullable(),
    facility_patient_count: z.number().int().positive(),
    preparation_summary: preparationSummarySchema,
  })
  .strict()
  .superRefine((visit, context) => {
    if (
      (visit.time_start === null) !== (visit.time_end === null) ||
      (visit.time_start && visit.time_end && visit.time_end <= visit.time_start) ||
      (visit.vehicle_resource_id === null) !== (visit.vehicle_label === null) ||
      (visit.facility_batch_id === null) !== (visit.facility_label === null) ||
      (visit.patient_id && visit.patient_summary?.patient_id !== visit.patient_id) ||
      (visit.patient_summary && visit.patient_summary.name !== visit.patient_name)
    )
      context.addIssue({ code: 'custom', message: 'Visit relation or time-window drift' });
  });

const staffSchema = z
  .object({
    id,
    name: label,
    role: z.enum(['owner', 'admin', 'pharmacist', 'pharmacist_trainee', 'clerk']),
    role_kind: z.enum(['pharmacist', 'clerk']),
    visits: z.array(visitSchema).max(200),
    open_task_count: nonnegativeInt,
    audit_task_count: nonnegativeInt,
  })
  .strict()
  .superRefine((staff, context) => {
    if (
      (staff.role === 'clerk') !== (staff.role_kind === 'clerk') ||
      new Set(staff.visits.map((visit) => visit.id)).size !== staff.visits.length
    )
      context.addIssue({ code: 'custom', message: 'Staff role or visit identity drift' });
  });

const vehicleSchema = z
  .object({
    id,
    label,
    site_id: id.nullable(),
    vehicle_code: z.string().max(200).nullable(),
    travel_mode: label,
    available: z.boolean(),
    max_stops: nonnegativeInt,
    max_route_duration_minutes: nonnegativeInt.nullable(),
    assigned_visit_count: nonnegativeInt,
    remaining_stops: nonnegativeInt,
    route_duration_minutes: nonnegativeInt.nullable(),
    route_duration_status: z.enum(['within_limit', 'exceeded', 'unverified', 'not_limited']),
    route_duration_label: label,
    recommended: z.boolean(),
    recommendation_reason: label,
  })
  .passthrough()
  .transform(
    ({
      id,
      label,
      site_id,
      vehicle_code,
      travel_mode,
      available,
      max_stops,
      max_route_duration_minutes,
      assigned_visit_count,
      remaining_stops,
      route_duration_minutes,
      route_duration_status,
      route_duration_label,
      recommended,
      recommendation_reason,
    }) => ({
      id,
      label,
      site_id,
      vehicle_code,
      travel_mode,
      available,
      max_stops,
      max_route_duration_minutes,
      assigned_visit_count,
      remaining_stops,
      route_duration_minutes,
      route_duration_status,
      route_duration_label,
      recommended,
      recommendation_reason,
    }),
  );

const proposalSchema = z
  .object({
    id,
    display_id: z.string().max(200).nullable().optional(),
    case_display_id: z.string().max(200).nullable().optional(),
    patient_id: id.optional(),
    patient_display_id: z.string().max(200).nullable().optional(),
    patient_name: label,
    patient_archive: archiveSchema.nullable().optional(),
    patient_summary: patientOperationalSummarySchema.nullable().optional(),
    pharmacist_name: nullableLabel,
    patient_contact_status: z.enum([
      'pending',
      'attempted',
      'confirmed',
      'declined',
      'change_requested',
      'unreachable',
    ]),
    proposed_date: dateKey,
    time_start: dateTime.nullable(),
    badge_label: label,
    response_due_at: dateTime.nullable(),
    idle_before_minutes: nonnegativeInt.nullable(),
    idle_after_minutes: nonnegativeInt.nullable(),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (
      (proposal.patient_id && proposal.patient_summary?.patient_id !== proposal.patient_id) ||
      (proposal.patient_summary && proposal.patient_summary.name !== proposal.patient_name)
    )
      context.addIssue({ code: 'custom', message: 'Proposal patient relation drift' });
  });

const inboundRequestSchema = z
  .object({
    signal_id: id,
    signal_type: z.enum(['schedule_change_request', 'visit_request', 'unknown']),
    source_channel: z.enum(['mcs', 'phone', 'fax', 'email', 'manual']),
    received_at: dateTime,
    review_status: z.enum(['needs_review', 'auto_accepted', 'accepted']),
    action_status: z.literal('not_linked'),
    patient_linked: z.boolean(),
    case_linked: z.boolean(),
  })
  .strict();

const taskMetadataSchema = z
  .object({
    proposal_ids: z.array(id).max(10).optional(),
    source_schedule_id: id.optional(),
  })
  .strict()
  .nullable();

const taskSchema = z
  .object({
    id,
    task_type: z.enum([
      'visit_preparation',
      'visit_contact_followup',
      'visit_schedule_reproposal_needed',
      'visit_schedule_override_approval',
      'visit_carry_item_review',
      'facility_batch_tracker',
      'mobile_visit_mode',
      'pharmacy.inbound_schedule_request_review_required',
    ]),
    title: label,
    description: nullableLabel,
    status: z.enum(['pending', 'in_progress']),
    priority: z.enum(['urgent', 'high', 'normal', 'low']),
    assigned_to: id.nullable(),
    due_date: dateTime.nullable(),
    sla_due_at: dateTime.nullable(),
    related_entity_type: z.string().max(200).nullable(),
    related_entity_id: id.nullable(),
    metadata: taskMetadataSchema,
    created_at: dateTime,
  })
  .strict()
  .superRefine((task, context) => {
    if (
      (task.related_entity_type === null) !== (task.related_entity_id === null) ||
      (task.task_type !== 'visit_schedule_override_approval' && task.metadata !== null) ||
      (task.metadata?.proposal_ids &&
        new Set(task.metadata.proposal_ids).size !== task.metadata.proposal_ids.length)
    )
      context.addIssue({ code: 'custom', message: 'Operational task relation or metadata drift' });
  });

const staffCountsSchema = z
  .object({
    total_count: nonnegativeInt,
    visible_count: nonnegativeInt,
    hidden_count: nonnegativeInt,
    total_visit_count: nonnegativeInt,
    visible_visit_count: nonnegativeInt,
    hidden_visit_count: nonnegativeInt,
    total_preparation_attention_count: nonnegativeInt,
    visible_preparation_attention_count: nonnegativeInt,
    hidden_preparation_attention_count: nonnegativeInt,
    hidden_operational_task_count: nonnegativeInt,
    limit: z.literal(6),
  })
  .strict();

const proposalCountsSchema = z
  .object({
    total_count: nonnegativeInt,
    visible_count: nonnegativeInt,
    hidden_count: nonnegativeInt,
    limit: z.literal(3),
    hidden_operational_task_count: nonnegativeInt,
  })
  .strict();

const inboundCountsSchema = z
  .object({
    total_count: nonnegativeInt,
    visible_count: nonnegativeInt,
    hidden_count: nonnegativeInt,
    limit: z.literal(5),
    count_basis: z.literal('formal_schedule_signal_visible_window'),
  })
  .strict();

function needsPreparationAttention(visit: z.infer<typeof visitSchema>) {
  return (
    visit.preparation_summary.status !== 'ready' ||
    visit.preparation_summary.ready_blocker_summary?.blocked === true
  );
}

export function buildScheduleDayBoardResponseSchema(expectedDate: string) {
  return z
    .object({
      data: z
        .object({
          generated_at: dateTime,
          date: z.literal(expectedDate),
          staff: z.array(staffSchema).max(6),
          staff_counts: staffCountsSchema,
          audit_pending_count: nonnegativeInt,
          report_pending_count: nonnegativeInt,
          vehicle_resources: z.array(vehicleSchema).max(100),
          pending_proposals: z.array(proposalSchema).max(3),
          pending_proposal_counts: proposalCountsSchema,
          inbound_schedule_requests: z.array(inboundRequestSchema).max(5),
          inbound_schedule_request_counts: inboundCountsSchema,
          operational_tasks: z.array(taskSchema).max(24),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const visibleVisits = data.staff.flatMap((staff) => staff.visits);
      const visibleAttention = visibleVisits.filter(needsPreparationAttention).length;
      const identities = [
        data.staff.map((item) => item.id),
        visibleVisits.map((item) => item.id),
        data.vehicle_resources.map((item) => item.id),
        data.pending_proposals.map((item) => item.id),
        data.inbound_schedule_requests.map((item) => item.signal_id),
        data.operational_tasks.map((item) => item.id),
      ];
      if (identities.some((items) => new Set(items).size !== items.length))
        context.addIssue({ code: 'custom', path: ['data'], message: 'Day-board identity drift' });
      if (
        data.staff_counts.visible_count !== data.staff.length ||
        data.staff_counts.total_count !==
          data.staff_counts.visible_count + data.staff_counts.hidden_count ||
        data.staff_counts.visible_visit_count !== visibleVisits.length ||
        data.staff_counts.total_visit_count !==
          data.staff_counts.visible_visit_count + data.staff_counts.hidden_visit_count ||
        data.staff_counts.visible_preparation_attention_count !== visibleAttention ||
        data.staff_counts.total_preparation_attention_count !==
          data.staff_counts.visible_preparation_attention_count +
            data.staff_counts.hidden_preparation_attention_count
      )
        context.addIssue({
          code: 'custom',
          path: ['data', 'staff_counts'],
          message: 'Day-board staff aggregate drift',
        });
      if (
        data.pending_proposal_counts.visible_count !== data.pending_proposals.length ||
        data.pending_proposal_counts.total_count !==
          data.pending_proposal_counts.visible_count + data.pending_proposal_counts.hidden_count
      )
        context.addIssue({
          code: 'custom',
          path: ['data', 'pending_proposal_counts'],
          message: 'Day-board proposal aggregate drift',
        });
      if (
        data.inbound_schedule_request_counts.visible_count !==
          data.inbound_schedule_requests.length ||
        data.inbound_schedule_request_counts.total_count !==
          data.inbound_schedule_request_counts.visible_count +
            data.inbound_schedule_request_counts.hidden_count
      )
        context.addIssue({
          code: 'custom',
          path: ['data', 'inbound_schedule_request_counts'],
          message: 'Day-board inbound aggregate drift',
        });
      if (
        data.vehicle_resources.some(
          (vehicle) =>
            vehicle.assigned_visit_count > vehicle.max_stops ||
            vehicle.remaining_stops !== vehicle.max_stops - vehicle.assigned_visit_count ||
            (vehicle.recommended && (!vehicle.available || vehicle.remaining_stops === 0)),
        ) ||
        data.vehicle_resources.filter((vehicle) => vehicle.recommended).length > 1
      )
        context.addIssue({
          code: 'custom',
          path: ['data', 'vehicle_resources'],
          message: 'Day-board vehicle aggregate drift',
        });
    })
    .transform(({ data }): { data: ScheduleDayBoardResponse } => ({ data }));
}
