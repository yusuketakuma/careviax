import { z } from 'zod';

/**
 * 調剤準備メタデータのバリデーションスキーマ。
 *
 * PrescriptionLine に保存される「ドラフト値」のバリデーションに使用。
 * 処方登録時にスタッフが入力する調剤方法の指示（処方箋記載ベース）。
 * 最終確定は DispensingDecision テーブルで薬剤師が行う。
 */
export const dispensingLineMetadataSchema = z.object({
  dispensing_method: z.enum(['standard', 'unit_dose', 'crushed', 'other']).optional(),
  packaging_instructions: z.string().optional(),
});

export type DispensingLineMetadataInput = z.infer<typeof dispensingLineMetadataSchema>;
