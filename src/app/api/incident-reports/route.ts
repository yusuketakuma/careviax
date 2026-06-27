import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createIncidentReport, listIncidentReports } from '@/server/services/incident-reports';
import {
  createIncidentReportSchema,
  incidentStatusSchema,
} from '@/lib/validations/incident-report';

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const status = statusParam ? incidentStatusSchema.safeParse(statusParam) : null;
    if (status && !status.success) {
      return validationError('ヒヤリハットステータスが不正です', {
        status: ['対応していないステータスです'],
      });
    }

    const reports = await listIncidentReports(ctx, status?.data);

    return success({ data: reports });
  },
  {
    permission: 'canViewDashboard',
    message: 'ヒヤリハット記録の閲覧権限がありません',
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

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createIncidentReportSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const report = await createIncidentReport(ctx, parsed.data);

    return success({ data: report }, 201);
  },
  {
    permission: 'canViewDashboard',
    message: 'ヒヤリハット記録の作成権限がありません',
  },
);
