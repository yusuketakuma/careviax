import { describe, expect, it } from 'vitest';
import { buildQrPayloadHash, canonicalizeQrTextPages } from './qr-draft-fingerprint';

describe('qr draft fingerprint', () => {
  it('canonicalizes duplicate pages and page order before hashing', () => {
    const left = buildQrPayloadHash([' JAHISTC08,page-2\r\nA ', 'JAHISTC08,page-1']);
    const right = buildQrPayloadHash(['JAHISTC08,page-1', 'JAHISTC08,page-2\nA']);

    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the canonical page set for duplicate detection', () => {
    expect(canonicalizeQrTextPages([' B ', 'A', 'B'])).toEqual(['A', 'B']);
  });
});
