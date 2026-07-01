import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createIncidentReport, listIncidentReports } from '@/server/services/incident-reports';
import {
  createIncidentReportSchema,
  incidentStatusSchema,
} from '@/lib/validations/incident-report';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE = '/api/incident-reports';

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canViewDashboard',
    message: 'ヒヤリハット記録の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const status = statusParam ? incidentStatusSchema.safeParse(statusParam) : null;
    if (status && !status.success) {
      return validationError('ヒヤリハットステータスが不正です', {
        status: ['対応していないステータスです'],
      });
    }

    const reports = await listIncidentReports(ctx, status?.data);

    return withSensitiveNoStore(success({ data: reports }));
  });
}

export async function GET(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'incident_reports_get_unhandled_error',
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

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canViewDashboard',
    message: 'ヒヤリハット記録の作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = createIncidentReportSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const report = await createIncidentReport(ctx, parsed.data);

    return withSensitiveNoStore(success({ data: report }, 201));
  });
}

export async function POST(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'incident_reports_post_unhandled_error',
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
