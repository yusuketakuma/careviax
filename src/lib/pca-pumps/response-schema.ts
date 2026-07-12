import { z } from 'zod';
import { dateKeySchema } from '@/lib/validations/date-key';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const dateKey = dateKeySchema('Expected YYYY-MM-DD date');
const pumpStatusSchema = z.enum(['available', 'rented', 'maintenance', 'retired']);
const rentalStatusSchema = z.enum(['scheduled', 'active', 'overdue', 'returned', 'cancelled']);
const inspectionStatusSchema = z.enum(['pending', 'passed', 'needs_maintenance']);

const institutionReferenceSchema = z
  .object({
    id: nonEmptyText(200),
    name: nonEmptyText(500),
    institution_code: z.string().max(100).nullable(),
  })
  .strip();

const maintenanceEventSchema = z
  .object({
    id: nonEmptyText(200),
    event_type: z.enum([
      'manual_status_change',
      'return_inspection',
      'maintenance_completed',
      'repair_required',
    ]),
    result: z.enum(['available', 'maintenance_continues', 'retired']),
    performed_at: z.string().datetime({ offset: true }),
    performed_by: z.string().max(200).nullable(),
    notes: z.string().max(4_000).nullable(),
    next_maintenance_due_at: dateKey.nullable(),
  })
  .strip();

const pumpOpenRentalSchema = z
  .object({
    id: nonEmptyText(200),
    status: z.enum(['scheduled', 'active', 'overdue']),
    due_at: dateKey.nullable(),
    institution: institutionReferenceSchema,
  })
  .strip();

export const pcaPumpSchema = z
  .object({
    id: nonEmptyText(200),
    asset_code: nonEmptyText(80),
    serial_number: z.string().max(200).nullable(),
    model_name: nonEmptyText(120),
    manufacturer: z.string().max(500).nullable(),
    status: pumpStatusSchema,
    maintenance_due_at: dateKey.nullable(),
    notes: z.string().max(4_000).nullable(),
    maintenance_events: z.array(maintenanceEventSchema).max(3),
    rentals: z.array(pumpOpenRentalSchema).max(1),
  })
  .strip()
  .superRefine((pump, context) => {
    if (pump.status === 'rented' && pump.rentals.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['rentals'],
        message: 'Rented pump must expose its open rental',
      });
    }
    if (pump.status !== 'rented' && pump.rentals.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['rentals'],
        message: 'Non-rented pump cannot expose an open rental',
      });
    }
    for (let index = 1; index < pump.maintenance_events.length; index += 1) {
      if (
        pump.maintenance_events[index]!.performed_at >
        pump.maintenance_events[index - 1]!.performed_at
      ) {
        context.addIssue({
          code: 'custom',
          path: ['maintenance_events', index, 'performed_at'],
          message: 'Maintenance events are not newest first',
        });
      }
    }
  });

export function buildPcaPumpsResponseSchema(hasQuery: boolean) {
  const data = z
    .array(pcaPumpSchema)
    .max(500)
    .superRefine((pumps, context) => {
      const ids = new Set<string>();
      const assetCodes = new Set<string>();
      for (const [index, pump] of pumps.entries()) {
        if (ids.has(pump.id))
          context.addIssue({
            code: 'custom',
            path: [index, 'id'],
            message: 'Duplicate pump identity',
          });
        if (assetCodes.has(pump.asset_code))
          context.addIssue({
            code: 'custom',
            path: [index, 'asset_code'],
            message: 'Duplicate pump asset code',
          });
        ids.add(pump.id);
        assetCodes.add(pump.asset_code);
      }
    });
  return hasQuery
    ? z
        .object({ data, meta: z.object({ limit: z.literal(500), has_more: z.boolean() }).strict() })
        .strict()
    : z.object({ data }).strict();
}

const rentalPumpSchema = z
  .object({
    id: nonEmptyText(200),
    asset_code: nonEmptyText(80),
    serial_number: z.string().max(200).nullable(),
    model_name: nonEmptyText(120),
    status: pumpStatusSchema,
  })
  .strip();

export const pcaPumpRentalSchema = z
  .object({
    id: nonEmptyText(200),
    status: rentalStatusSchema,
    rented_at: dateKey,
    due_at: dateKey.nullable(),
    returned_at: dateKey.nullable(),
    return_inspection_status: inspectionStatusSchema.nullable(),
    return_inspection_notes: z.string().max(4_000).nullable(),
    accessory_checklist: z.unknown(),
    inspected_at: z.string().datetime({ offset: true }).nullable(),
    inspected_by: z.string().max(200).nullable(),
    rental_fee_yen: z.number().int().nonnegative().nullable(),
    contact_name: z.string().max(500).nullable(),
    contact_phone: z.string().max(200).nullable(),
    pump: rentalPumpSchema,
    institution: institutionReferenceSchema.extend({
      phone: z.string().max(200).nullable(),
      fax: z.string().max(200).nullable(),
    }),
  })
  .strip()
  .superRefine((rental, context) => {
    if (rental.due_at && rental.rented_at > rental.due_at)
      context.addIssue({
        code: 'custom',
        path: ['due_at'],
        message: 'Rental due date precedes start',
      });
    if (rental.returned_at && rental.rented_at > rental.returned_at)
      context.addIssue({
        code: 'custom',
        path: ['returned_at'],
        message: 'Rental return date precedes start',
      });
    if (rental.status === 'returned' && !rental.returned_at)
      context.addIssue({
        code: 'custom',
        path: ['returned_at'],
        message: 'Returned rental requires a return date',
      });
    if (rental.status !== 'returned' && rental.returned_at)
      context.addIssue({
        code: 'custom',
        path: ['returned_at'],
        message: 'Only returned rentals may have a return date',
      });
    if (rental.status === 'returned' && rental.return_inspection_status === null)
      context.addIssue({
        code: 'custom',
        path: ['return_inspection_status'],
        message: 'Returned rental requires inspection state',
      });
    if (rental.status !== 'returned' && rental.return_inspection_status !== null)
      context.addIssue({
        code: 'custom',
        path: ['return_inspection_status'],
        message: 'Open rental cannot have inspection state',
      });
    const inspected =
      rental.return_inspection_status === 'passed' ||
      rental.return_inspection_status === 'needs_maintenance';
    if (inspected !== (rental.inspected_at !== null && rental.inspected_by !== null))
      context.addIssue({
        code: 'custom',
        path: ['inspected_at'],
        message: 'Inspection actor and timestamp do not match inspection state',
      });
  });

export function buildPcaPumpRentalsResponseSchema(args: {
  statuses: readonly string[];
  inspectionStatus?: 'pending' | 'passed' | 'needs_maintenance';
}) {
  return z
    .object({ data: z.array(pcaPumpRentalSchema).max(100) })
    .strict()
    .superRefine(({ data }, context) => {
      const ids = new Set<string>();
      for (const [index, rental] of data.entries()) {
        if (!args.statuses.includes(rental.status))
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'status'],
            message: 'Rental status does not match the request',
          });
        if (args.inspectionStatus && rental.return_inspection_status !== args.inspectionStatus)
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'return_inspection_status'],
            message: 'Inspection status does not match the request',
          });
        if (ids.has(rental.id))
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'id'],
            message: 'Duplicate rental identity',
          });
        ids.add(rental.id);
      }
    });
}

export const pcaPumpInstitutionOptionsResponseSchema = z
  .object({ data: z.array(institutionReferenceSchema).max(500) })
  .strict();

export type PcaPump = z.infer<typeof pcaPumpSchema>;
export type PcaPumpRental = z.infer<typeof pcaPumpRentalSchema>;
export type PcaPumpInstitution = z.infer<typeof institutionReferenceSchema>;
