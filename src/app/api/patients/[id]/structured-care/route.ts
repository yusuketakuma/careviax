import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { listPatientStructuredCare } from '@/server/services/patient-structured-care-list';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const includeEnded = new URL(req.url).searchParams.get('include_ended') === 'true';

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role }
    ),
    select: { id: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const data = await listPatientStructuredCare(prisma, {
    orgId: ctx.orgId,
    patientId: id,
    includeEnded,
  });

  return success({ data });
}
