import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { getPatientVisitBrief } from '@/server/services/visit-brief';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { listAccessiblePatientCaseIds } from '@/server/services/patient-access';

async function authenticatedGET(
  req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ id: string }> },
) {
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

  recordPhiReadAuditForRequest(ctx, {
    patientId: patient.id,
    targetType: 'patient',
    targetId: patient.id,
    view: 'patient_visit_brief',
    purpose: 'care',
  });

  return success({ data: brief });
}

export const GET = withAuthContext(authenticatedGET, {
  permission: 'canViewDashboard',
  message: '患者要約の閲覧権限がありません',
});
