import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { parseOptionalIdempotencyKey } from '@/lib/api/idempotency-key';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { dateKeySchema } from '@/lib/validations/date-key';
import {
  PharmacyInvoiceTransitionError,
  transitionPharmacyInvoice,
  type PharmacyInvoiceTransitionInput,
} from '@/server/services/pharmacy-invoices';

const dateOnlySchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');
const versionSchema = z.number().int().positive();
const SERIALIZABLE_RETRY_LIMIT = 3;

const invoiceTransitionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('issue'),
    version: versionSchema,
    occurred_at: dateOnlySchema.optional(),
  }),
  z.object({
    action: z.literal('mark_sent'),
    version: versionSchema,
    occurred_at: dateOnlySchema.optional(),
  }),
  z.object({
    action: z.literal('mark_received'),
    version: versionSchema,
    occurred_at: dateOnlySchema.optional(),
  }),
  z.object({
    action: z.literal('schedule_payment'),
    version: versionSchema,
    payment_scheduled_for: dateOnlySchema,
  }),
  z.object({
    action: z.literal('record_payment'),
    version: versionSchema,
    occurred_at: dateOnlySchema.optional(),
  }),
  z.object({
    action: z.literal('cancel'),
    version: versionSchema,
    reason: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal('reissue'),
    version: versionSchema,
    reason: z.string().trim().max(1000).optional(),
  }),
]);

function dateFromOptionalKey(value: string | undefined) {
  return value ? utcDateFromLocalKey(value) : new Date();
}

function dateFromRequiredKey(value: string) {
  return utcDateFromLocalKey(value) ?? new Date();
}

function toTransitionInput(
  parsed: z.infer<typeof invoiceTransitionSchema>,
  idempotencyKeyHash: string,
  requestFingerprintHash: string,
): PharmacyInvoiceTransitionInput {
  const request = {
    expectedVersion: parsed.version,
    idempotencyKeyHash,
    requestFingerprintHash,
  };
  switch (parsed.action) {
    case 'issue':
    case 'mark_sent':
    case 'mark_received':
    case 'record_payment':
      return {
        ...request,
        action: parsed.action,
        occurredAt: dateFromOptionalKey(parsed.occurred_at),
      };
    case 'schedule_payment':
      return {
        ...request,
        action: parsed.action,
        paymentScheduledFor: dateFromRequiredKey(parsed.payment_scheduled_for),
      };
    case 'cancel':
    case 'reissue':
      return { ...request, action: parsed.action, reason: parsed.reason };
  }
}

function hashValue(scope: string, value: string) {
  return `sha256:${createHash('sha256').update(`${scope}\0${value}`).digest('hex')}`;
}

function isRetryableTransactionConflict(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code?: unknown }).code === 'P2002' ||
      (error as { code?: unknown }).code === 'P2034')
  );
}

async function runTransitionWithRetry(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionConflict(error)) throw error;
      if (attempt === SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new PharmacyInvoiceTransitionError(
          'STALE',
          '請求書が同時に更新されたため再読み込みしてください',
        );
      }
    }
  }
  throw new PharmacyInvoiceTransitionError(
    'STALE',
    '請求書が同時に更新されたため再読み込みしてください',
  );
}

function transitionErrorResponse(error: PharmacyInvoiceTransitionError) {
  if (error.code === 'NOT_FOUND') return notFound(error.message);
  return conflict(error.message, error.details);
}

export const PATCH = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return withSensitiveNoStore(validationError('薬局間請求書IDが不正です'));

    const idempotencyKey = parseOptionalIdempotencyKey(req.headers.get('Idempotency-Key'));
    if (!idempotencyKey.ok) {
      return withSensitiveNoStore(validationError(idempotencyKey.message));
    }
    if (!idempotencyKey.key) {
      return withSensitiveNoStore(validationError('Idempotency-Keyは必須です'));
    }

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = invoiceTransitionSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const idempotencyKeyHash = hashValue(
      'pharmacy-invoice-transition-idempotency',
      idempotencyKey.key,
    );
    const requestFingerprintHash = hashValue(
      'pharmacy-invoice-transition-request',
      JSON.stringify({ invoice_id: id, ...parsed.data }),
    );
    const transitionInput = toTransitionInput(
      parsed.data,
      idempotencyKeyHash,
      requestFingerprintHash,
    );

    try {
      const result = await runTransitionWithRetry(ctx.orgId, (tx) =>
        transitionPharmacyInvoice(tx, ctx, id, transitionInput),
      );

      return withSensitiveNoStore(success({ data: result }));
    } catch (error) {
      if (error instanceof PharmacyInvoiceTransitionError) {
        return withSensitiveNoStore(transitionErrorResponse(error));
      }
      throw error;
    }
  },
  {
    permission: 'canManageBilling',
    message: '薬局間請求書の更新権限がありません',
  },
);
