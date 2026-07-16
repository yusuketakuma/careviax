import { unstable_rethrow } from 'next/navigation';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { getPatientWorkflowPreviewData } from '@/server/services/patient-detail';

const authenticatedGET = withAuthContext(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('患者IDが不正です');

    const preview = await withOrgContext(
      ctx.orgId,
      (tx) =>
        getPatientWorkflowPreviewData(tx, {
          orgId: ctx.orgId,
          patientId: id,
          role: ctx.role,
          userId: ctx.userId,
        }),
      { requestContext: ctx },
    );
    if (!preview) return notFound('患者が見つかりません');

    recordPhiReadAuditForRequest(ctx, {
      patientId: id,
      view: 'patient_workflow_preview',
      purpose: 'care',
    });

    return success({ data: preview });
  },
  {
    permission: 'canViewDashboard',
    message: '患者情報の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
