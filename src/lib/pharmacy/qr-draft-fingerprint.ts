import { createHmac } from 'crypto';

function normalizeQrText(value: string) {
  return value.trim().replace(/\r\n/g, '\n');
}

export function canonicalizeQrTextPages(qrTexts: readonly string[]) {
  return Array.from(new Set(qrTexts.map(normalizeQrText))).sort();
}

export function buildQrPayloadHash(qrTexts: readonly string[]) {
  const secret =
    process.env.QR_DRAFT_HASH_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    'ph-os-local-qr-draft-hash-secret';

  return createHmac('sha256', secret)
    .update(JSON.stringify(canonicalizeQrTextPages(qrTexts)))
    .digest('hex');
}
