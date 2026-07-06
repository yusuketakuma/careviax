import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { createScopedTxRunner } from '@/lib/db/rls';
import { getPatientMovementTimelineEventDetail } from '@/server/services/patient-detail';

const authenticatedGET = withAuthContext(
  async (_req, ctx, { params }) => {
    const { id: rawPatientId, eventId: rawEventId } = await params;
    const patientId = normalizeRequiredRouteParam(rawPatientId);
    const eventId = normalizeRequiredRouteParam(rawEventId);
    if (!patientId) return validationError('患者IDが不正です');
    if (!eventId) return validationError('イベントIDが不正です');

    const runScoped = createScopedTxRunner(ctx.orgId);
    const detail = await getPatientMovementTimelineEventDetail(runScoped, {
      orgId: ctx.orgId,
      patientId,
      eventId,
      role: ctx.role,
      userId: ctx.userId,
    });
    if (!detail) return notFound('患者の動きイベントが見つかりません');

    recordPhiReadAuditForRequest(ctx, { patientId, view: 'patient_timeline_event' });

    return success(detail);
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
