import { z } from 'zod';
import { dateKeySchema } from '@/lib/validations/date-key';

function hasValidEffectiveRange(value: { effective_from: string; effective_to?: string | null }) {
  if (!value.effective_to) return true;
  return value.effective_from < value.effective_to;
}

const effectiveDateSchema = dateKeySchema('日付形式が不正です');

const effectiveDateFields = {
  effective_from: effectiveDateSchema,
  effective_to: effectiveDateSchema.optional().nullable(),
};

const configField = {
  config: z.record(z.string(), z.unknown()).default({}),
};

function hasSupportedRevision(insuranceType: 'medical' | 'care', revisionCode: string) {
  if (insuranceType === 'care') return revisionCode === '2024';
  return revisionCode === '2024' || revisionCode === '2026';
}

export const pharmacySiteInsuranceConfigCreateSchema = z
  .object({
    insurance_type: z.enum(['medical', 'care']),
    revision_code: z.string().min(1, '改定年度コードは必須です'),
    revision_label: z.string().optional().nullable(),
    auto_close_overlaps: z.boolean().optional(),
    ...effectiveDateFields,
    ...configField,
  })
  .superRefine((value, ctx) => {
    if (!hasSupportedRevision(value.insurance_type, value.revision_code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.insurance_type === 'care' ? '介護保険' : '医療保険'}で未対応の改定年度です`,
        path: ['revision_code'],
      });
    }
  })
  .refine(hasValidEffectiveRange, {
    message: '適用終了日は適用開始日より後の日付を指定してください',
    path: ['effective_to'],
  });

export const pharmacySiteInsuranceConfigUpdateSchema = z
  .object({
    revision_label: z.string().optional().nullable(),
    ...effectiveDateFields,
    ...configField,
  })
  .refine(hasValidEffectiveRange, {
    message: '適用終了日は適用開始日より後の日付を指定してください',
    path: ['effective_to'],
  });

export function rangesOverlap(args: {
  nextStart: Date;
  nextEnd: Date | null;
  currentStart: Date;
  currentEnd: Date | null;
}) {
  const nextEnd = args.nextEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  const currentEnd = args.currentEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  return args.currentStart.getTime() < nextEnd && args.nextStart.getTime() < currentEnd;
}
