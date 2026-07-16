import { z } from 'zod';
import { formatUtcDateKey } from '@/lib/date-key';
import { dateKeySchema } from '@/lib/validations/date-key';

export const PATIENT_INSURANCE_TYPES = ['medical', 'care', 'public_subsidy'] as const;
export const PATIENT_INSURANCE_APPLICATION_STATUSES = [
  'confirmed',
  'applying',
  'change_pending',
  'not_applicable',
] as const;
export const OFFICIAL_CARE_LEVELS = [
  'support_1',
  'support_2',
  'care_1',
  'care_2',
  'care_3',
  'care_4',
  'care_5',
] as const;

const dateStringSchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');
const publicProgramCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}$/, '公費制度コードが不正です');
const officialCareLevelSchema = z.enum(OFFICIAL_CARE_LEVELS);

const patientInsuranceBaseSchema = z.object({
  insurance_type: z.enum(PATIENT_INSURANCE_TYPES),
  application_status: z.enum(PATIENT_INSURANCE_APPLICATION_STATUSES).optional(),
  insurer_number: z.string().max(8).optional().nullable(),
  public_program_code: publicProgramCodeSchema.optional().nullable(),
  symbol: z.string().max(100).optional().nullable(),
  number: z.string().max(20).optional().nullable(),
  branch_number: z.string().max(2).optional().nullable(),
  copay_ratio: z.number().int().min(0).max(100).optional().nullable(),
  valid_from: dateStringSchema.optional().nullable(),
  valid_until: dateStringSchema.optional().nullable(),
  application_submitted_at: dateStringSchema.optional().nullable(),
  decision_at: dateStringSchema.optional().nullable(),
  previous_care_level: officialCareLevelSchema.optional().nullable(),
  provisional_care_level: officialCareLevelSchema.optional().nullable(),
  confirmed_care_level: officialCareLevelSchema.optional().nullable(),
  is_active: z.boolean().optional(),
  notes: z.string().max(500).optional().nullable(),
});

type PatientInsuranceInvariantInput = z.infer<typeof patientInsuranceBaseSchema>;

function addPatientInsuranceInvariantIssues(
  value: PatientInsuranceInvariantInput,
  ctx: z.RefinementCtx,
) {
  if (value.valid_from && value.valid_until && value.valid_from > value.valid_until) {
    ctx.addIssue({
      code: 'custom',
      path: ['valid_until'],
      message: '有効期限は有効開始日以降の日付を指定してください',
    });
  }

  if (
    value.application_submitted_at &&
    value.decision_at &&
    value.application_submitted_at > value.decision_at
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['decision_at'],
      message: '決定日は申請日以降の日付を指定してください',
    });
  }

  if (value.insurance_type === 'public_subsidy') {
    if (!value.public_program_code) {
      ctx.addIssue({
        code: 'custom',
        path: ['public_program_code'],
        message: '公費保険には公費制度コードが必要です',
      });
    }
  } else if (value.public_program_code) {
    ctx.addIssue({
      code: 'custom',
      path: ['public_program_code'],
      message: '公費制度コードは公費保険でのみ指定できます',
    });
  }

  if (value.insurance_type !== 'care') {
    if (value.previous_care_level || value.provisional_care_level || value.confirmed_care_level) {
      ctx.addIssue({
        code: 'custom',
        path: ['previous_care_level'],
        message: '介護度情報は介護保険でのみ指定できます',
      });
    }
  } else if (value.is_active !== false) {
    const status = value.application_status ?? 'confirmed';
    if (status === 'confirmed' && !value.confirmed_care_level) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmed_care_level'],
        message: '確定済みの介護保険には要介護状態区分が必要です',
      });
    }
    if (status === 'change_pending') {
      if (!value.previous_care_level) {
        ctx.addIssue({
          code: 'custom',
          path: ['previous_care_level'],
          message: '区分変更中の介護保険には変更前区分が必要です',
        });
      }
      if (!value.provisional_care_level) {
        ctx.addIssue({
          code: 'custom',
          path: ['provisional_care_level'],
          message: '区分変更中の介護保険には暫定区分が必要です',
        });
      }
    }
  }

  if (value.insurance_type === 'medical' && value.application_status === 'change_pending') {
    ctx.addIssue({
      code: 'custom',
      path: ['application_status'],
      message: '区分変更中は介護保険または公費保険で指定してください',
    });
  }
}

export const patientInsuranceCreateSchema = patientInsuranceBaseSchema.superRefine(
  addPatientInsuranceInvariantIssues,
);

export const patientInsuranceUpdateSchema = patientInsuranceBaseSchema
  .partial()
  .superRefine((value, ctx) => {
    if (value.valid_from && value.valid_until && value.valid_from > value.valid_until) {
      ctx.addIssue({
        code: 'custom',
        path: ['valid_until'],
        message: '有効期限は有効開始日以降の日付を指定してください',
      });
    }
    if (
      value.application_submitted_at &&
      value.decision_at &&
      value.application_submitted_at > value.decision_at
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['decision_at'],
        message: '決定日は申請日以降の日付を指定してください',
      });
    }
    if (
      value.insurance_type &&
      value.insurance_type !== 'public_subsidy' &&
      value.public_program_code
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['public_program_code'],
        message: '公費制度コードは公費保険でのみ指定できます',
      });
    }
    if (
      value.insurance_type &&
      value.insurance_type !== 'care' &&
      (value.previous_care_level || value.provisional_care_level || value.confirmed_care_level)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['previous_care_level'],
        message: '介護度情報は介護保険でのみ指定できます',
      });
    }
    if (value.insurance_type === 'medical' && value.application_status === 'change_pending') {
      ctx.addIssue({
        code: 'custom',
        path: ['application_status'],
        message: '区分変更中は介護保険または公費保険で指定してください',
      });
    }
  });

export type PatientInsuranceType = (typeof PATIENT_INSURANCE_TYPES)[number];
export type PatientInsuranceApplicationStatus =
  (typeof PATIENT_INSURANCE_APPLICATION_STATUSES)[number];
export type OfficialCareLevel = (typeof OFFICIAL_CARE_LEVELS)[number];
export type PatientInsuranceUpdateInput = z.infer<typeof patientInsuranceUpdateSchema>;

function normalizePersistedCareLevel(value: string | null): OfficialCareLevel | null {
  const parsed = officialCareLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type PersistedPatientInsuranceInvariantState = {
  insurance_type: PatientInsuranceType;
  application_status: PatientInsuranceApplicationStatus;
  public_program_code: string | null;
  valid_from: Date | string | null;
  valid_until: Date | string | null;
  application_submitted_at: Date | string | null;
  decision_at: Date | string | null;
  previous_care_level: string | null;
  provisional_care_level: string | null;
  confirmed_care_level: string | null;
  is_active: boolean;
};

function toDateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? formatUtcDateKey(value) : value;
}

function patchedValue<T>(patchValue: T | undefined, existingValue: T): T {
  return patchValue === undefined ? existingValue : patchValue;
}

export function buildEffectivePatientInsuranceInput(
  existing: PersistedPatientInsuranceInvariantState,
  patch: PatientInsuranceUpdateInput,
): PatientInsuranceInvariantInput {
  const insuranceType = patch.insurance_type ?? existing.insurance_type;

  return {
    insurance_type: insuranceType,
    application_status: patch.application_status ?? existing.application_status,
    public_program_code:
      insuranceType === 'public_subsidy'
        ? patchedValue(patch.public_program_code, existing.public_program_code)
        : (patch.public_program_code ?? null),
    valid_from: patchedValue(patch.valid_from, toDateKey(existing.valid_from)),
    valid_until: patchedValue(patch.valid_until, toDateKey(existing.valid_until)),
    application_submitted_at: patchedValue(
      patch.application_submitted_at,
      toDateKey(existing.application_submitted_at),
    ),
    decision_at: patchedValue(patch.decision_at, toDateKey(existing.decision_at)),
    previous_care_level:
      insuranceType === 'care'
        ? patchedValue(
            patch.previous_care_level,
            normalizePersistedCareLevel(existing.previous_care_level),
          )
        : (patch.previous_care_level ?? null),
    provisional_care_level:
      insuranceType === 'care'
        ? patchedValue(
            patch.provisional_care_level,
            normalizePersistedCareLevel(existing.provisional_care_level),
          )
        : (patch.provisional_care_level ?? null),
    confirmed_care_level:
      insuranceType === 'care'
        ? patchedValue(
            patch.confirmed_care_level,
            normalizePersistedCareLevel(existing.confirmed_care_level),
          )
        : (patch.confirmed_care_level ?? null),
    is_active: patch.is_active ?? existing.is_active,
  };
}

export function validateEffectivePatientInsuranceUpdate(
  existing: PersistedPatientInsuranceInvariantState,
  patch: PatientInsuranceUpdateInput,
) {
  return patientInsuranceCreateSchema.safeParse(
    buildEffectivePatientInsuranceInput(existing, patch),
  );
}

export function incompatiblePatientInsuranceFieldClears(insuranceType: PatientInsuranceType) {
  return {
    ...(insuranceType === 'public_subsidy' ? {} : { public_program_code: null }),
    ...(insuranceType === 'care'
      ? {}
      : {
          previous_care_level: null,
          provisional_care_level: null,
          confirmed_care_level: null,
        }),
  };
}
