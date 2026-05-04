import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { notFound, success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { getPatientVisitBrief } from '@/server/services/visit-brief';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { listAccessiblePatientCaseIds } from '@/server/services/patient-access';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者要約の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true },
  });

  if (!patient) return notFound('患者が見つかりません');

  const caseIds = await listAccessiblePatientCaseIds({
    db: prisma,
    orgId: ctx.orgId,
    patientId: id,
    accessContext: { userId: ctx.userId, role: ctx.role },
  });

  const brief = await getPatientVisitBrief(prisma, {
    orgId: ctx.orgId,
    patientId: id,
    context: 'patient',
    caseIds,
  });

  return success({ data: brief });
}
