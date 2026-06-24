import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { createScopedTxRunner } from '@/lib/db/rls';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { getPatientTimelineData } from '@/server/services/patient-detail';

export const GET = withAuthContext(
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

    return success(timeline);
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  },
);
