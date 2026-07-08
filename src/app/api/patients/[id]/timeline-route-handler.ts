import { unstable_rethrow } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import {
  internalError,
  notFound,
  successWithMeasuredJsonPayload,
  validationError,
} from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { parseExactIntegerSearchParam } from '@/lib/api/search-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext } from '@/lib/auth/context';
import { createScopedTxRunner } from '@/lib/db/rls';
import { getPatientTimelineData } from '@/server/services/patient-detail';

type PatientTimelineRouteContext = {
  params: Promise<{ id: string }>;
};

type PatientTimelineRouteOptions = {
  auditView: 'patient_timeline' | 'patient_movement_timeline';
};

export function createPatientTimelineGET(options: PatientTimelineRouteOptions) {
  const authenticatedGET = withAuthContext(
    async (req, ctx, { params }: PatientTimelineRouteContext) => {
      const { id: rawId } = await params;
      const id = normalizeRequiredRouteParam(rawId);
      if (!id) return validationError('患者IDが不正です');
      const { searchParams } = new URL(req.url);
      const limit = parseExactIntegerSearchParam(searchParams, 'limit', 1, 40, 40);
      if (!limit.ok) return validationError(limit.message);

      // Inject the single RLS-scoped executor seam; the global prisma client is no
      // longer reachable here, so each timeline read flows through a scoped short tx.
      const runScoped = createScopedTxRunner(ctx.orgId);
      const timeline = await getPatientTimelineData(runScoped, {
        orgId: ctx.orgId,
        patientId: id,
        role: ctx.role,
        userId: ctx.userId,
        timelineLimit: limit.value,
      });
      if (!timeline) return notFound('患者が見つかりません');

      // PHI 閲覧監査（3省2GL アクセス記録）。ベストエフォート、await しない。
      recordPhiReadAuditForRequest(ctx, { patientId: id, view: options.auditView });

      return successWithMeasuredJsonPayload(timeline);
    },
    {
      permission: 'canVisit',
      message: '患者情報の閲覧権限がありません',
    },
  );

  return async function GET(req: NextRequest, routeContext: PatientTimelineRouteContext) {
    try {
      return withSensitiveNoStore(await authenticatedGET(req, routeContext));
    } catch (err) {
      unstable_rethrow(err);
      return withSensitiveNoStore(internalError());
    }
  };
}
