import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
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

const invoiceTransitionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('issue'),
    occurred_at: dateOnlySchema.optional(),
  }),
  z.object({
    action: z.literal('mark_sent'),
    occurred_at: dateOnlySchema.optional(),
  }),
  z.object({
    action: z.literal('mark_received'),
    occurred_at: dateOnlySchema.optional(),
  }),
  z.object({
    action: z.literal('schedule_payment'),
    payment_scheduled_for: dateOnlySchema,
  }),
  z.object({
    action: z.literal('record_payment'),
    occurred_at: dateOnlySchema.optional(),
  }),
  z.object({
    action: z.literal('cancel'),
    reason: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal('reissue'),
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
): PharmacyInvoiceTransitionInput {
  switch (parsed.action) {
    case 'issue':
    case 'mark_sent':
    case 'mark_received':
    case 'record_payment':
      return { action: parsed.action, occurredAt: dateFromOptionalKey(parsed.occurred_at) };
    case 'schedule_payment':
      return {
        action: parsed.action,
        paymentScheduledFor: dateFromRequiredKey(parsed.payment_scheduled_for),
      };
    case 'cancel':
    case 'reissue':
      return { action: parsed.action, reason: parsed.reason };
  }
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

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = invoiceTransitionSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    try {
      const result = await withOrgContext(
        ctx.orgId,
        (tx) => transitionPharmacyInvoice(tx, ctx, id, toTransitionInput(parsed.data)),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return withSensitiveNoStore(success(result));
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
