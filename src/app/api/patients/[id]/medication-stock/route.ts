import { unstable_rethrow } from 'next/navigation';

import { withAuthContext } from '@/lib/auth/context';
import {
  internalError,
  notFound,
  successWithMeasuredJsonPayload,
  validationError,
} from '@/lib/api/response';
import { parseExactIntegerSearchParam } from '@/lib/api/search-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { createScopedTxRunner } from '@/lib/db/rls';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { getPatientMedicationStockSummary } from '@/modules/pharmacy/medication-stock/application/patient-medication-stock-summary';
import { logger } from '@/lib/utils/logger';

const ROUTE = '/api/patients/[id]/medication-stock';

const authenticatedGET = withAuthContext(
  async (req, ctx, { params }) => {
    try {
      const { id: rawId } = await params;
      const id = normalizeRequiredRouteParam(rawId);
      if (!id) return withSensitiveNoStore(validationError('患者IDが不正です'));

      const { searchParams } = req.nextUrl;
      const itemLimit = parseExactIntegerSearchParam(searchParams, 'item_limit', 1, 100, 50);
      if (!itemLimit.ok) return withSensitiveNoStore(validationError(itemLimit.message));

      const eventLimit = parseExactIntegerSearchParam(searchParams, 'event_limit', 0, 50, 12);
      if (!eventLimit.ok) return withSensitiveNoStore(validationError(eventLimit.message));

      const runScoped = createScopedTxRunner(ctx.orgId);
      const stockSummary = await runScoped((tx) =>
        getPatientMedicationStockSummary(tx, {
          orgId: ctx.orgId,
          patientId: id,
          role: ctx.role,
          userId: ctx.userId,
          itemLimit: itemLimit.value,
          eventLimit: eventLimit.value,
        }),
      );
      if (!stockSummary) return withSensitiveNoStore(notFound('患者が見つかりません'));

      recordPhiReadAuditForRequest(ctx, {
        patientId: id,
        view: 'patient_medication_stock',
        metadata: {
          visible_item_count: stockSummary.data.summary.visible_item_count,
          recent_event_count: stockSummary.data.recent_events.length,
        },
      });

      return withSensitiveNoStore(successWithMeasuredJsonPayload(stockSummary));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'patient_medication_stock_get_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  },
  {
    permission: 'canVisit',
    message: '患者の残数管理情報の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return await authenticatedGET(req, routeContext);
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
