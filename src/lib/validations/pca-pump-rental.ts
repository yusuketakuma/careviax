import { z } from 'zod';
import { dateKeySchema } from '@/lib/validations/date-key';
import { optionalNullablePhoneNumberSchema } from '@/lib/validations/phone';

const optionalTextSchema = z.string().trim().optional().nullable();
const dateSchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');

export const createPcaPumpSchema = z.object({
  asset_code: z.string().trim().min(1, '管理番号は必須です').max(80),
  serial_number: optionalTextSchema,
  model_name: z.string().trim().min(1, '機種名は必須です').max(120),
  manufacturer: optionalTextSchema,
  status: z.enum(['available', 'rented', 'maintenance', 'retired']).optional(),
  maintenance_due_at: dateSchema.optional().nullable(),
  notes: optionalTextSchema,
});

export const updatePcaPumpSchema = createPcaPumpSchema.partial();

function validateRentalDateOrder(
  value: {
    rented_at?: string | null;
    due_at?: string | null;
    returned_at?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (value.rented_at && value.due_at && value.rented_at > value.due_at) {
    ctx.addIssue({
      code: 'custom',
      path: ['due_at'],
      message: '返却予定日は貸出日以降の日付を指定してください',
    });
  }
  if (value.rented_at && value.returned_at && value.rented_at > value.returned_at) {
    ctx.addIssue({
      code: 'custom',
      path: ['returned_at'],
      message: '返却日は貸出日以降の日付を指定してください',
    });
  }
}

export const createPcaPumpRentalSchema = z
  .object({
    pump_id: z.string().trim().min(1, 'PCAポンプIDは必須です'),
    institution_id: z.string().trim().min(1, '貸出先医療機関は必須です'),
    status: z.enum(['scheduled', 'active', 'overdue', 'returned', 'cancelled']).optional(),
    rented_at: dateSchema,
    due_at: dateSchema.optional().nullable(),
    returned_at: dateSchema.optional().nullable(),
    contact_name: optionalTextSchema,
    contact_phone: optionalNullablePhoneNumberSchema,
    rental_fee_yen: z.number().int().min(0).optional().nullable(),
    notes: optionalTextSchema,
  })
  .superRefine(validateRentalDateOrder);

export const updatePcaPumpRentalSchema = z
  .object({
    institution_id: z.string().trim().min(1).optional(),
    status: z.enum(['scheduled', 'active', 'overdue', 'returned', 'cancelled']).optional(),
    rented_at: dateSchema.optional(),
    due_at: dateSchema.optional().nullable(),
    returned_at: dateSchema.optional().nullable(),
    contact_name: optionalTextSchema,
    contact_phone: optionalNullablePhoneNumberSchema,
    rental_fee_yen: z.number().int().min(0).optional().nullable(),
    notes: optionalTextSchema,
  })
  .superRefine(validateRentalDateOrder);
