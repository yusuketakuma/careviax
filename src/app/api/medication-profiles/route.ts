import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { createMedicationProfileSchema } from '@/lib/validations/medication';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { buildPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { canAccessPatient } from '@/server/services/patient-access';
import type { Prisma } from '@prisma/client';

function readStrictOptionalPatientFilter(searchParams: URLSearchParams) {
  const values = searchParams.getAll('patient_id');
  if (values.length === 0) return { ok: true as const, value: undefined };
  if (values.length > 1) {
    return {
      ok: false as const,
      fieldErrors: { patient_id: ['patient_id は1つだけ指定してください'] },
    };
  }

  const value = values[0];
  if (value.trim().length === 0) {
    return {
      ok: false as const,
      fieldErrors: { patient_id: ['患者IDを指定してください'] },
    };
  }

  if (value !== value.trim() || value.length > 100) {
    return {
      ok: false as const,
      fieldErrors: { patient_id: ['患者IDの形式が不正です'] },
    };
  }

  return { ok: true as const, value };
}

function readStrictOptionalCurrentFilter(searchParams: URLSearchParams) {
  const values = searchParams.getAll('is_current');
  if (values.length === 0) return { ok: true as const, value: undefined };
  if (values.length > 1) {
    return {
      ok: false as const,
      fieldErrors: { is_current: ['is_current は1つだけ指定してください'] },
    };
  }

  const value = values[0];
  if (value !== 'true' && value !== 'false') {
    return {
      ok: false as const,
      fieldErrors: { is_current: ['is_current は true または false で指定してください'] },
    };
  }

  return { ok: true as const, value: value === 'true' };
}

function parseMedicationProfileListFilters(searchParams: URLSearchParams) {
  const patientResult = readStrictOptionalPatientFilter(searchParams);
  if (!patientResult.ok) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(
        validationError('検索条件が不正です', patientResult.fieldErrors),
      ),
    };
  }

  const currentResult = readStrictOptionalCurrentFilter(searchParams);
  if (!currentResult.ok) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(
        validationError('検索条件が不正です', currentResult.fieldErrors),
      ),
    };
  }

  return {
    ok: true as const,
    patientId: patientResult.value,
    isCurrent: currentResult.value,
  };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const filters = parseMedicationProfileListFilters(searchParams);
    if (!filters.ok) return filters.response;

    const { patientId, isCurrent } = filters;

    const accessContext = { userId: ctx.userId, role: ctx.role };
    if (
      patientId &&
      !(await canAccessPatient({
        db: prisma,
        orgId: ctx.orgId,
        patientId,
        accessContext,
      }))
    ) {
      return withSensitiveNoStore(success({ data: [], hasMore: false, nextCursor: undefined }));
    }

    const patientAssignmentWhere = buildPatientAssignmentWhere(accessContext);
    const where: Prisma.MedicationProfileWhereInput = {
      org_id: ctx.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(isCurrent !== undefined ? { is_current: isCurrent } : {}),
      ...(patientAssignmentWhere ? { patient: patientAssignmentWhere } : {}),
    };

    const profiles = await prisma.medicationProfile.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        drug_master_id: true,
        drug_name: true,
        dose: true,
        frequency: true,
        start_date: true,
        end_date: true,
        prescriber: true,
        is_current: true,
        source: true,
        created_at: true,
        updated_at: true,
      },
    });

    return withSensitiveNoStore(success(buildCursorPage(profiles, limit, (profile) => profile.id)));
  },
  {
    permission: 'canVisit',
    message: '薬剤プロファイルの閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createMedicationProfileSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { patient_id, start_date, end_date, ...rest } = parsed.data;

    if (
      !(await canAccessPatient({
        db: prisma,
        orgId: ctx.orgId,
        patientId: patient_id,
        accessContext: { userId: ctx.userId, role: ctx.role },
      }))
    ) {
      return notFound('患者が見つかりません');
    }

    const profile = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.medicationProfile.create({
        data: {
          org_id: ctx.orgId,
          patient_id,
          ...(start_date ? { start_date: new Date(start_date) } : {}),
          ...(end_date ? { end_date: new Date(end_date) } : {}),
          ...rest,
        },
      });
    });

    return success({ data: profile }, 201);
  },
  {
    permission: 'canVisit',
    message: '薬剤プロファイルの作成権限がありません',
  },
);
