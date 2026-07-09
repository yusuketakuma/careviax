import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { withAuthContext } from '@/lib/auth/context';
import { parseOptionalIdempotencyKey } from '@/lib/api/idempotency-key';
import {
  conflict,
  error,
  forbiddenResponse,
  internalError,
  notFound,
  success,
  validationError,
} from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import {
  applyVisitMedicationStockObservations,
  type VisitMedicationStockObservationInput,
} from '@/modules/pharmacy';

const ROUTE = '/api/visit-records/[id]/medication-stock-observations';

const dateStringSchema = z
  .string()
  .min(1)
  .refine((value) => Number.isFinite(new Date(value).getTime()), {
    message: '日時が不正です',
  });

const observationSchema = z
  .object({
    client_observation_id: z.string().trim().min(1).max(128),
    stock_item_id: z.string().trim().min(1),
    kind: z.enum([
      'observed_absolute',
      'usage_delta',
      'usage_frequency',
      'not_observed',
      'refill_request',
    ]),
    unit: z.string().trim().min(1).max(32),
    event_at: dateStringSchema.optional(),
    quantity: z.number().finite().optional(),
    used_quantity: z.number().finite().optional(),
    usage_quantity: z.number().finite().optional(),
    usage_period_days: z.number().int().optional(),
    last_used_at: dateStringSchema.optional(),
    last_used_precision: z.enum(['exact_datetime', 'date_only', 'unknown']).optional(),
    unobserved_reason_code: z
      .enum([
        'patient_refused',
        'caregiver_unavailable',
        'storage_inaccessible',
        'medication_not_present',
        'identity_uncertain',
        'visit_time_limited',
        'safety_priority',
        'other_institution_unconfirmed',
        'unknown',
      ])
      .optional(),
    source_confidence: z
      .enum([
        'structured_exact',
        'structured_partial',
        'text_parsed_high',
        'text_parsed_low',
        'manual',
        'unknown',
      ])
      .optional(),
    source_context_code: z
      .enum([
        'pharmacist_direct_observation',
        'patient_report',
        'caregiver_report',
        'facility_staff_report',
        'record_review',
        'unknown',
      ])
      .optional(),
    confirmation_level: z
      .enum([
        'counted_by_pharmacist',
        'photo_verified',
        'patient_reported',
        'caregiver_reported',
        'other_professional_reported',
        'other_institution_record',
        'unknown',
      ])
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'observed_absolute' && value.quantity == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantity'],
        message: '残数を指定してください',
      });
    }
    if (value.kind === 'usage_delta' && value.used_quantity == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['used_quantity'],
        message: '使用量を指定してください',
      });
    }
    if (value.kind === 'usage_frequency') {
      if (value.usage_quantity == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['usage_quantity'],
          message: '使用量を指定してください',
        });
      }
      if (value.usage_period_days == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['usage_period_days'],
          message: '使用期間日数を指定してください',
        });
      }
    }
    if (value.kind === 'not_observed' && !value.unobserved_reason_code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unobserved_reason_code'],
        message: '未確認理由を指定してください',
      });
    }
  });

const requestSchema = z.object({
  observed_at: dateStringSchema.optional(),
  observations: z.array(observationSchema).min(1).max(50),
});

function isMedicationStockObservationCapabilityUnavailable(
  err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021';
}

function mapObservationWriteException(req: NextRequest, err: unknown) {
  unstable_rethrow(err);
  if (isMedicationStockObservationCapabilityUnavailable(err)) {
    logger.warn(
      {
        event: 'visit_medication_stock_observation_capability_unavailable',
        route: ROUTE,
        method: req.method,
        status: 503,
        code: err.code,
      },
      err,
    );
    return error(
      'MEDICATION_STOCK_OBSERVATION_UNAVAILABLE',
      '残数観測の登録機能はDB連携確認中です。従来の残薬記録を使用してください。',
      503,
    );
  }
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === 'P2002' || err.code === 'P2034')
  ) {
    return conflict('残数観測が他の操作と競合しました。最新データを取得してから再試行してください');
  }
  logger.error(
    {
      event: 'visit_medication_stock_observation_post_unhandled_error',
      route: ROUTE,
      method: req.method,
      status: 500,
    },
    err,
  );
  return internalError();
}

function toObservationInput(
  observation: z.infer<typeof observationSchema>,
): VisitMedicationStockObservationInput {
  return {
    clientObservationId: observation.client_observation_id,
    stockItemId: observation.stock_item_id,
    kind: observation.kind,
    unit: observation.unit,
    ...(observation.event_at ? { eventAt: new Date(observation.event_at) } : {}),
    ...(observation.quantity !== undefined ? { quantity: observation.quantity } : {}),
    ...(observation.used_quantity !== undefined ? { usedQuantity: observation.used_quantity } : {}),
    ...(observation.usage_quantity !== undefined
      ? { usageQuantity: observation.usage_quantity }
      : {}),
    ...(observation.usage_period_days !== undefined
      ? { usagePeriodDays: observation.usage_period_days }
      : {}),
    ...(observation.last_used_at ? { lastUsedAt: new Date(observation.last_used_at) } : {}),
    ...(observation.last_used_precision
      ? { lastUsedPrecision: observation.last_used_precision }
      : {}),
    ...(observation.unobserved_reason_code
      ? { unobservedReasonCode: observation.unobserved_reason_code }
      : {}),
    ...(observation.source_confidence ? { sourceConfidence: observation.source_confidence } : {}),
    ...(observation.source_context_code
      ? { sourceContextCode: observation.source_context_code }
      : {}),
    ...(observation.confirmation_level
      ? { confirmationLevel: observation.confirmation_level }
      : {}),
  };
}

const authenticatedPOST = withAuthContext(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const visitRecordId = normalizeRequiredRouteParam(rawId);
    if (!visitRecordId) return validationError('訪問記録IDが不正です');

    const parsedIdempotencyKey = parseOptionalIdempotencyKey(req.headers.get('Idempotency-Key'));
    if (!parsedIdempotencyKey.ok) return validationError(parsedIdempotencyKey.message);
    if (!parsedIdempotencyKey.key) return validationError('Idempotency-Keyヘッダーが必要です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const result = await withOrgContext(
      ctx.orgId,
      (tx) =>
        applyVisitMedicationStockObservations(tx, {
          orgId: ctx.orgId,
          userId: ctx.userId,
          role: ctx.role,
          visitRecordId,
          idempotencyKey: parsedIdempotencyKey.key,
          ...(parsed.data.observed_at ? { observedAt: new Date(parsed.data.observed_at) } : {}),
          observations: parsed.data.observations.map(toObservationInput),
        }),
      {
        requestContext: ctx,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeoutMs: 5000,
      },
    ).catch((err: unknown) => mapObservationWriteException(req, err));

    if (result instanceof Response) return result;

    switch (result.kind) {
      case 'applied':
        return success(
          {
            data: result.data,
            meta: result.meta,
          },
          result.meta.applied_count > 0 ? 201 : 200,
        );
      case 'not_found':
        return notFound(result.message);
      case 'forbidden':
        return forbiddenResponse(result.message);
      case 'conflict':
        return conflict(result.message);
      case 'validation_error':
        return validationError(result.message);
    }
  },
  {
    permission: 'canVisit',
    message: '訪問記録の残数観測を登録する権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
