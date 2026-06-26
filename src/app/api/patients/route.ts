import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { conflict, internalError, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
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
  listPatientMatchSummaries,
  listPatientPaletteSearchSummaries,
  listPatientSearchResultSummaries,
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
  view: z.enum(['palette', 'search', 'match']).optional(),
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

const patientListSingleValueQueryNames = [
  'view',
  'q',
  'cursor',
  'limit',
  'sort',
  'order',
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
] as const satisfies readonly (keyof z.infer<typeof patientListQuerySchema>)[];

function findDuplicatePatientListQueryParams(searchParams: URLSearchParams) {
  const fieldErrors: Record<string, string[]> = {};

  for (const name of patientListSingleValueQueryNames) {
    if (searchParams.getAll(name).length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

function findUnsupportedMinimalPatientFilters(filters: z.infer<typeof patientListQuerySchema>) {
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

function validatePatientMinimalViewLimit(
  view: 'palette' | 'search' | 'match',
  limit: number | undefined,
) {
  if (limit === undefined || limit <= 50) {
    return null;
  }

  return validationError('limit は 1〜50 の整数で指定してください', {
    limit: [`${view} 表示では limit は 1〜50 の整数で指定してください`],
  });
}

function validatePatientMatchQuery(query: string | undefined) {
  if (query !== undefined && query.trim().length > 0) {
    return null;
  }

  return validationError('match 表示では q を指定してください', {
    q: ['match 表示では q を指定してください'],
  });
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const duplicateFieldErrors = findDuplicatePatientListQueryParams(searchParams);
    if (duplicateFieldErrors) {
      return validationError('クエリパラメータが不正です', duplicateFieldErrors);
    }

    const parsed = parseSearchParams(patientListQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    if (parsed.data.view === 'palette') {
      const unsupportedPaletteFilters = findUnsupportedMinimalPatientFilters(parsed.data);
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
      const limitValidationResponse = validatePatientMinimalViewLimit('palette', parsed.data.limit);
      if (limitValidationResponse) {
        return limitValidationResponse;
      }
      const result = await listPatientPaletteSearchSummaries(prisma, ctx.orgId, parsed.data, {
        userId: ctx.userId,
        role: ctx.role,
      });
      return success(result);
    }

    if (parsed.data.view === 'search') {
      const unsupportedSearchFilters = findUnsupportedMinimalPatientFilters(parsed.data);
      if (unsupportedSearchFilters.length > 0) {
        return validationError(
          'search 表示では対応していない検索条件です',
          Object.fromEntries(
            unsupportedSearchFilters.map((key) => [
              key,
              ['search 表示では q/limit/sort/order のみ指定できます'],
            ]),
          ),
        );
      }
      const limitValidationResponse = validatePatientMinimalViewLimit('search', parsed.data.limit);
      if (limitValidationResponse) {
        return limitValidationResponse;
      }
      const result = await listPatientSearchResultSummaries(prisma, ctx.orgId, parsed.data, {
        userId: ctx.userId,
        role: ctx.role,
      });
      return success(result);
    }

    if (parsed.data.view === 'match') {
      const unsupportedMatchFilters = findUnsupportedMinimalPatientFilters(parsed.data);
      if (unsupportedMatchFilters.length > 0) {
        return validationError(
          'match 表示では対応していない検索条件です',
          Object.fromEntries(
            unsupportedMatchFilters.map((key) => [
              key,
              ['match 表示では q/limit/sort/order のみ指定できます'],
            ]),
          ),
        );
      }
      const limitValidationResponse = validatePatientMinimalViewLimit('match', parsed.data.limit);
      if (limitValidationResponse) {
        return limitValidationResponse;
      }
      const queryValidationResponse = validatePatientMatchQuery(parsed.data.q);
      if (queryValidationResponse) {
        return queryValidationResponse;
      }
      const result = await listPatientMatchSummaries(prisma, ctx.orgId, parsed.data, {
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

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
};

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
