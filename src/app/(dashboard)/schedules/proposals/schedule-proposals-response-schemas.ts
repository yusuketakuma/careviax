import { z } from 'zod';
import {
  buildWeeklyOptimizerCasesResponseSchema,
  scheduleProposalBillingPreviewSchema,
  scheduleProposalResponseItemSchema,
} from './schedule-weekly-optimizer-response-schemas';

const idSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().max(5_000);
const nullableTextSchema = textSchema.nullable();
const dateTimeSchema = z.string().datetime({ offset: true });
const nullableDateTimeSchema = dateTimeSchema.nullable();
const countSchema = z.number().int().nonnegative();
const finiteNullableSchema = z.number().finite().nullable();
const travelModeSchema = z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']);
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
const scheduleStatusSchema = z.enum([
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
  'completed',
  'cancelled',
  'postponed',
  'rescheduled',
  'no_show',
]);

export function buildScheduleProposalsDashboardResponseSchema(expected: {
  caseId: string | null;
  patientId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  status: string | null;
}) {
  return z
    .object({ data: z.array(scheduleProposalResponseItemSchema).max(500) })
    .strict()
    .superRefine(({ data }, context) => {
      const ids = new Set<string>();
      data.forEach((proposal, index) => {
        const date = proposal.proposed_date.slice(0, 10);
        if (ids.has(proposal.id))
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'id'],
            message: 'duplicate proposal',
          });
        ids.add(proposal.id);
        if (
          (expected.caseId && proposal.case_id !== expected.caseId) ||
          (expected.patientId && proposal.case_.patient.id !== expected.patientId) ||
          (expected.dateFrom && date < expected.dateFrom) ||
          (expected.dateTo && date > expected.dateTo) ||
          (expected.status && proposal.proposal_status !== expected.status)
        )
          context.addIssue({
            code: 'custom',
            path: ['data', index],
            message: 'proposal outside requested dashboard scope',
          });
      });
    });
}

export const scheduleProposalCaseSearchResponseSchema = buildWeeklyOptimizerCasesResponseSchema({
  limit: 8,
  status: 'active',
});

const vehicleResourceOptionSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1).max(500),
    travel_mode: travelModeSchema,
    max_stops: countSchema.nullable(),
    max_route_duration_minutes: countSchema.nullable(),
    available: z.literal(true),
    site: z
      .object({ id: idSchema, name: z.string().trim().min(1).max(500) })
      .strip()
      .nullable(),
  })
  .strip();

export const scheduleProposalVehicleResourcesResponseSchema = z
  .object({
    data: z.array(vehicleResourceOptionSchema).max(500),
    meta: z
      .object({
        total_count: countSchema,
        visible_count: countSchema,
        hidden_count: countSchema,
        truncated: z.boolean(),
        count_basis: z.literal('visit_vehicle_resources'),
        filters_applied: z
          .object({ available: z.literal(true), site_id: idSchema.optional() })
          .strict(),
        limit: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data, meta }, context) => {
    if (
      new Set(data.map((item) => item.id)).size !== data.length ||
      data.length !== meta.visible_count ||
      meta.total_count !== meta.visible_count + meta.hidden_count ||
      meta.truncated !== meta.hidden_count > 0 ||
      data.length > meta.limit
    )
      context.addIssue({
        code: 'custom',
        path: ['meta'],
        message: 'vehicle resource count mismatch',
      });
  });

export function buildScheduleProposalBillingPreviewBatchResponseSchema(expectedKeys: string[]) {
  const expected = new Set(expectedKeys);
  return z
    .object({ data: z.record(idSchema, scheduleProposalBillingPreviewSchema) })
    .strict()
    .superRefine(({ data }, context) => {
      const actual = Object.keys(data);
      if (
        actual.length !== expected.size ||
        new Set(actual).size !== actual.length ||
        actual.some((key) => !expected.has(key))
      )
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'billing preview key mismatch',
        });
    })
    .transform(({ data }) => new Map(Object.entries(data)));
}

const vehicleResourceSummarySchema = z
  .object({
    id: idSchema,
    label: textSchema,
    travel_mode: travelModeSchema,
    max_stops: countSchema.nullable(),
    max_route_duration_minutes: countSchema.nullable(),
  })
  .strip();

const pharmacistDayScheduleSchema = z
  .object({
    id: idSchema,
    visit_type: visitTypeSchema,
    priority: prioritySchema,
    schedule_status: scheduleStatusSchema,
    route_order: z.number().int().positive().nullable(),
    scheduled_date: z.union([z.string().date(), dateTimeSchema]),
    time_window_start: nullableDateTimeSchema,
    time_window_end: nullableDateTimeSchema,
    case_: z
      .object({
        patient: z
          .object({
            name: z.string().trim().min(1).max(500),
            residences: z.array(
              z
                .object({
                  address: textSchema,
                  lat: finiteNullableSchema,
                  lng: finiteNullableSchema,
                })
                .strip(),
            ),
          })
          .strip(),
      })
      .strip(),
    site: z
      .object({
        id: idSchema,
        name: textSchema,
        address: textSchema,
        lat: finiteNullableSchema.optional(),
        lng: finiteNullableSchema.optional(),
      })
      .strip()
      .nullable(),
    vehicle_resource: vehicleResourceSummarySchema.nullable(),
  })
  .strip();

const routePreviewSchema = z
  .object({
    plan: z
      .object({
        status: z.enum(['ok', 'unavailable']),
        note: nullableTextSchema,
        travelMode: travelModeSchema,
        origin: z
          .object({ lat: z.number().finite(), lng: z.number().finite(), label: textSchema })
          .strict()
          .nullable(),
        encodedPath: nullableTextSchema,
        orderedScheduleIds: z.array(idSchema),
        totalDistanceMeters: finiteNullableSchema,
        totalDurationSeconds: finiteNullableSchema,
        stopSummaries: z.array(
          z
            .object({
              scheduleId: idSchema,
              optimizedOrder: z.number().int().positive(),
              arrivalOffsetSeconds: finiteNullableSchema,
              distanceFromPreviousMeters: finiteNullableSchema,
              durationFromPreviousSeconds: finiteNullableSchema,
            })
            .strict(),
        ),
      })
      .strict(),
    points: z.array(
      z
        .object({
          schedule_id: idSchema,
          point_kind: z.enum(['proposal', 'schedule']),
          patient_name: textSchema,
          address: textSchema,
          lat: z.number().finite().min(-90).max(90),
          lng: z.number().finite().min(-180).max(180),
          priority: prioritySchema,
          schedule_status: scheduleStatusSchema,
          time_window_start: nullableDateTimeSchema,
          time_window_end: nullableDateTimeSchema,
        })
        .strict(),
    ),
    site: z
      .object({ name: textSchema, lat: z.number().finite(), lng: z.number().finite() })
      .strict()
      .nullable(),
  })
  .strict();

const diagnosticsSchema = z
  .object({
    accepted: z.array(
      z
        .object({
          pharmacist_id: idSchema,
          pharmacist_name: textSchema.optional(),
          proposed_date: z.string().date(),
          route_order: z.number().int().positive().optional(),
          score: z.number().finite().optional(),
          travel_summary: textSchema.optional(),
          vehicle_resource_id: idSchema.nullable().optional(),
          vehicle_resource_label: nullableTextSchema.optional(),
          vehicle_load: countSchema.nullable().optional(),
          assignment_mode: textSchema.optional(),
          care_relationship: textSchema.optional(),
          score_breakdown: z.record(z.string(), z.number().finite()).optional(),
          time_window_start: textSchema.optional(),
          time_window_end: textSchema.optional(),
        })
        .strict(),
    ),
    rejected: z.array(
      z
        .object({
          pharmacist_id: idSchema.optional(),
          pharmacist_name: textSchema.optional(),
          proposed_date: z.string().date(),
          reason_code: textSchema.optional(),
          reason_label: textSchema.optional(),
          detail: textSchema.optional(),
          availability_reason_code: textSchema.optional(),
        })
        .strict(),
    ),
    deadline_policy: z
      .array(
        z
          .object({
            code: idSchema,
            site_id: idSchema.nullable(),
            date_key: z.string().date().optional(),
            from_date_key: z.string().date().optional(),
            to_date_key: z.string().date().optional(),
            value: z.union([z.string(), z.number(), z.boolean()]).optional(),
          })
          .strict(),
      )
      .optional(),
    review_candidates: z
      .array(
        z
          .object({
            code: z.literal('review_required_candidate'),
            reason_code: idSchema,
            pharmacist_id: idSchema.optional(),
            site_id: idSchema.nullable(),
            proposed_date: z.string().date(),
            match_status: textSchema.optional(),
            missing_label_count: countSchema.optional(),
            unknown_procedure_count: countSchema.optional(),
            required_label_count: countSchema.optional(),
          })
          .strict(),
      )
      .optional(),
    billing_constraint_count: countSchema.optional(),
  })
  .strip();

const proposalDetailExtrasSchema = z
  .object({
    approved_at: nullableDateTimeSchema.optional(),
    patient_contacted_at: nullableDateTimeSchema.optional(),
    confirmed_at: nullableDateTimeSchema.optional(),
    related_proposals: z.array(scheduleProposalResponseItemSchema).max(500),
    pharmacist_day_schedules: z.array(pharmacistDayScheduleSchema).max(500),
    route_preview: routePreviewSchema,
    creation_diagnostics: diagnosticsSchema.nullable(),
  })
  .strip();

export function buildScheduleProposalDetailResponseSchema(
  expectedProposalId: string,
  expectedTravelMode: z.infer<typeof travelModeSchema>,
) {
  return z
    .object({ data: scheduleProposalResponseItemSchema.and(proposalDetailExtrasSchema) })
    .strict()
    .superRefine(({ data }, context) => {
      if (
        data.id !== expectedProposalId ||
        data.route_preview.plan.travelMode !== expectedTravelMode
      )
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'proposal detail scope mismatch',
        });
      const relatedIds = data.related_proposals.map((proposal) => proposal.id);
      if (relatedIds.includes(data.id) || new Set(relatedIds).size !== relatedIds.length)
        context.addIssue({
          code: 'custom',
          path: ['data', 'related_proposals'],
          message: 'duplicate related proposal',
        });
      const scheduleIds = data.pharmacist_day_schedules.map((schedule) => schedule.id);
      if (new Set(scheduleIds).size !== scheduleIds.length)
        context.addIssue({
          code: 'custom',
          path: ['data', 'pharmacist_day_schedules'],
          message: 'duplicate schedule',
        });
    });
}
