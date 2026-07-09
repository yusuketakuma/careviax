import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { parseDisplayId } from '@/lib/db/display-id';
import { withOrgContext } from '@/lib/db/rls';
import { getClinicalSyncFhirValidationDetail } from '@/server/services/standard-clinical-sync-conflict-review';

export const dynamic = 'force-dynamic';

function parseQueueDisplayId(value: string) {
  const displayId = normalizeRequiredRouteParam(value);
  if (!displayId) return null;

  const parsed = parseDisplayId(displayId);
  return parsed?.model === 'ClinicalSyncQueueItem' ? displayId : null;
}

const authenticatedGET = withAuthContext(
  async (_req: NextRequest, ctx, { params }) => {
    const { displayId: rawDisplayId } = await params;
    const queueDisplayId = parseQueueDisplayId(rawDisplayId);
    if (!queueDisplayId) {
      return validationError('clinical sync conflict IDが不正です');
    }

    const detail = await withOrgContext(ctx.orgId, (tx) =>
      getClinicalSyncFhirValidationDetail(tx, {
        orgId: ctx.orgId,
        queueDisplayId,
      }),
    );
    if (!detail) {
      return notFound('clinical sync conflictが見つかりません');
    }

    return success({
      data: detail,
      meta: {
        generated_at: new Date().toISOString(),
      },
    });
  },
  {
    permission: 'canAdmin',
    message: 'clinical sync conflictの閲覧権限がありません',
  },
);

export async function GET(
  req: NextRequest,
  routeContext: { params: Promise<{ displayId: string }> },
) {
  return withSensitiveNoStore(await authenticatedGET(req, routeContext));
}
