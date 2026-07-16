import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { syncCaseRiskCockpitOperationalTasks } from '@/server/services/case-risk-task-sync';

async function caseRiskCockpitTasksPOST(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('ケースIDが不正です');

  const result = await withOrgContext(
    ctx.orgId,
    (tx) =>
      syncCaseRiskCockpitOperationalTasks(tx, {
        orgId: ctx.orgId,
        caseId: id,
        userId: ctx.userId,
        role: ctx.role,
      }),
    { requestContext: ctx },
  );
  if (!result) return notFound('ケースが見つかりません');

  return success({ data: result });
}

export const POST = withAuthContext(caseRiskCockpitTasksPOST, {
  permission: 'canVisit',
  message: 'ケースリスクタスク同期の権限がありません',
});
