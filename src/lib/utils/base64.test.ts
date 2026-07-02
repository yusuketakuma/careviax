import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { arrayBufferToBase64, base64ToArrayBuffer, base64ToBytes, bytesToBase64 } from './base64';

function deterministicBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (index * 31 + 17) % 256;
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

describe('base64 utilities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encodes bytes identically to the platform base64 implementation', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);

    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('round-trips bytes through base64 helpers', () => {
    const bytes = deterministicBytes(257);
    const encoded = arrayBufferToBase64(toArrayBuffer(bytes));

    expect([...base64ToBytes(encoded)]).toEqual([...bytes]);
    expect([...new Uint8Array(base64ToArrayBuffer(encoded))]).toEqual([...bytes]);
  });

  it('encodes large byte arrays in bounded chunks instead of one call per byte', () => {
    const bytes = deterministicBytes(0x8000 * 2 + 17);
    const fromCharCodeSpy = vi.spyOn(String, 'fromCharCode');

    const encoded = bytesToBase64(bytes);

    expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
    expect(fromCharCodeSpy.mock.calls).toHaveLength(3);
    expect(Math.max(...fromCharCodeSpy.mock.calls.map((call) => call.length))).toBeLessThanOrEqual(
      0x8000,
    );
  });
});
