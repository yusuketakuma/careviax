import { z } from 'zod';
import {
  PACKAGING_INSTRUCTION_TAG_OPTIONS,
  PACKAGING_METHOD_OPTIONS,
  extractPackagingInstructionTags,
  type PackagingInstructionTagValue,
  type PackagingMethodValue,
} from '../dispensing/packaging';

const PACKAGING_METHOD_VALUES = PACKAGING_METHOD_OPTIONS.map((option) => option.value) as [
  PackagingMethodValue,
  ...PackagingMethodValue[],
];
const PACKAGING_TAG_VALUES = PACKAGING_INSTRUCTION_TAG_OPTIONS.map((option) => option.value) as [
  PackagingInstructionTagValue,
  ...PackagingInstructionTagValue[],
];

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
  z.string().trim().pipe(z.enum(PACKAGING_METHOD_VALUES)).optional(),
);

const packagingInstructionTagSchema = z.enum(PACKAGING_TAG_VALUES);

export type PackagingConsistencyInput = {
  dispensing_method?: 'standard' | 'unit_dose' | 'crushed' | 'other' | null;
  packaging_method?: PackagingMethodValue | null;
  packaging_instructions?: string | null;
  packaging_instruction_tags?: PackagingInstructionTagValue[] | null;
};

export function validatePackagingInstructionConsistency(
  value: PackagingConsistencyInput,
  ctx: z.RefinementCtx,
) {
  const tags = value.packaging_instruction_tags ?? [];
  if (new Set(tags).size !== tags.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['packaging_instruction_tags'],
      message: '包装タグが重複しています',
    });
  }

  const effectiveTags = new Set([
    ...tags,
    ...extractPackagingInstructionTags({
      packagingInstructions: value.packaging_instructions,
      packagingMethod: value.packaging_method,
    }),
  ]);

  if (!effectiveTags.has('no_unit_dose')) return;

  if (effectiveTags.has('unit_dose')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['packaging_instruction_tags'],
      message: '一包化しない指示と一包化タグは同時に指定できません',
    });
  }
  if (
    value.packaging_method === 'unit_dose' ||
    value.packaging_method === 'morning_evening_unit_dose'
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['packaging_method'],
      message: '一包化しない指示と一包化包装方法は同時に指定できません',
    });
  }
  if (value.dispensing_method === 'unit_dose') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dispensing_method'],
      message: '一包化しない指示と一包化調剤方法は同時に指定できません',
    });
  }
}

/**
 * 調剤準備メタデータのバリデーションスキーマ。
 *
 * PrescriptionLine に保存される「ドラフト値」のバリデーションに使用。
 * 処方登録時にスタッフが入力する調剤方法の指示（処方箋記載ベース）。
 * 最終確定は DispensingDecision テーブルで薬剤師が行う。
 */
export const dispensingLineMetadataSchema = z
  .object({
    dispensing_method: dispensingMethodSchema,
    packaging_method: packagingMethodSchema,
    packaging_instructions: optionalTrimmedStringSchema,
    packaging_instruction_tags: z.array(packagingInstructionTagSchema).optional(),
  })
  .superRefine(validatePackagingInstructionConsistency);

export function collectDispensingLineMetadataValidationDetails(
  lines: readonly PackagingConsistencyInput[],
) {
  const details: Record<string, string[]> = {};

  lines.forEach((line, index) => {
    const parsed = dispensingLineMetadataSchema.safeParse(line);
    if (parsed.success) return;

    for (const issue of parsed.error.issues) {
      const key = ['lines', String(index), ...issue.path.map(String)].join('.');
      details[key] = [...(details[key] ?? []), issue.message];
    }
  });

  return Object.keys(details).length > 0 ? details : null;
}

export type DispensingLineMetadataInput = z.infer<typeof dispensingLineMetadataSchema>;
