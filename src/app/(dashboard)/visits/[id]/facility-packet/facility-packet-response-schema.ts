import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

const facilityPacketPatientSchema = z
  .object({
    schedule_id: nonEmptyText(255),
    patient_name: nonEmptyText(500),
    unit_name: nonEmptyText(500).nullable(),
    route_order: z.number().int().positive().nullable(),
    schedule_status: nonEmptyText(100),
    preparation_blockers_count: z.number().int().nonnegative(),
    visit_record_id: nonEmptyText(255).nullable(),
  })
  .strip();

const facilityParallelContextSchema = z
  .object({
    label: nonEmptyText(500).nullable(),
    place_kind: z.enum(['facility', 'home_group', 'address']).nullable(),
    site_name: nonEmptyText(500).nullable(),
    common_notes: z.string().max(20_000).nullable(),
    current_schedule_id: nonEmptyText(255),
    patients: z.array(facilityPacketPatientSchema).min(1).max(200),
  })
  .strip()
  .superRefine((context, issueContext) => {
    const scheduleIds = new Set<string>();
    const routeOrders = new Set<number>();
    for (const [index, patient] of context.patients.entries()) {
      if (scheduleIds.has(patient.schedule_id)) {
        issueContext.addIssue({
          code: 'custom',
          path: ['patients', index, 'schedule_id'],
          message: 'Duplicate facility-packet schedule identity',
        });
      }
      scheduleIds.add(patient.schedule_id);

      if (patient.route_order !== null) {
        if (routeOrders.has(patient.route_order)) {
          issueContext.addIssue({
            code: 'custom',
            path: ['patients', index, 'route_order'],
            message: 'Duplicate facility-packet route order',
          });
        }
        routeOrders.add(patient.route_order);
      }
    }
    if (!scheduleIds.has(context.current_schedule_id)) {
      issueContext.addIssue({
        code: 'custom',
        path: ['current_schedule_id'],
        message: 'Current schedule must be present in facility-packet patients',
      });
    }
  });

export const facilityPacketResponseSchema = z
  .object({
    data: z
      .object({
        pack: z
          .object({
            facility_parallel_context: facilityParallelContextSchema.nullable(),
          })
          .strip(),
      })
      .strip(),
  })
  .strict();

export type FacilityPacketSnapshot = z.infer<typeof facilityPacketResponseSchema>;
