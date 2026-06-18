import { z } from 'zod';

const routeTravelModeSchema = z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']);

const routePlanSnapshotSchema = z
  .object({
    status: z.enum(['ok', 'unavailable']).optional(),
    note: z.string().nullable().optional(),
    travelMode: routeTravelModeSchema.optional(),
    travel_mode: routeTravelModeSchema.optional(),
    orderedScheduleIds: z.array(z.string().trim().min(1)).max(50).optional(),
    ordered_schedule_ids: z.array(z.string().trim().min(1)).max(50).optional(),
    totalDistanceMeters: z.number().nonnegative().nullable().optional(),
    total_distance_meters: z.number().nonnegative().nullable().optional(),
    totalDurationSeconds: z.number().nonnegative().nullable().optional(),
    total_duration_seconds: z.number().nonnegative().nullable().optional(),
    vehicle_resource_id: z.string().trim().min(1).nullable().optional(),
    vehicle_resource: z
      .object({
        vehicle_id: z.string().trim().min(1).nullable().optional(),
        label: z.string().nullable().optional(),
        constraint_status: z.enum(['ok', 'exceeded', 'unverified']).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const upsertVisitPreparationSchema = z.object({
  checklist: z.record(z.string(), z.unknown()).default({}),
  medication_changes_reviewed: z.boolean().default(false),
  carry_items_confirmed: z.boolean().default(false),
  previous_issues_reviewed: z.boolean().default(false),
  route_confirmed: z.boolean().default(false),
  route_plan_snapshot: routePlanSnapshotSchema.nullable().optional(),
  offline_synced: z.boolean().default(false),
  mark_ready: z.boolean().default(false),
  /** テンプレートオプション — 指定時はチェックリストをテンプレートから初期化する */
  template_options: z
    .object({
      narcotics_carry: z.boolean().optional(),
      infection_control: z.boolean().optional(),
      cold_chain_required: z.boolean().optional(),
      facility_custom_items: z.array(z.string()).optional(),
    })
    .optional(),
});

export type UpsertVisitPreparationInput = z.infer<typeof upsertVisitPreparationSchema>;
