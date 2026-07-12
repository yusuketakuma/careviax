import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().max(5_000);
const nullableTextSchema = textSchema.nullable();
const dateKeySchema = z.string().date();
const dateTimeSchema = z.string().datetime({ offset: true });
const nullableDateTimeSchema = dateTimeSchema.nullable();
const countSchema = z.number().int().nonnegative();
const finiteNullableSchema = z.number().finite().nullable();
const visitTypeSchema = z.enum([
  'initial',
  'regular',
  'temporary',
  'revisit',
  'delivery_only',
  'emergency',
  'physician_co_visit',
]);
const prioritySchema = z.enum(['normal', 'urgent', 'emergency']);

const residenceSchema = z
  .object({
    address: textSchema,
    building_id: idSchema.nullable().optional(),
    unit_name: nullableTextSchema.optional(),
    lat: z.number().finite().min(-90).max(90).nullable().optional(),
    lng: z.number().finite().min(-180).max(180).nullable().optional(),
  })
  .strip();

const caseOptionSchema = z
  .object({
    id: idSchema,
    display_id: idSchema.nullable().optional(),
    status: idSchema,
    primary_pharmacist_id: idSchema.nullable(),
    primary_pharmacist_name: nullableTextSchema,
    patient: z
      .object({
        id: idSchema,
        display_id: idSchema.nullable().optional(),
        name: z.string().trim().min(1).max(500),
        residences: z.array(residenceSchema).max(20),
      })
      .strip(),
  })
  .strip();

export function buildWeeklyOptimizerCasesResponseSchema(expected: {
  limit: number;
  status: string;
}) {
  return z
    .object({
      data: z.array(caseOptionSchema).max(expected.limit),
      meta: z
        .object({
          limit: z.literal(expected.limit),
          has_more: z.boolean(),
          next_cursor: idSchema.nullable(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      const ids = new Set<string>();
      data.forEach((item, index) => {
        if (item.status !== expected.status)
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'status'],
            message: 'case status mismatch',
          });
        if (ids.has(item.id))
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'id'],
            message: 'duplicate case',
          });
        ids.add(item.id);
        if (item.primary_pharmacist_id === null && item.primary_pharmacist_name !== null)
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'primary_pharmacist_name'],
            message: 'pharmacist identity mismatch',
          });
      });
      if (meta.has_more !== Boolean(meta.next_cursor))
        context.addIssue({
          code: 'custom',
          path: ['meta', 'next_cursor'],
          message: 'cursor mismatch',
        });
    });
}

const proposalSchema = z
  .object({
    id: idSchema,
    display_id: idSchema.nullable().optional(),
    case_id: idSchema,
    visit_type: visitTypeSchema,
    priority: prioritySchema,
    proposal_status: z.enum([
      'proposed',
      'patient_contact_pending',
      'confirmed',
      'rejected',
      'superseded',
      'expired',
      'reschedule_pending',
    ]),
    patient_contact_status: z.enum([
      'pending',
      'attempted',
      'confirmed',
      'declined',
      'change_requested',
      'unreachable',
    ]),
    proposed_date: z.union([dateKeySchema, dateTimeSchema]),
    time_window_start: nullableDateTimeSchema,
    time_window_end: nullableDateTimeSchema,
    proposed_pharmacist_id: idSchema,
    proposed_pharmacist: z
      .object({
        id: idSchema,
        name: z.string().trim().min(1).max(500),
        name_kana: nullableTextSchema,
      })
      .strip()
      .nullable(),
    assignment_mode: z.enum(['primary', 'fallback']),
    route_order: z.number().int().positive().nullable(),
    route_distance_score: finiteNullableSchema,
    updated_at: dateTimeSchema,
    medication_end_date: z.union([dateKeySchema, dateTimeSchema]).nullable(),
    visit_deadline_date: z.union([dateKeySchema, dateTimeSchema]).nullable(),
    proposal_reason: textSchema,
    escalation_reason: nullableTextSchema,
    finalized_schedule_id: idSchema.nullable(),
    reschedule_source_schedule_id: idSchema.nullable(),
    case_: z
      .object({
        display_id: idSchema.nullable().optional(),
        patient: z
          .object({
            id: idSchema,
            display_id: idSchema.nullable().optional(),
            name: z.string().trim().min(1).max(500),
            residences: z.array(residenceSchema).max(20),
          })
          .strip(),
      })
      .strip(),
    site: z
      .object({
        id: idSchema,
        name: z.string().trim().min(1).max(500),
        address: textSchema,
        lat: z.number().finite().nullable().optional(),
        lng: z.number().finite().nullable().optional(),
      })
      .strip()
      .nullable(),
    vehicle_resource: z
      .object({
        id: idSchema,
        label: textSchema,
        travel_mode: z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']),
        max_stops: countSchema.nullable(),
        max_route_duration_minutes: countSchema.nullable(),
      })
      .strip()
      .nullable()
      .optional(),
    finalized_schedule: z
      .object({
        id: idSchema,
        display_id: idSchema.nullable().optional(),
        scheduled_date: z.union([dateKeySchema, dateTimeSchema]),
        pharmacist_id: idSchema,
      })
      .strip()
      .nullable(),
    reschedule_source_schedule: z
      .object({
        id: idSchema,
        display_id: idSchema.nullable().optional(),
        scheduled_date: z.union([dateKeySchema, dateTimeSchema]),
        pharmacist_id: idSchema,
        override_request: z
          .object({
            status: z.enum(['pending', 'completed', 'cancelled']),
            impact_summary: z.record(z.string(), z.unknown()).nullable(),
          })
          .strict()
          .nullable(),
      })
      .strip()
      .nullable(),
    contact_logs: z
      .array(
        z
          .object({
            id: idSchema,
            outcome: z.enum([
              'pending',
              'attempted',
              'confirmed',
              'declined',
              'change_requested',
              'unreachable',
            ]),
            contact_method: nullableTextSchema,
            has_note: z.boolean(),
            callback_due_at: nullableDateTimeSchema,
            called_at: dateTimeSchema,
          })
          .strip(),
      )
      .max(100),
  })
  .strip()
  .superRefine((proposal, context) => {
    if (
      proposal.proposed_pharmacist &&
      proposal.proposed_pharmacist.id !== proposal.proposed_pharmacist_id
    )
      context.addIssue({
        code: 'custom',
        path: ['proposed_pharmacist', 'id'],
        message: 'pharmacist identity mismatch',
      });
    if ((proposal.finalized_schedule === null) !== (proposal.finalized_schedule_id === null))
      context.addIssue({
        code: 'custom',
        path: ['finalized_schedule'],
        message: 'finalized schedule mismatch',
      });
    if (
      (proposal.reschedule_source_schedule === null) !==
      (proposal.reschedule_source_schedule_id === null)
    )
      context.addIssue({
        code: 'custom',
        path: ['reschedule_source_schedule'],
        message: 'reschedule source mismatch',
      });
  });

export function buildWeeklyOptimizerProposalsResponseSchema(dateFrom: string, dateTo: string) {
  return z
    .object({ data: z.array(proposalSchema).max(500) })
    .strict()
    .superRefine(({ data }, context) => {
      const ids = new Set<string>();
      data.forEach((proposal, index) => {
        const date = proposal.proposed_date.slice(0, 10);
        if (date < dateFrom || date > dateTo)
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'proposed_date'],
            message: 'proposal outside requested week',
          });
        if (ids.has(proposal.id))
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'id'],
            message: 'duplicate proposal',
          });
        ids.add(proposal.id);
      });
    });
}

const shiftSchema = z
  .object({
    id: idSchema,
    user_id: idSchema,
    site_id: idSchema.nullable(),
    date: dateTimeSchema,
    available: z.boolean(),
    available_from: nullableDateTimeSchema,
    available_to: nullableDateTimeSchema,
    user: z
      .object({
        id: idSchema,
        name: z.string().trim().min(1).max(500),
        name_kana: nullableTextSchema,
      })
      .strip(),
    site: z
      .object({ id: idSchema, name: z.string().trim().min(1).max(500) })
      .strip()
      .nullable(),
  })
  .strip();

export function buildWeeklyOptimizerShiftsResponseSchema(dateFrom: string, dateTo: string) {
  return z
    .object({
      data: z.array(shiftSchema).max(500),
      meta: z
        .object({ limit: z.number().int().positive(), has_more: z.boolean() })
        .strict()
        .optional(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const keys = new Set<string>();
      data.forEach((shift, index) => {
        const date = shift.date.slice(0, 10);
        if (date < dateFrom || date > dateTo)
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'date'],
            message: 'shift outside requested week',
          });
        if (shift.user.id !== shift.user_id || (shift.site && shift.site.id !== shift.site_id))
          context.addIssue({
            code: 'custom',
            path: ['data', index],
            message: 'shift identity mismatch',
          });
        const key = `${shift.user_id}:${date}`;
        if (keys.has(key))
          context.addIssue({ code: 'custom', path: ['data', index], message: 'duplicate shift' });
        keys.add(key);
      });
    });
}

const billingAlertSchema = z
  .object({
    type: idSchema,
    severity: z.enum(['error', 'warning', 'info']),
    message: textSchema,
    details: z.record(z.string(), z.unknown()),
    as_of: z.string().trim().min(1),
  })
  .strip();
const billingPreviewSchema = z
  .object({
    alerts: z.array(billingAlertSchema),
    cadence: z
      .object({
        monthly_cap: countSchema,
        current_month_count: countSchema,
        remaining_month_count: countSchema,
        weekly_cap: countSchema.nullable(),
        current_week_count: countSchema,
        scheduled_dates_current_month: z.array(dateKeySchema),
        next_billable_date: dateKeySchema.nullable(),
        suggested_dates: z.array(dateKeySchema),
        reason: textSchema,
      })
      .strict(),
    recommended_visit_type: visitTypeSchema,
    recommended_priority: prioritySchema,
    suggested_schedule_slot_count: countSchema,
    effective_revision_code: idSchema,
    effective_revision_label: textSchema,
    site_config_status: z.enum([
      'not_required',
      'site_unassigned',
      'config_missing',
      'revision_mismatch',
      'resolved',
    ]),
    site_config_revision_code: idSchema.nullable(),
    warnings: z.array(textSchema),
    home_comprehensive_preview: z
      .object({
        level: nullableTextSchema,
        ssotKey: nullableTextSchema,
        code: nullableTextSchema,
        name: nullableTextSchema,
        points: finiteNullableSchema,
        buildingTier: z.enum(['single', 'other']).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const weeklyOptimizerBillingPreviewResponseSchema = z
  .object({ data: billingPreviewSchema })
  .strict();
