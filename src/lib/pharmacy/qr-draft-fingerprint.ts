import { createHash } from 'crypto';

function normalizeQrText(value: string) {
  return value.trim().replace(/\r\n/g, '\n');
}

export function canonicalizeQrTextPages(qrTexts: readonly string[]) {
  return Array.from(new Set(qrTexts.map(normalizeQrText))).sort();
}

export function buildQrPayloadHash(qrTexts: readonly string[]) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeQrTextPages(qrTexts)))
    .digest('hex');
}
