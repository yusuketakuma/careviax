import { unstable_rethrow } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { registeredError, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readBoundedBody } from '@/lib/http/bounded-body';
import { logger } from '@/lib/utils/logger';
import {
  recordTwilioDeliveryReceipt,
  TWILIO_DELIVERY_STATUSES,
} from '@/server/services/twilio-delivery-receipts';
import {
  type TwilioFormParams,
  verifyTwilioStatusCallback,
} from '@/server/services/twilio-status-callback';

export const runtime = 'nodejs';

const ROUTE = '/api/webhooks/twilio/message-status';
const MAX_CALLBACK_BODY_BYTES = 64 * 1024;
const CALLBACK_BODY_DEADLINE_MS = 5_000;

const querySchema = z.object({
  org_id: z.string().trim().min(1).max(200),
  delivery_id: z.string().uuid(),
});

const callbackSchema = z
  .object({
    AccountSid: z.string().trim().min(1).max(100),
    MessageSid: z.string().regex(/^(?:SM|MM)[0-9a-fA-F]{32}$/),
    MessageStatus: z.enum(TWILIO_DELIVERY_STATUSES),
    ErrorCode: z
      .string()
      .regex(/^[0-9]{1,10}$/)
      .optional(),
  })
  .passthrough();

function noStore(response: NextResponse) {
  return withSensitiveNoStore(response);
}

function readFormParams(body: string): TwilioFormParams {
  const result: TwilioFormParams = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const existing = result[key];
    if (existing === undefined) result[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else result[key] = [existing, value];
  }
  return result;
}

function readSingleParam(params: TwilioFormParams, key: string) {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

export async function POST(req: NextRequest) {
  try {
    if (
      !req.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/x-www-form-urlencoded')
    ) {
      return noStore(validationError('Twilio callback must be form encoded'));
    }
    const query = querySchema.safeParse({
      org_id: req.nextUrl.searchParams.get('org_id'),
      delivery_id: req.nextUrl.searchParams.get('delivery_id'),
    });
    if (!query.success) return noStore(validationError('Twilio callback reference is invalid'));

    const body = await readBoundedBody(req, {
      maxBytes: MAX_CALLBACK_BODY_BYTES,
      deadlineMs: CALLBACK_BODY_DEADLINE_MS,
    });
    if (!body.ok) {
      if (body.reason === 'too_large') {
        return noStore(registeredError('REQUEST_BODY_TOO_LARGE', 'Callback payload is too large'));
      }
      if (body.reason === 'timeout') {
        return noStore(
          registeredError('REQUEST_BODY_TIMEOUT', 'Callback payload read timed out', {
            timeout_ms: CALLBACK_BODY_DEADLINE_MS,
          }),
        );
      }
      return noStore(validationError('Callback payload could not be read'));
    }

    const params = readFormParams(new TextDecoder().decode(body.bytes));
    const parsed = callbackSchema.safeParse({
      AccountSid: readSingleParam(params, 'AccountSid'),
      MessageSid: readSingleParam(params, 'MessageSid'),
      MessageStatus: readSingleParam(params, 'MessageStatus'),
      ErrorCode: readSingleParam(params, 'ErrorCode'),
    });
    if (!parsed.success) return noStore(validationError('Twilio callback payload is invalid'));

    const signature = verifyTwilioStatusCallback({
      signature: req.headers.get('x-twilio-signature'),
      accountSid: parsed.data.AccountSid,
      orgId: query.data.org_id,
      deliveryId: query.data.delivery_id,
      params,
    });
    if (!signature.ok) {
      if (
        signature.reason === 'configuration_unavailable' ||
        signature.reason === 'configuration_invalid'
      ) {
        return noStore(
          registeredError(
            'TWILIO_DELIVERY_CALLBACK_CONFIGURATION_UNAVAILABLE',
            'Twilio callback verification is unavailable',
          ),
        );
      }
      return noStore(
        registeredError(
          'TWILIO_DELIVERY_CALLBACK_SIGNATURE_INVALID',
          'Twilio callback signature is invalid',
        ),
      );
    }

    await recordTwilioDeliveryReceipt({
      orgId: query.data.org_id,
      deliveryId: query.data.delivery_id,
      messageSid: parsed.data.MessageSid,
      status: parsed.data.MessageStatus,
      errorCode: parsed.data.ErrorCode,
    });
    return noStore(new NextResponse(null, { status: 200 }));
  } catch (error) {
    unstable_rethrow(error);
    logger.error({
      event: 'twilio.delivery_callback_failed',
      route: ROUTE,
      operation: 'record_twilio_delivery_receipt',
      code: 'TWILIO_DELIVERY_CALLBACK_PROCESSING_FAILED',
    });
    return noStore(
      registeredError(
        'TWILIO_DELIVERY_CALLBACK_PROCESSING_FAILED',
        'Twilio delivery callback processing failed',
      ),
    );
  }
}
