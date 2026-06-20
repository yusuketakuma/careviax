import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { conflict, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { optionalBoundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { createPatientSchema } from '@/lib/validations/patient';
import { caseStatusSchema } from '@/lib/patient/case-status';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import {
  FacilityReferenceValidationError,
  FacilityUnitReferenceValidationError,
} from '@/lib/patient/facility-reference';
import {
  listPatients,
  listPatientPaletteSearchSummaries,
  createPatientWithIntake,
  deriveBirthDate,
} from '@/server/services/patient-service';
import {
  findPatientDuplicateCandidates,
  parsePatientDuplicateBirthDate,
} from '@/lib/patient/duplicate-detection';

const caseStatusQuerySchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const statuses = value.split(',').map((status) => status.trim());
    const invalidStatuses = statuses.filter(
      (status) => status.length === 0 || !caseStatusSchema.safeParse(status).success,
    );

    if (invalidStatuses.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'case_status の値が不正です',
      });
    }
  });

const patientListQuerySchema = z.object({
  view: z.enum(['palette']).optional(),
  q: z.string().trim().optional(),
  cursor: z.string().trim().optional(),
  limit: optionalBoundedIntegerSearchParam('limit', 1, 500),
  sort: z.enum(['name_kana', 'name', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  facility_mode: z.enum(['facility', 'home']).optional(),
  consent_status: z.enum(['complete', 'missing']).optional(),
  risk_level: z.enum(['stable', 'watch', 'high']).optional(),
  last_visit: z.enum(['within_30_days', 'none']).optional(),
  case_status: caseStatusQuerySchema.optional(),
  primary_pharmacist_id: z.string().trim().optional(),
  building_id: z.string().trim().optional(),
  billing_support: z.enum(['true', 'false']).optional(),
  payer_basis: z.enum(['medical', 'care', 'self']).optional(),
  last_visit_from: z.string().date().optional(),
  last_visit_to: z.string().date().optional(),
  readiness_issue: z
    .enum([
      'missing_visit_consent',
      'missing_management_plan',
      'missing_emergency_contact',
      'missing_primary_physician',
      'missing_first_visit_doc',
    ])
    .optional(),
  foundation_issue: z
    .enum([
      'needs_confirmation',
      'missing_contact',
      'missing_parking',
      'missing_care_level',
      'missing_insurance',
      'missing_care_team',
    ])
    .optional(),
});

function findUnsupportedPalettePatientFilters(filters: z.infer<typeof patientListQuerySchema>) {
  const unsupportedKeys = [
    'cursor',
    'facility_mode',
    'consent_status',
    'risk_level',
    'last_visit',
    'case_status',
    'primary_pharmacist_id',
    'building_id',
    'billing_support',
    'payer_basis',
    'last_visit_from',
    'last_visit_to',
    'readiness_issue',
    'foundation_issue',
  ] as const;

  return unsupportedKeys.filter((key) => filters[key] !== undefined);
}

function validatePatientPaletteLimit(limit: number | undefined) {
  if (limit === undefined || limit <= 50) {
    return null;
  }

  return validationError('limit は 1〜50 の整数で指定してください', {
    limit: ['palette 表示では limit は 1〜50 の整数で指定してください'],
  });
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsed = parseSearchParams(patientListQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    if (parsed.data.view === 'palette') {
      const unsupportedPaletteFilters = findUnsupportedPalettePatientFilters(parsed.data);
      if (unsupportedPaletteFilters.length > 0) {
        return validationError(
          'palette 表示では対応していない検索条件です',
          Object.fromEntries(
            unsupportedPaletteFilters.map((key) => [
              key,
              ['palette 表示では q/limit/sort/order のみ指定できます'],
            ]),
          ),
        );
      }
      const limitValidationResponse = validatePatientPaletteLimit(parsed.data.limit);
      if (limitValidationResponse) {
        return limitValidationResponse;
      }
      const result = await listPatientPaletteSearchSummaries(prisma, ctx.orgId, parsed.data, {
        userId: ctx.userId,
        role: ctx.role,
      });
      return success(result);
    }

    const result = await listPatients(prisma, ctx.orgId, ctx.role, parsed.data, {
      userId: ctx.userId,
      role: ctx.role,
    });
    return success(result);
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const raw = await readJsonObjectRequestBody(req);
    if (!raw) {
      return validationError('リクエストボディが不正です');
    }

    const rawIntake = readJsonObject(raw.intake) ?? undefined;
    const normalizedBody = {
      ...raw,
      name_kana:
        typeof raw.name_kana === 'string' && raw.name_kana.trim().length > 0
          ? raw.name_kana
          : raw.name,
      birth_date:
        typeof raw.birth_date === 'string'
          ? raw.birth_date
          : deriveBirthDate(
              undefined,
              typeof rawIntake?.age === 'number' ? rawIntake.age : undefined,
            ),
    };

    const parsed = createPatientSchema.safeParse(normalizedBody);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }
    const duplicateAcknowledged = raw.duplicate_acknowledged === true;
    const birthDate = parsePatientDuplicateBirthDate(parsed.data.birth_date);
    if (!birthDate) return validationError('生年月日の形式が不正です');
    const duplicates = await findPatientDuplicateCandidates(prisma, {
      orgId: ctx.orgId,
      name: parsed.data.name,
      birthDate,
      gender: parsed.data.gender,
      access: {
        userId: ctx.userId,
        role: ctx.role,
      },
    });
    if (duplicates.length > 0 && !duplicateAcknowledged) {
      return conflict('重複している可能性がある患者が存在します', {
        duplicate_type: 'patient_identity',
        duplicates,
      });
    }

    try {
      const patient = await createPatientWithIntake(ctx.orgId, parsed.data);
      return success(
        {
          ...patient,
          warnings:
            duplicates.length > 0
              ? [
                  {
                    code: 'PATIENT_DUPLICATE_ACKNOWLEDGED',
                    severity: 'warning',
                    message: '重複候補を確認済みとして患者を登録しました。',
                  },
                ]
              : [],
          metadata: {
            duplicate_candidates: duplicates,
          },
        },
        201,
      );
    } catch (error) {
      if (
        error instanceof FacilityReferenceValidationError ||
        error instanceof FacilityUnitReferenceValidationError
      ) {
        return validationError(error.message);
      }
      throw error;
    }
  },
  {
    permission: 'canVisit',
    message: '患者情報の作成権限がありません',
  },
);
