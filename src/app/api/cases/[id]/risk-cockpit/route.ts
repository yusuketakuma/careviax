import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound } from '@/lib/api/response';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { withOrgContext } from '@/lib/db/rls';
import { getCaseRiskCockpit } from '@/server/services/case-risk-cockpit';

async function caseRiskCockpitGET(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('ケースIDが不正です');

  const cockpit = await withOrgContext(
    ctx.orgId,
    (tx) =>
      getCaseRiskCockpit(tx, {
        orgId: ctx.orgId,
        caseId: id,
        userId: ctx.userId,
        role: ctx.role,
      }),
    { requestContext: ctx },
  );
  if (!cockpit) return notFound('ケースが見つかりません');

  recordPhiReadAuditForRequest(ctx, {
    patientId: cockpit.patient.id,
    targetType: 'care_case',
    targetId: cockpit.case.id,
    view: 'case_risk_cockpit',
  });

  return success({ data: cockpit });
}

export const GET = withAuthContext(caseRiskCockpitGET, {
  permission: 'canViewDashboard',
  message: 'ケースリスク参照の権限がありません',
});
