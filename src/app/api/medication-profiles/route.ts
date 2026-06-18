import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { createMedicationProfileSchema } from '@/lib/validations/medication';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { buildPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { canAccessPatient } from '@/server/services/patient-access';
import type { Prisma } from '@prisma/client';

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const patientId = searchParams.get('patient_id') ?? undefined;
    const isCurrentParam = searchParams.get('is_current');
    const isCurrent =
      isCurrentParam === 'true' ? true : isCurrentParam === 'false' ? false : undefined;

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
      return success({ data: [], hasMore: false, nextCursor: undefined });
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

    return success(buildCursorPage(profiles, limit, (profile) => profile.id));
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
