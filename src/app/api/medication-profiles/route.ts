import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createMedicationProfileSchema } from '@/lib/validations/medication';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { buildPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { canAccessPatient } from '@/server/services/patient-access';
import type { Prisma } from '@prisma/client';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const patientId = searchParams.get('patient_id') ?? undefined;
    const isCurrentParam = searchParams.get('is_current');
    const isCurrent =
      isCurrentParam === 'true' ? true : isCurrentParam === 'false' ? false : undefined;

    const accessContext = { userId: req.userId, role: req.role };
    if (
      patientId &&
      !(await canAccessPatient({
        db: prisma,
        orgId: req.orgId,
        patientId,
        accessContext,
      }))
    ) {
      return success({ data: [], hasMore: false, nextCursor: undefined });
    }

    const patientAssignmentWhere = buildPatientAssignmentWhere(accessContext);
    const where: Prisma.MedicationProfileWhereInput = {
      org_id: req.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(isCurrent !== undefined ? { is_current: isCurrent } : {}),
      ...(patientAssignmentWhere ? { patient: patientAssignmentWhere } : {}),
    };

    const profiles = await prisma.medicationProfile.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { created_at: 'desc' },
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

    const hasMore = profiles.length > limit;
    const data = hasMore ? profiles.slice(0, limit) : profiles;
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return success({ data, hasMore, nextCursor });
  },
  {
    permission: 'canVisit',
    message: '薬剤プロファイルの閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
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
        orgId: req.orgId,
        patientId: patient_id,
        accessContext: { userId: req.userId, role: req.role },
      }))
    ) {
      return notFound('患者が見つかりません');
    }

    const profile = await withOrgContext(req.orgId, async (tx) => {
      return tx.medicationProfile.create({
        data: {
          org_id: req.orgId,
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
