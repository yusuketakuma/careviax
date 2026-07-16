import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import { createFetchTimeout } from '@/server/services/fetch-timeout';
import {
  buildTwilioStatusCallbackUrl,
  isValidTwilioStatusCallbackUrl,
} from '@/server/services/twilio-status-callback';
import type { ProviderDeliveryResult } from '../delivery-result';

type SmsAdapterConfig =
  | {
      provider: 'not_configured';
    }
  | {
      provider: 'misconfigured';
    }
  | {
      provider: 'twilio';
      accountSid: string;
      authToken: string;
      fromNumber: string;
      statusCallbackUrl?: string;
    };

type SmsDeliveryOptions = {
  callbackContext?: { orgId: string; deliveryId: string };
};

const DEFAULT_SMS_DELIVERY_TIMEOUT_MS = 10_000;
const TWILIO_MESSAGE_SID_RE = /^(?:SM|MM)[0-9a-fA-F]{32}$/;
const TWILIO_ACCEPTED_STATUSES = new Set([
  'accepted',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'delivered',
]);
const TWILIO_FAILED_STATUSES = new Set(['canceled', 'failed', 'undelivered']);

export type SmsProviderReadiness = {
  status: 'ready' | 'not_configured' | 'misconfigured';
};

export class SmsNotificationAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmsNotificationAdapterError';
  }
}

function resolveSmsDeliveryTimeoutMs() {
  return normalizePositiveTimeoutMs(process.env.SMS_DELIVERY_TIMEOUT_MS, {
    fallbackMs: DEFAULT_SMS_DELIVERY_TIMEOUT_MS,
  });
}

function resolveSmsConfig(): SmsAdapterConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
  const statusCallbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL?.trim();
  const configuredCount = [accountSid, authToken, fromNumber].filter(Boolean).length;

  if (accountSid && authToken && fromNumber) {
    if (statusCallbackUrl && !isValidTwilioStatusCallbackUrl(statusCallbackUrl)) {
      return { provider: 'misconfigured' };
    }
    return {
      provider: 'twilio',
      accountSid,
      authToken,
      fromNumber,
      ...(statusCallbackUrl ? { statusCallbackUrl } : {}),
    };
  }
  return { provider: configuredCount === 0 ? 'not_configured' : 'misconfigured' };
}

export function getSmsProviderReadiness(): SmsProviderReadiness {
  const config = resolveSmsConfig();
  if (config.provider === 'twilio') return { status: 'ready' };
  return { status: config.provider };
}

async function readTwilioAcceptance(response: Response) {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return { status: 'unknown' as const };
    const sid = Reflect.get(body, 'sid');
    const providerStatus = Reflect.get(body, 'status');
    if (typeof providerStatus === 'string' && TWILIO_FAILED_STATUSES.has(providerStatus)) {
      return { status: 'failed' as const };
    }
    if (
      typeof sid === 'string' &&
      TWILIO_MESSAGE_SID_RE.test(sid) &&
      typeof providerStatus === 'string' &&
      TWILIO_ACCEPTED_STATUSES.has(providerStatus)
    ) {
      return { status: 'accepted' as const, providerMessageId: sid };
    }
    return { status: 'unknown' as const };
  } catch {
    return { status: 'unknown' as const };
  }
}

export class SmsNotificationAdapter {
  constructor(private readonly config: SmsAdapterConfig = resolveSmsConfig()) {}

  async sendSms(
    phoneNumber: string,
    message: string,
    options: SmsDeliveryOptions = {},
  ): Promise<ProviderDeliveryResult> {
    if (phoneNumber.trim().length === 0) {
      throw new SmsNotificationAdapterError('SMS delivery target is required');
    }
    if (message.trim().length === 0) {
      throw new SmsNotificationAdapterError('SMS delivery message is required');
    }

    if (this.config.provider === 'not_configured') {
      return { status: 'not_configured', provider: null, providerMessageId: null };
    }
    if (this.config.provider === 'misconfigured') {
      return { status: 'failed', provider: 'twilio', providerMessageId: null };
    }

    if (this.config.provider === 'twilio') {
      const statusCallbackUrl = buildTwilioStatusCallbackUrl(
        this.config.statusCallbackUrl,
        options.callbackContext,
      );
      const abort = createFetchTimeout(resolveSmsDeliveryTimeoutMs());
      let response: Response;
      try {
        response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(
                `${this.config.accountSid}:${this.config.authToken}`,
              ).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              To: phoneNumber,
              From: this.config.fromNumber,
              Body: message,
              ...(statusCallbackUrl ? { StatusCallback: statusCallbackUrl } : {}),
            }).toString(),
            signal: abort.signal,
          },
        );
      } catch {
        return { status: 'unknown', provider: 'twilio', providerMessageId: null };
      } finally {
        abort.clear();
      }

      if (!response.ok) {
        return { status: 'failed', provider: 'twilio', providerMessageId: null };
      }
      const acceptance = await readTwilioAcceptance(response);
      if (acceptance.status === 'accepted') {
        return {
          status: 'accepted',
          provider: 'twilio',
          providerMessageId: acceptance.providerMessageId,
        };
      }
      return { status: acceptance.status, provider: 'twilio', providerMessageId: null };
    }

    throw new SmsNotificationAdapterError('Unsupported SMS provider configuration');
  }
}
