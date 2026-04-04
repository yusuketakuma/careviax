import type { PrescriptionLine, DispensingDecision } from '@prisma/client';

/**
 * 処方明細行のコアフィールド（処方箋に記載された医学的情報）。
 * 非薬剤師スタッフが処方登録時に入力する。
 */
export type PrescriptionLineCore = Pick<
  PrescriptionLine,
  | 'id'
  | 'org_id'
  | 'intake_id'
  | 'line_number'
  | 'drug_name'
  | 'drug_code'
  | 'dosage_form'
  | 'dose'
  | 'frequency'
  | 'days'
  | 'quantity'
  | 'unit'
  | 'is_generic'
  | 'is_generic_name_prescription'
  | 'notes'
  | 'route'
  | 'start_date'
  | 'end_date'
>;

/**
 * 調剤準備メタデータ（処方箋記載のドラフト値）。
 * 処方登録時に入力されるが、薬剤師が DispensingDecision で確定する。
 */
export type DispensingPrepFields = Pick<
  PrescriptionLine,
  | 'dispensing_method'
  | 'packaging_method'
  | 'packaging_instructions'
  | 'packaging_instruction_tags'
  | 'packaging_group_id'
>;

/**
 * DispensingDecision のビュー型（薬剤師が確定した調剤方法）。
 */
export type DispensingDecisionView = Pick<
  DispensingDecision,
  | 'id'
  | 'task_id'
  | 'line_id'
  | 'dispensing_method'
  | 'packaging_method'
  | 'packaging_instructions'
  | 'packaging_instruction_tags'
  | 'packaging_group_id'
  | 'carry_type_override'
  | 'special_handling_notes'
  | 'temperature_category'
  | 'decided_by'
  | 'decided_at'
>;

/** Prisma select: 処方コアフィールドのみ */
export const PRESCRIPTION_LINE_CORE_SELECT = {
  id: true,
  org_id: true,
  intake_id: true,
  line_number: true,
  drug_name: true,
  drug_code: true,
  dosage_form: true,
  dose: true,
  frequency: true,
  days: true,
  quantity: true,
  unit: true,
  is_generic: true,
  is_generic_name_prescription: true,
  notes: true,
  route: true,
  start_date: true,
  end_date: true,
} as const;

/** Prisma select: 調剤準備メタデータ（ドラフト値） */
export const DISPENSING_PREP_SELECT = {
  dispensing_method: true,
  packaging_method: true,
  packaging_instructions: true,
  packaging_instruction_tags: true,
  packaging_group_id: true,
} as const;

/** Prisma select: 処方コア + 調剤準備メタデータ */
export const PRESCRIPTION_LINE_WITH_DRAFT_SELECT = {
  ...PRESCRIPTION_LINE_CORE_SELECT,
  ...DISPENSING_PREP_SELECT,
} as const;
