import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { dashboardCockpitSegmentResponse } from '@/server/services/dashboard-cockpit';

const ROUTE = '/api/dashboard/cockpit/details';

export async function GET(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await dashboardCockpitSegmentResponse(req, 'details'));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'dashboard_cockpit_details_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
