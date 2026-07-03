import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createScopedTxRunner } from '@/lib/db/rls';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { getPatientTimelineData } from '@/server/services/patient-detail';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';

const authenticatedGET = withAuthContext(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('患者IDが不正です');

    // Inject the single RLS-scoped executor seam; the global prisma client is no
    // longer reachable here, so each timeline read flows through a scoped short tx.
    const runScoped = createScopedTxRunner(ctx.orgId);
    const timeline = await getPatientTimelineData(runScoped, {
      orgId: ctx.orgId,
      patientId: id,
      role: ctx.role,
      userId: ctx.userId,
    });
    if (!timeline) return notFound('患者が見つかりません');

    // PHI 閲覧監査（3省2GL アクセス記録）。ベストエフォート、await しない。
    recordPhiReadAuditForRequest(ctx, { patientId: id, view: 'patient_timeline' });

    return success(timeline);
  },
  {
    permission: 'canVisit',
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
