import { z } from 'zod';
import { dateKeySchema } from '@/lib/validations/date-key';
import { optionalNullablePhoneNumberSchema } from '@/lib/validations/phone';

const optionalTextSchema = z.string().trim().optional().nullable();
const dateSchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');
const returnInspectionStatusSchema = z.enum(['pending', 'passed', 'needs_maintenance']);
const pcaPumpMaintenanceEventTypeSchema = z.enum([
  'manual_status_change',
  'return_inspection',
  'maintenance_completed',
  'repair_required',
]);
const pcaPumpMaintenanceResultSchema = z.enum([
  'available',
  'maintenance_continues',
  'retired',
]);

export const pcaPumpAccessoryChecklistKeys = [
  'pump_body',
  'power_adapter',
  'power_cable',
  'carrying_case',
  'manual',
  'lock_key',
  'clamp',
  'cleaning_completed',
  'operation_check',
] as const;
const accessoryChecklistItemSchema = z
  .object({
    status: z.enum(['ok', 'missing', 'damaged', 'not_applicable']),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict();
export const pcaPumpAccessoryChecklistSchema = z
  .object({
    pump_body: accessoryChecklistItemSchema.optional(),
    power_adapter: accessoryChecklistItemSchema.optional(),
    power_cable: accessoryChecklistItemSchema.optional(),
    carrying_case: accessoryChecklistItemSchema.optional(),
    manual: accessoryChecklistItemSchema.optional(),
    lock_key: accessoryChecklistItemSchema.optional(),
    clamp: accessoryChecklistItemSchema.optional(),
    cleaning_completed: accessoryChecklistItemSchema.optional(),
    operation_check: accessoryChecklistItemSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [key, item] of Object.entries(value)) {
      if ((item?.status === 'missing' || item?.status === 'damaged') && !item.notes) {
        ctx.addIssue({
          code: 'custom',
          path: [key, 'notes'],
          message: '不足・破損の場合は詳細メモが必須です',
        });
      }
    }
  });

type PcaPumpAccessoryChecklist = z.infer<typeof pcaPumpAccessoryChecklistSchema>;

export function isCompletePassingPcaPumpAccessoryChecklist(
  checklist: PcaPumpAccessoryChecklist | null | undefined,
) {
  if (!checklist) return false;
  return pcaPumpAccessoryChecklistKeys.every((key) => {
    const item = checklist[key];
    return item?.status === 'ok' || item?.status === 'not_applicable';
  });
}

export const createPcaPumpSchema = z.object({
  asset_code: z.string().trim().min(1, '管理番号は必須です').max(80),
  serial_number: optionalTextSchema,
  model_name: z.string().trim().min(1, '機種名は必須です').max(120),
  manufacturer: optionalTextSchema,
  status: z.enum(['available', 'rented', 'maintenance', 'retired']).optional(),
  maintenance_due_at: dateSchema.optional().nullable(),
  notes: optionalTextSchema,
});

export const updatePcaPumpSchema = createPcaPumpSchema
  .partial()
  .extend({
    maintenance_event_type: pcaPumpMaintenanceEventTypeSchema.optional(),
    maintenance_result: pcaPumpMaintenanceResultSchema.optional(),
    maintenance_notes: optionalTextSchema,
  })
  .superRefine((value, ctx) => {
    const hasMaintenanceEventPayload =
      value.maintenance_event_type !== undefined ||
      value.maintenance_result !== undefined ||
      value.maintenance_notes !== undefined;
    if (hasMaintenanceEventPayload && value.status === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: '整備履歴を記録する場合は状態変更も指定してください',
      });
    }
  });

function validateRentalDateOrder(
  value: {
    status?: 'scheduled' | 'active' | 'overdue' | 'returned' | 'cancelled' | null;
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

function validateCreateRentalLifecycle(
  value: {
    status?: 'scheduled' | 'active' | 'overdue' | 'returned' | 'cancelled' | null;
    due_at?: string | null;
    returned_at?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  const status = value.status ?? 'active';
  if ((status === 'scheduled' || status === 'active' || status === 'overdue') && !value.due_at) {
    ctx.addIssue({
      code: 'custom',
      path: ['due_at'],
      message: '貸出中・予定・延滞のPCAポンプには返却予定日が必須です',
    });
  }
  if (status === 'returned' && !value.returned_at) {
    ctx.addIssue({
      code: 'custom',
      path: ['returned_at'],
      message: '返却済みで登録する場合は返却日が必須です',
    });
  }
  if (value.returned_at && status !== 'returned') {
    ctx.addIssue({
      code: 'custom',
      path: ['returned_at'],
      message: '返却日は返却済み状態でのみ指定できます',
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
  .superRefine((value, ctx) => {
    validateRentalDateOrder(value, ctx);
    validateCreateRentalLifecycle(value, ctx);
  });

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
    return_inspection_status: returnInspectionStatusSchema.optional(),
    return_inspection_notes: optionalTextSchema,
    accessory_checklist: pcaPumpAccessoryChecklistSchema.optional().nullable(),
    notes: optionalTextSchema,
  })
  .superRefine((value, ctx) => {
    validateRentalDateOrder(value, ctx);
    if (value.return_inspection_status === 'passed') {
      if (!value.accessory_checklist) {
        ctx.addIssue({
          code: 'custom',
          path: ['accessory_checklist'],
          message: '検品合格には付属品チェックが必須です',
        });
        return;
      }
      if (!isCompletePassingPcaPumpAccessoryChecklist(value.accessory_checklist)) {
        ctx.addIssue({
          code: 'custom',
          path: ['accessory_checklist'],
          message: '検品合格には全ての付属品チェックがOKまたは該当なしである必要があります',
        });
      }
    }
    if (value.return_inspection_status === 'needs_maintenance') {
      const hasBlockingChecklistItem =
        value.accessory_checklist !== null &&
        value.accessory_checklist !== undefined &&
        Object.values(value.accessory_checklist).some(
          (item) => item?.status === 'missing' || item?.status === 'damaged',
        );
      if (!hasBlockingChecklistItem && !value.return_inspection_notes?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['return_inspection_notes'],
          message: '要整備にする場合は検品メモまたは不足・破損の詳細が必須です',
        });
      }
    }
  });
