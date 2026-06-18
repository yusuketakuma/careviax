import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientIdempotencyKey } from './client-key';

describe('createClientIdempotencyKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('joins scope parts with a crypto UUID suffix', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000001',
    );

    expect(createClientIdempotencyKey('visit-contact', 'proposal_1')).toBe(
      'visit-contact:proposal_1:00000000-0000-4000-8000-000000000001',
    );
  });

  it('falls back to timestamp and random suffix when randomUUID is unavailable', () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {});
    vi.spyOn(Date, 'now').mockReturnValue(1718679600000);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);

    expect(createClientIdempotencyKey('care-report-send')).toMatch(
      /^care-report-send:[a-z0-9]+-[a-z0-9]+$/,
    );

    vi.stubGlobal('crypto', originalCrypto);
  });
});
