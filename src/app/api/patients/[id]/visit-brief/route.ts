import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { getPatientVisitBrief } from '@/server/services/visit-brief';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { listAccessiblePatientCaseIds } from '@/server/services/patient-access';

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者要約の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

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
    role: ctx.role,
    userId: ctx.userId,
  });

  return success({ data: brief });
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
