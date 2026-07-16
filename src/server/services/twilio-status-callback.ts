import twilio from 'twilio';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TWILIO_STATUS_CALLBACK_PATH = '/api/webhooks/twilio/message-status';

export type TwilioFormParams = Record<string, string | string[]>;

export function isValidTwilioStatusCallbackUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.pathname === TWILIO_STATUS_CALLBACK_PATH &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function buildTwilioStatusCallbackUrl(
  configuredUrl: string | undefined,
  context: { orgId: string; deliveryId: string } | undefined,
) {
  if (!configuredUrl || !context) return null;
  if (
    !isValidTwilioStatusCallbackUrl(configuredUrl) ||
    !context.orgId.trim() ||
    !UUID_RE.test(context.deliveryId)
  ) {
    throw new Error('invalid_twilio_status_callback_context');
  }
  const url = new URL(configuredUrl);
  url.searchParams.set('org_id', context.orgId);
  url.searchParams.set('delivery_id', context.deliveryId);
  return url.toString();
}

export function verifyTwilioStatusCallback(input: {
  signature: string | null;
  accountSid: string;
  orgId: string;
  deliveryId: string;
  params: TwilioFormParams;
}) {
  const configuredAccountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const configuredUrl = process.env.TWILIO_STATUS_CALLBACK_URL?.trim();
  if (!configuredAccountSid || !authToken || !configuredUrl) {
    return { ok: false as const, reason: 'configuration_unavailable' as const };
  }
  if (!isValidTwilioStatusCallbackUrl(configuredUrl)) {
    return { ok: false as const, reason: 'configuration_invalid' as const };
  }
  if (input.accountSid !== configuredAccountSid || !input.signature) {
    return { ok: false as const, reason: 'signature_invalid' as const };
  }

  let callbackUrl: string;
  try {
    callbackUrl = buildTwilioStatusCallbackUrl(configuredUrl, {
      orgId: input.orgId,
      deliveryId: input.deliveryId,
    })!;
  } catch {
    return { ok: false as const, reason: 'signature_invalid' as const };
  }
  return twilio.validateRequest(authToken, input.signature, callbackUrl, input.params)
    ? { ok: true as const }
    : { ok: false as const, reason: 'signature_invalid' as const };
}
