import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import {
  internalError,
  notFound,
  successWithMeasuredJsonPayload,
  validationError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { getPatientOverview } from '@/server/services/patient-detail';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { withRoutePerformance } from '@/lib/utils/performance';

const authenticatedGET = withAuthContext(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('患者IDが不正です');

    const overview = await withOrgContext(
      ctx.orgId,
      (tx) =>
        getPatientOverview(tx, {
          orgId: ctx.orgId,
          patientId: id,
          role: ctx.role,
          userId: ctx.userId,
        }),
      { requestContext: ctx },
    );
    if (!overview) return notFound('患者が見つかりません');

    // PHI 閲覧監査（3省2GL アクセス記録）。ベストエフォート、await しない。
    recordPhiReadAuditForRequest(ctx, { patientId: id, view: 'patient_overview' });

    return successWithMeasuredJsonPayload({ data: overview });
  },
  {
    permission: 'canViewDashboard',
    message: '患者情報の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req, routeContext));
    } catch (err) {
      unstable_rethrow(err);
      return withSensitiveNoStore(internalError());
    }
  });
};
