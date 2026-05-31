import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { createCaseSchema } from '@/lib/validations/case';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { CASE_STATUSES } from '@/lib/patient/case-status';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import { z } from 'zod';

const caseStatusSchema = z.enum(CASE_STATUSES);

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const patientId = searchParams.get('patient_id') ?? undefined;
    const statusParam = searchParams.get('status') ?? undefined;
    const status = statusParam ? caseStatusSchema.safeParse(statusParam) : null;
    if (status && !status.success) {
      return validationError('ケースステータスが不正です', {
        status: ['対応していないステータスです'],
      });
    }
    const query = searchParams.get('q')?.trim() ?? '';

    const caseAssignmentWhere = buildCareCaseAssignmentWhere(req);

    const cases = await prisma.careCase.findMany({
      where: {
        org_id: req.orgId,
        ...(patientId ? { patient_id: patientId } : {}),
        ...(status ? { status: status.data } : {}),
        ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
        ...(query
          ? {
              patient: {
                OR: [{ name: { contains: query } }, { name_kana: { contains: query } }],
              },
            }
          : {}),
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { updated_at: 'desc' },
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            name_kana: true,
            residences: {
              where: { is_primary: true },
              select: {
                address: true,
                lat: true,
                lng: true,
              },
              take: 1,
            },
          },
        },
      },
    });

    const pharmacistIds = Array.from(
      new Set(
        cases
          .map((careCase) => careCase.primary_pharmacist_id)
          .filter((value): value is string => value != null),
      ),
    );
    const pharmacists =
      pharmacistIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: {
              org_id: req.orgId,
              id: { in: pharmacistIds },
            },
            select: {
              id: true,
              name: true,
            },
          });
    const pharmacistNameById = new Map(
      pharmacists.map((pharmacist) => [pharmacist.id, pharmacist.name]),
    );

    const hasMore = cases.length > limit;
    const data = (hasMore ? cases.slice(0, limit) : cases).map((careCase) => ({
      ...careCase,
      primary_pharmacist_name: careCase.primary_pharmacist_id
        ? (pharmacistNameById.get(careCase.primary_pharmacist_id) ?? null)
        : null,
    }));
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return success({ data, hasMore, nextCursor });
  },
  {
    permission: 'canVisit',
    message: 'ケースの閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createCaseSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { patient_id, referral_date, ...rest } = parsed.data;

    // Verify patient belongs to org
    const patient = await prisma.patient.findFirst({
      where: applyPatientAssignmentWhere({ id: patient_id, org_id: req.orgId }, req),
    });
    if (!patient) return notFound('患者が見つかりません');

    const careCase = await withOrgContext(req.orgId, async (tx) => {
      return tx.careCase.create({
        data: {
          org_id: req.orgId,
          patient_id,
          ...(referral_date ? { referral_date: new Date(referral_date) } : {}),
          ...rest,
        },
      });
    });

    return success(careCase, 201);
  },
  {
    permission: 'canVisit',
    message: 'ケースの作成権限がありません',
  },
);
