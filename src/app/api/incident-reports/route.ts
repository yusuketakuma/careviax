import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { createIncidentReport, listIncidentReports } from '@/server/services/incident-reports';
import {
  createIncidentReportSchema,
  incidentStatusSchema,
} from '@/lib/validations/incident-report';
async function authenticatedGET(req: NextRequest, ctx: AuthContext) {
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
}

export const GET = withAuthContext(authenticatedGET, {
  permission: 'canViewDashboard',
  message: 'ヒヤリハット記録の閲覧権限がありません',
});

async function authenticatedPOST(req: NextRequest, ctx: AuthContext) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createIncidentReportSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const report = await createIncidentReport(ctx, parsed.data);

  return success({ data: report }, 201);
}

export const POST = withAuthContext(authenticatedPOST, {
  permission: 'canViewDashboard',
  message: 'ヒヤリハット記録の作成権限がありません',
});
