import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

export type YreseWebhookSignatureVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'secret_unconfigured' | 'signature_missing' | 'signature_malformed' | 'mismatch';
    };

export function buildYreseWebhookSignatureHeader(secret: string, body: string): string {
  return `${SIGNATURE_PREFIX}${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function readConfiguredSecret(secret = process.env.YRESE_WEBHOOK_SECRET): string | null {
  return typeof secret === 'string' && secret.trim().length > 0 ? secret.trim() : null;
}

function safeEqualSignature(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function verifyYreseWebhookSignature(args: {
  readonly body: string;
  readonly signatureHeader: string | null;
  readonly secret?: string;
}): YreseWebhookSignatureVerificationResult {
  const secret = readConfiguredSecret(args.secret);
  if (!secret) return { ok: false, reason: 'secret_unconfigured' };

  const signature = args.signatureHeader?.trim();
  if (!signature) return { ok: false, reason: 'signature_missing' };
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    return { ok: false, reason: 'signature_malformed' };
  }

  const expected = buildYreseWebhookSignatureHeader(secret, args.body);
  return safeEqualSignature(expected, signature) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
