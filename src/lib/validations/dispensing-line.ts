import { z } from 'zod';

const optionalTrimmedStringSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().optional(),
);

const dispensingMethodSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z
    .string()
    .trim()
    .pipe(z.enum(['standard', 'unit_dose', 'crushed', 'other']))
    .optional(),
);

const packagingMethodSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z
    .string()
    .trim()
    .pipe(
      z.enum([
        'none',
        'unit_dose',
        'morning_evening_unit_dose',
        'medication_box',
        'calendar_pack',
        'blister_pack',
        'crush_and_pack',
        'other',
      ]),
    )
    .optional(),
);

const packagingInstructionTagSchema = z.enum([
  'cold_storage',
  'narcotic',
  'half_tablet',
  'crush_prohibited',
  'separate_pack',
  'unit_dose',
  'staple_required',
  'label_required',
]);

/**
 * 調剤準備メタデータのバリデーションスキーマ。
 *
 * PrescriptionLine に保存される「ドラフト値」のバリデーションに使用。
 * 処方登録時にスタッフが入力する調剤方法の指示（処方箋記載ベース）。
 * 最終確定は DispensingDecision テーブルで薬剤師が行う。
 */
export const dispensingLineMetadataSchema = z.object({
  dispensing_method: dispensingMethodSchema,
  packaging_method: packagingMethodSchema,
  packaging_instructions: optionalTrimmedStringSchema,
  packaging_instruction_tags: z.array(packagingInstructionTagSchema).optional(),
});

export type DispensingLineMetadataInput = z.infer<typeof dispensingLineMetadataSchema>;
