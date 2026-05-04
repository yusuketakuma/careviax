import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { updatePatientCareTeamSchema } from '@/lib/validations/patient';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import type { AuthContext } from '@/lib/auth/context';

async function loadPatientCases(ctx: AuthContext, patientId: string) {
  const assignmentWhere = buildCareCaseAssignmentWhere(ctx);
  return prisma.careCase.findMany({
    where: {
      org_id: ctx.orgId,
      patient_id: patientId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      status: true,
      created_at: true,
      care_team_links: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      },
    },
  });
}

function pickDefaultCaseId(cases: Array<{ id: string; status: string; created_at: Date }>) {
  return cases.find((careCase) => careCase.status === 'active')?.id ?? cases[0]?.id ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id } = await params;
  const { searchParams } = new URL(req.url);

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const cases = await loadPatientCases(ctx, id);
  const requestedCaseId = searchParams.get('case_id');
  const caseId = cases.some((careCase) => careCase.id === requestedCaseId)
    ? requestedCaseId
    : pickDefaultCaseId(cases);

  return success({
    case_id: caseId,
    cases: cases.map((careCase) => ({
      id: careCase.id,
      status: careCase.status,
    })),
    data: cases.find((careCase) => careCase.id === caseId)?.care_team_links ?? [],
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updatePatientCareTeamSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const careCase = await prisma.careCase.findFirst({
    where: {
      id: parsed.data.case_id,
      org_id: ctx.orgId,
      patient_id: id,
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
    select: { id: true },
  });
  if (!careCase) return notFound('対象ケースが見つかりません');

  try {
    const data = await withOrgContext(ctx.orgId, async (tx) => {
      const externalProfessionalIds = parsed.data.links
        .map((link) => link.external_professional_id)
        .filter((value): value is string => Boolean(value));

      if (externalProfessionalIds.length > 0) {
        const items = await tx.externalProfessional.findMany({
          where: {
            org_id: ctx.orgId,
            id: { in: externalProfessionalIds },
          },
          select: { id: true },
        });

        if (items.length !== new Set(externalProfessionalIds).size) {
          throw new Error('INVALID_EXTERNAL_PROFESSIONAL');
        }
      }

      await tx.careTeamLink.deleteMany({
        where: { org_id: ctx.orgId, case_id: careCase.id },
      });
      if (parsed.data.links.length === 0) return [];

      await tx.careTeamLink.createMany({
        data: parsed.data.links.map((link) => ({
          org_id: ctx.orgId,
          case_id: careCase.id,
          external_professional_id: link.external_professional_id || null,
          role: link.role,
          name: link.name,
          organization_name: link.organization_name || null,
          department: link.department || null,
          phone: link.phone || null,
          email: link.email || null,
          fax: link.fax || null,
          address: link.address || null,
          is_primary: link.is_primary,
          notes: link.notes || null,
        })),
      });

      return tx.careTeamLink.findMany({
        where: { org_id: ctx.orgId, case_id: careCase.id },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      });
    });

    return success({ case_id: careCase.id, data });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_EXTERNAL_PROFESSIONAL') {
      return validationError('他組織の他職種はケアチームに登録できません');
    }
    throw error;
  }
}
