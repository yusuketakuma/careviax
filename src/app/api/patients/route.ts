import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { createPatientSchema } from '@/lib/validations/patient';
import { caseStatusValues } from '@/lib/validations/case';
import { prisma } from '@/lib/db/client';
import {
  FacilityReferenceValidationError,
  FacilityUnitReferenceValidationError,
} from '@/lib/patient/facility-reference';
import {
  listPatients,
  createPatientWithIntake,
  deriveBirthDate,
} from '@/server/services/patient-service';

const caseStatusQuerySchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const statuses = value.split(',').map((status) => status.trim());
    const invalidStatuses = statuses.filter(
      (status) => status.length === 0 || !caseStatusValues.includes(status as (typeof caseStatusValues)[number])
    );

    if (invalidStatuses.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'case_status の値が不正です',
      });
    }
  });

const patientListQuerySchema = z.object({
  q: z.string().trim().optional(),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
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
});

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const parsed = parseSearchParams(patientListQuerySchema, searchParams);
  if (!parsed.ok) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
  }

  const result = await listPatients(prisma, req.orgId, req.role, parsed.data);
  return success(result);
}, {
  permission: 'canVisit',
  message: '患者情報の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return validationError('リクエストボディが不正です');
  }

  const raw = body as Record<string, unknown>;
  const rawIntake =
    raw.intake && typeof raw.intake === 'object'
      ? (raw.intake as Record<string, unknown>)
      : undefined;
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

  try {
    const patient = await createPatientWithIntake(req.orgId, parsed.data);
    return success(patient, 201);
  } catch (error) {
    if (
      error instanceof FacilityReferenceValidationError ||
      error instanceof FacilityUnitReferenceValidationError
    ) {
      return validationError(error.message);
    }
    throw error;
  }
}, {
  permission: 'canVisit',
  message: '患者情報の作成権限がありません',
});
