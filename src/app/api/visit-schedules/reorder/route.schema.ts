import { z } from 'zod';
import { scheduleStatusValues, visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';

export const routeOrderConfirmationContextSchema = z.object({
  source: z.enum([
    'schedule_day_route_preview',
    'schedule_conflict_resolution',
    'route_compare_adoption',
    'emergency_route_interruption',
  ]),
  date: visitScheduleDateKeySchema('確認日付の形式が不正です（YYYY-MM-DD）').optional(),
  pharmacist_id: z.string().trim().min(1).max(100).optional(),
  travel_mode: z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']).optional(),
  target_count: z.number().int().min(1).max(100).optional(),
  route_order_diff_count: z.number().int().min(0).max(100).optional(),
  vehicle_assignment_count: z.number().int().min(0).max(100).optional(),
  released_schedule_id: z.string().trim().min(1).max(100).optional(),
  patient_reconfirmation_required: z.boolean().optional(),
});

export type RouteOrderConfirmationContext = z.infer<typeof routeOrderConfirmationContextSchema>;

export const visitScheduleReorderSchema = z.object({
  updates: z
    .array(
      z.object({
        schedule_id: z.string().trim().min(1),
        route_order: z.number().int().min(1).optional(),
        expected_route_order: z.number().int().min(1).nullable().optional(),
        scheduled_date: visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
        pharmacist_id: z.string().trim().min(1).optional(),
        vehicle_resource_id: z.string().trim().min(1).nullable().optional(),
      }),
    )
    .default([]),
  vehicle_assignment: z
    .object({
      mode: z.literal('assign_if_unassigned'),
      vehicle_resource_id: z.string().trim().min(1),
      schedule_ids: z.array(z.string().trim().min(1)).min(1).max(100),
      expected_schedule_statuses: z
        .array(
          z.object({
            schedule_id: z.string().trim().min(1),
            schedule_status: z.enum(scheduleStatusValues),
          }),
        )
        .max(100)
        .optional(),
    })
    .optional(),
  confirmation_context: routeOrderConfirmationContextSchema.optional(),
});

export type VisitScheduleReorderError =
  | 'not_found'
  | 'pharmacist_change_forbidden'
  | 'invalid_pharmacist'
  | 'confirmed_move'
  | 'confirmed_route_change'
  | 'stale_route_order'
  | 'route_status_locked'
  | 'shift_conflict'
  | 'confirmation_context_mismatch'
  | 'vehicle_not_found'
  | 'vehicle_site_required'
  | 'vehicle_site_mismatch'
  | 'vehicle_capacity_exceeded'
  | 'vehicle_route_duration_exceeded'
  | 'vehicle_status_locked'
  | 'stale_vehicle_schedule_status'
  | 'vehicle_assignment_target_mismatch'
  | 'vehicle_already_assigned'
  | 'duplicate_route_order';

export type VisitScheduleReorderResult =
  | {
      error: Exclude<
        VisitScheduleReorderError,
        'shift_conflict' | 'vehicle_capacity_exceeded' | 'vehicle_route_duration_exceeded'
      >;
    }
  | { error: 'shift_conflict'; message: string }
  | { error: 'vehicle_capacity_exceeded'; message: string }
  | { error: 'vehicle_route_duration_exceeded'; message: string }
  | {
      case_ids: string[];
      schedule_ids: string[];
      vehicle_assignment: { vehicle_resource_id: string; assigned_schedule_ids: string[] } | null;
    };
