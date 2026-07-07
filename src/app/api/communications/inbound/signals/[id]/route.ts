import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { buildInboundCommunicationEventAssignmentWhere } from '@/server/services/communication-request-access';
import { logger } from '@/lib/utils/logger';

const ROUTE = '/api/communications/inbound/signals/[id]';

const reviewSignalSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('accept'),
  }),
  z.object({
    action: z.literal('record_only'),
    reason: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal('reject'),
    reason: z.string().trim().min(1, '却下理由は必須です').max(300),
  }),
]);

type ReviewSignalRouteContext = {
  params: Promise<{ id?: string }>;
};

type TaskUpdateManyResult = {
  count?: number;
};

function buildReviewUpdate(input: z.infer<typeof reviewSignalSchema>, userId: string) {
  const reviewedAt = new Date();
  if (input.action === 'accept') {
    return {
      review_status: 'accepted' as const,
      reviewed_by: userId,
      reviewed_at: reviewedAt,
      rejection_reason: null,
    };
  }

  if (input.action === 'record_only') {
    return {
      review_status: 'record_only' as const,
      action_status: 'ignored' as const,
      reviewed_by: userId,
      reviewed_at: reviewedAt,
      rejection_reason: input.reason ?? null,
    };
  }

  return {
    review_status: 'rejected' as const,
    action_status: 'ignored' as const,
    reviewed_by: userId,
    reviewed_at: reviewedAt,
    rejection_reason: input.reason,
  };
}

function normalizeUpdatedCount(result: unknown) {
  return typeof result === 'object' &&
    result !== null &&
    'count' in result &&
    typeof (result as TaskUpdateManyResult).count === 'number'
    ? (result as Required<TaskUpdateManyResult>).count
    : 0;
}

const authenticatedPATCH = withAuthContext(
  async (req, ctx, routeContext: ReviewSignalRouteContext) => {
    const signalId = normalizeRequiredRouteParam((await routeContext.params).id ?? '');
    if (!signalId) return withSensitiveNoStore(validationError('シグナルIDが不正です'));

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return withSensitiveNoStore(validationError('リクエストボディが不正です'));
    }

    const parsed = reviewSignalSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const assignmentWhere = await buildInboundCommunicationEventAssignmentWhere({
          db: tx,
          orgId: ctx.orgId,
          accessContext: ctx,
        });

        const signal = await tx.inboundCommunicationSignal.findFirst({
          where: {
            AND: [
              {
                id: signalId,
                org_id: ctx.orgId,
                inbound_event: {
                  is: {
                    org_id: ctx.orgId,
                  },
                },
              },
              ...(assignmentWhere
                ? [
                    {
                      inbound_event: {
                        is: assignmentWhere,
                      },
                    },
                  ]
                : []),
            ],
          },
          select: {
            id: true,
          },
        });

        if (!signal) {
          return {
            ok: false as const,
            response: notFound('シグナルが見つかりません'),
          };
        }

        const updated = await tx.inboundCommunicationSignal.update({
          where: {
            id: signal.id,
          },
          data: buildReviewUpdate(parsed.data, ctx.userId),
          select: {
            id: true,
            inbound_event_id: true,
            review_status: true,
            action_status: true,
            reviewed_at: true,
          },
        });

        const reviewTaskClosure = await tx.task.updateMany({
          where: {
            org_id: ctx.orgId,
            dedupe_key: {
              startsWith: `inbound:${signal.id}:`,
            },
            status: {
              in: ['pending', 'in_progress'],
            },
          },
          data: {
            status: 'completed',
            completed_at: new Date(),
          },
        });

        return {
          ok: true as const,
          signal: updated,
          reviewTaskClosureCount: normalizeUpdatedCount(reviewTaskClosure),
        };
      },
      { requestContext: ctx },
    );

    if (!result.ok) return withSensitiveNoStore(result.response);

    return withSensitiveNoStore(
      success({
        data: {
          signal_id: result.signal.id,
          inbound_event_id: result.signal.inbound_event_id,
          review_status: result.signal.review_status,
          action_status: result.signal.action_status,
          reviewed_at: result.signal.reviewed_at?.toISOString() ?? null,
          review_task_closure_count: result.reviewTaskClosureCount,
        },
        meta: {
          generated_at: new Date().toISOString(),
        },
      }),
    );
  },
  {
    permission: 'canReport',
    message: '他職種受信シグナルのレビュー権限がありません',
  },
);

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) => {
  try {
    return await authenticatedPATCH(req, routeContext);
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'inbound_signal_review_patch_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
};
