import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { forbidden, internalError, notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { hasPermission } from '@/lib/auth/permissions';
import { updateIncidentReport } from '@/server/services/incident-reports';
import { updateIncidentReportSchema } from '@/lib/validations/incident-report';

const authenticatedPATCH = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('ヒヤリハット記録IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateIncidentReportSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    // ステータス変更(確認済み/クローズ)は管理者のみ
    if (parsed.data.status !== undefined && !hasPermission(ctx.role, 'canAdmin')) {
      return forbidden('ステータスの変更には管理者権限が必要です');
    }

    const report = await updateIncidentReport(ctx, id, parsed.data);
    if (!report) return notFound('ヒヤリハット記録が見つかりません');

    return success({ data: report });
  },
  {
    permission: 'canViewDashboard',
    message: 'ヒヤリハット記録の更新権限がありません',
  },
);

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
