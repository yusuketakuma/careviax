import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { withAuthContext } from '@/lib/auth/context';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  conflict,
  forbidden,
  internalError,
  notFound,
  success,
  validationError,
} from '@/lib/api/response';
import { parseOptionalIdempotencyKey } from '@/lib/api/idempotency-key';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { isPrismaErrorCode } from '@/lib/db/prisma-errors';
import { buildInboundCommunicationEventAssignmentWhere } from '@/server/services/communication-request-access';
import { logger } from '@/lib/utils/logger';
import {
  applyInboundSignalToMedicationStock,
  type ApplyInboundMedicationStockSignalResult,
} from '@/modules/pharmacy';

const ROUTE = '/api/communications/inbound/signals/[id]';
const medicationStockUnitSchema = z.enum([
  'tablet',
  'capsule',
  'packet',
  'sheet',
  'patch',
  'tube',
  'bottle',
  'ml',
  'g',
  'dose',
  'application',
  'other',
]);

const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/, 'idempotency_key が不正です');

const eventAtSchema = z
  .string()
  .datetime({ offset: true, message: 'event_at はISO日時で指定してください' })
  .optional();
const positiveQuantitySchema = z
  .number()
  .finite()
  .positive('数量は0より大きい値で指定してください');
const usagePeriodDaysSchema = z
  .number()
  .int()
  .min(1, '使用期間日数は1日以上で指定してください')
  .max(366, '使用期間日数が大きすぎます');

const acceptSignalSchema = z.object({
  action: z.literal('accept'),
});
const recordOnlySignalSchema = z.object({
  action: z.literal('record_only'),
  reason: z.string().trim().max(300).optional(),
});
const rejectSignalSchema = z.object({
  action: z.literal('reject'),
  reason: z.string().trim().min(1, '却下理由は必須です').max(300),
});
const applyMedicationStockSignalSchema = z.object({
  action: z.literal('apply_to_medication_stock'),
  target_stock_item_id: z.string().trim().min(1, '残数管理対象薬剤IDは必須です'),
  idempotency_key: idempotencyKeySchema.optional(),
  observation: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('observed_absolute'),
      quantity: z.number().finite().min(0, '残数は0以上で指定してください'),
      unit: medicationStockUnitSchema,
      event_at: eventAtSchema,
    }),
    z.object({
      kind: z.literal('no_stock_observed'),
      unit: medicationStockUnitSchema,
      event_at: eventAtSchema,
    }),
    z.object({
      kind: z.literal('usage_delta'),
      used_quantity: positiveQuantitySchema,
      unit: medicationStockUnitSchema,
      event_at: eventAtSchema,
    }),
    z.object({
      kind: z.literal('usage_frequency'),
      usage_quantity: positiveQuantitySchema,
      usage_period_days: usagePeriodDaysSchema,
      unit: medicationStockUnitSchema,
      event_at: eventAtSchema,
    }),
    z.object({
      kind: z.literal('low_stock_text'),
      unit: medicationStockUnitSchema,
      event_at: eventAtSchema,
    }),
    z.object({
      kind: z.literal('refill_request'),
      unit: medicationStockUnitSchema,
      event_at: eventAtSchema,
    }),
  ]),
});

const reviewOnlySignalSchema = z.discriminatedUnion('action', [
  acceptSignalSchema,
  recordOnlySignalSchema,
  rejectSignalSchema,
]);
const reviewSignalSchema = z.discriminatedUnion('action', [
  acceptSignalSchema,
  recordOnlySignalSchema,
  rejectSignalSchema,
  applyMedicationStockSignalSchema,
]);

type ReviewOnlySignalInput = z.infer<typeof reviewOnlySignalSchema>;

type ReviewSignalRouteContext = {
  params: Promise<{ id?: string }>;
};

type TaskUpdateManyResult = {
  count?: number;
};

function buildReviewUpdate(input: ReviewOnlySignalInput, userId: string) {
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

function parseEventAt(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function mapApplyObservation(
  input: z.infer<typeof applyMedicationStockSignalSchema>['observation'],
) {
  const eventAt = parseEventAt(input.event_at);

  switch (input.kind) {
    case 'observed_absolute':
      return {
        kind: 'observed_absolute' as const,
        quantity: input.quantity,
        unit: input.unit,
        eventAt,
      };
    case 'no_stock_observed':
      return {
        kind: 'no_stock_observed' as const,
        unit: input.unit,
        eventAt,
      };
    case 'usage_delta':
      return {
        kind: 'usage_delta' as const,
        usedQuantity: input.used_quantity,
        unit: input.unit,
        eventAt,
      };
    case 'usage_frequency':
      return {
        kind: 'usage_frequency' as const,
        usageQuantity: input.usage_quantity,
        usagePeriodDays: input.usage_period_days,
        unit: input.unit,
        eventAt,
      };
    case 'low_stock_text':
      return {
        kind: 'low_stock_text' as const,
        unit: input.unit,
        eventAt,
      };
    case 'refill_request':
      return {
        kind: 'refill_request' as const,
        unit: input.unit,
        eventAt,
      };
  }
}

function resolveApplyIdempotencyKey(req: Request, payloadKey?: string) {
  const header = parseOptionalIdempotencyKey(req.headers.get('idempotency-key'));
  if (!header.ok) return header;
  const bodyKey = payloadKey?.trim() || null;
  if (header.key && bodyKey && header.key !== bodyKey) {
    return {
      ok: false as const,
      message: 'Idempotency-Key と idempotency_key が一致しません',
    };
  }
  const key = header.key ?? bodyKey;
  if (!key) {
    return {
      ok: false as const,
      message: 'Idempotency-Key は必須です',
    };
  }
  return { ok: true as const, key };
}

function applyResultToResponse(result: ApplyInboundMedicationStockSignalResult) {
  switch (result.kind) {
    case 'applied':
      return success({
        data: result.data,
        meta: {
          generated_at: new Date().toISOString(),
        },
      });
    case 'forbidden':
      return forbidden(result.message);
    case 'not_found':
      return notFound(result.message);
    case 'validation_error':
      return validationError(result.message);
    case 'invalid_state':
    case 'conflict':
      return conflict(result.message);
  }
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

    if (parsed.data.action === 'apply_to_medication_stock') {
      const applyPayload = parsed.data;
      const idempotencyKey = resolveApplyIdempotencyKey(req, applyPayload.idempotency_key);
      if (!idempotencyKey.ok) {
        return withSensitiveNoStore(validationError(idempotencyKey.message));
      }

      const result = await withOrgContext(
        ctx.orgId,
        (tx) =>
          applyInboundSignalToMedicationStock(tx, {
            orgId: ctx.orgId,
            userId: ctx.userId,
            role: ctx.role,
            signalId,
            targetStockItemId: applyPayload.target_stock_item_id,
            idempotencyKey: idempotencyKey.key,
            observation: mapApplyObservation(applyPayload.observation),
          }),
        {
          requestContext: ctx,
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeoutMs: 5000,
        },
      );

      return withSensitiveNoStore(applyResultToResponse(result));
    }

    const reviewPayload = reviewOnlySignalSchema.parse(parsed.data);
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
          data: buildReviewUpdate(reviewPayload, ctx.userId),
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
    if (isPrismaErrorCode(err, 'P2034')) {
      return withSensitiveNoStore(
        conflict('残数反映が同時に更新されました。再読み込みしてください'),
      );
    }
    if (isPrismaErrorCode(err, 'P2002')) {
      return withSensitiveNoStore(
        conflict('同じ残数反映が既に処理されています。再読み込みしてください'),
      );
    }
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
