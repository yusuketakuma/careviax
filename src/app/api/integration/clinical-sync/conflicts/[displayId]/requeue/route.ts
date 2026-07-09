import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { withAuthContext } from '@/lib/auth/context';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { parseDisplayId } from '@/lib/db/display-id';
import { withOrgContext } from '@/lib/db/rls';
import { requeueClinicalSyncFhirValidationConflict } from '@/server/services/standard-clinical-sync-conflict-review';

export const dynamic = 'force-dynamic';

function parseQueueDisplayId(value: string) {
  const displayId = normalizeRequiredRouteParam(value);
  if (!displayId) return null;

  const parsed = parseDisplayId(displayId);
  return parsed?.model === 'ClinicalSyncQueueItem' ? displayId : null;
}

const authenticatedPOST = withAuthContext(
  async (_req: NextRequest, ctx, { params }) => {
    const { displayId: rawDisplayId } = await params;
    const queueDisplayId = parseQueueDisplayId(rawDisplayId);
    if (!queueDisplayId) {
      return validationError('clinical sync conflict IDが不正です');
    }

    const result = await withOrgContext(
      ctx.orgId,
      (tx) =>
        requeueClinicalSyncFhirValidationConflict(tx, {
          orgId: ctx.orgId,
          queueDisplayId,
          reviewedByUserId: ctx.userId,
        }),
      {
        requestContext: ctx,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeoutMs: 5000,
      },
    );

    switch (result.kind) {
      case 'requeued':
        return success({
          data: {
            queue_display_id: result.queue_display_id,
            queue_status: result.queue_status,
            validation_status: result.validation_status,
            requeued_queue_item_count: result.requeued_queue_item_count,
            provenance_recorded: result.provenance_recorded,
          },
        });
      case 'not_found':
        return notFound('clinical sync conflictが見つかりません');
      case 'cache_missing':
        return conflict('FHIR cacheが見つかりません', {
          reason: 'FHIR_CACHE_MISSING',
          queue_display_id: result.queue_display_id,
        });
      case 'validation_not_ready':
        return conflict('FHIR validationが完了していません', {
          reason: 'FHIR_VALIDATION_NOT_READY',
          queue_display_id: result.queue_display_id,
          validation_status: result.validation_status,
        });
      case 'stale_conflict':
        return conflict('clinical sync conflictが更新されています', {
          reason: 'STALE_CONFLICT',
          queue_display_id: result.queue_display_id,
        });
    }
  },
  {
    permission: 'canAdmin',
    message: 'clinical sync conflictの更新権限がありません',
  },
);

export async function POST(
  req: NextRequest,
  routeContext: { params: Promise<{ displayId: string }> },
) {
  return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
}
