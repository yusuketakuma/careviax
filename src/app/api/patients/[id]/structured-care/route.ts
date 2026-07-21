import { NextRequest } from 'next/server';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { withOrgContext } from '@/lib/db/rls';
import { listPatientStructuredCare } from '@/server/services/patient-structured-care-list';

async function authenticatedGET(
  req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const includeEnded = new URL(req.url).searchParams.get('include_ended') === 'true';

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const patient = await tx.patient.findFirst({
        where: applyPatientAssignmentWhere(
          { id, org_id: ctx.orgId },
          { userId: ctx.userId, role: ctx.role },
        ),
        select: { id: true },
      });
      if (!patient) return null;

      const data = await listPatientStructuredCare(tx, {
        orgId: ctx.orgId,
        patientId: patient.id,
        includeEnded,
      });
      return { data, patientId: patient.id };
    },
    { requestContext: ctx },
  );
  if (!result) return notFound('患者が見つかりません');

  recordPhiReadAuditForRequest(ctx, {
    patientId: result.patientId,
    view: 'patient_structured_care',
    purpose: 'care',
  });

  return success({ data: result.data });
}

export const GET = withAuthContext(authenticatedGET, {
  permission: 'canViewDashboard',
  message: '患者情報の閲覧権限がありません',
});
