import { DISPENSE_SAFETY_CHECKLIST_ACK } from '@/lib/dispensing/safety-checklist';
import { z } from 'zod';

export const dispenseResultLineSchema = z.object({
  line_id: z.string().min(1),
  actual_drug_name: z.string().min(1, '実薬剤名は必須です'),
  actual_drug_code: z.string().optional(),
  actual_quantity: z.number().positive('数量は正の数を入力してください'),
  actual_quantity_confirmed: z.boolean().optional(),
  actual_quantity_source: z
    .enum(['existing_result', 'prescription_quantity_confirmed', 'manual_entry'])
    .optional(),
  actual_unit: z.string().optional(),
  discrepancy_reason: z.string().optional(),
  carry_type: z.enum(['carry', 'facility_deposit', 'deferred']),
  special_notes: z.string().optional(),
  is_unit_dose: z.boolean().optional(),
  is_crushed: z.boolean().optional(),
  packaging_method: z
    .enum([
      'none',
      'unit_dose',
      'morning_evening_unit_dose',
      'medication_box',
      'calendar_pack',
      'blister_pack',
      'crush_and_pack',
      'other',
    ])
    .optional(),
  packaging_group_id: z.string().optional(),
  barcode_scan: z
    .object({
      barcode: z.string().trim().min(1, 'バーコードは必須です').max(512),
    })
    .strict()
    .optional(),
});

const dispenseSafetyChecklistSchema = z.object({
  patient_identity: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.patient_identity),
  drug_name_strength: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.drug_name_strength),
  quantity_days: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.quantity_days),
  directions_route: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.directions_route),
  packaging_storage: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.packaging_storage),
  cds_alerts_reviewed: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.cds_alerts_reviewed),
});

export const createDispenseResultSchema = z
  .object({
    task_id: z.string().min(1),
    lines: z.array(dispenseResultLineSchema).min(1, '調剤実績を1件以上入力してください'),
    safety_checklist: dispenseSafetyChecklistSchema.optional(),
    // Optimistic lock against the cycle version shown in the workbench.
    expected_version: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    const seenLineIds = new Set<string>();
    for (const line of value.lines) {
      if (seenLineIds.has(line.line_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lines'],
          message: '同じ line_id を複数指定できません',
        });
        return;
      }
      seenLineIds.add(line.line_id);
    }
  });

export type SubmittedDispenseResultLine = z.infer<typeof dispenseResultLineSchema>;
