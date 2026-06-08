import { afterEach, describe, expect, it } from 'vitest';
import { buildQrPayloadHash, canonicalizeQrTextPages } from './qr-draft-fingerprint';

describe('qr draft fingerprint', () => {
  const originalSecret = process.env.QR_DRAFT_HASH_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.QR_DRAFT_HASH_SECRET;
    } else {
      process.env.QR_DRAFT_HASH_SECRET = originalSecret;
    }
  });

  it('canonicalizes duplicate pages and page order before hashing', () => {
    const left = buildQrPayloadHash([' JAHISTC08,page-2\r\nA ', 'JAHISTC08,page-1']);
    const right = buildQrPayloadHash(['JAHISTC08,page-1', 'JAHISTC08,page-2\nA']);

    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the canonical page set for duplicate detection', () => {
    expect(canonicalizeQrTextPages([' B ', 'A', 'B'])).toEqual(['A', 'B']);
  });

  it('uses the server secret when deriving the duplicate-detection hash', () => {
    process.env.QR_DRAFT_HASH_SECRET = 'secret-a';
    const left = buildQrPayloadHash(['JAHISTC08,1']);

    process.env.QR_DRAFT_HASH_SECRET = 'secret-b';
    const right = buildQrPayloadHash(['JAHISTC08,1']);

    expect(left).not.toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
    expect(right).toMatch(/^[a-f0-9]{64}$/);
  });
});
