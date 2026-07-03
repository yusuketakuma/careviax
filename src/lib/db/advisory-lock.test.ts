import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { acquireAdvisoryTxLock, advisoryLockKeyPair } from './advisory-lock';

describe('advisoryLockKeyPair', () => {
  it('derives a deterministic signed int32 pair from namespace + key', () => {
    const a = advisoryLockKeyPair('ns', 'key');
    const b = advisoryLockKeyPair('ns', 'key');
    expect(a).toEqual(b);
    for (const value of a) {
      expect(Number.isInteger(value)).toBe(true);
      // pg_advisory_xact_lock(int4, int4) の範囲に収まる。
      expect(value).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(value).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });

  it('separates lock spaces by namespace and by key', () => {
    expect(advisoryLockKeyPair('ns_a', 'key')).not.toEqual(advisoryLockKeyPair('ns_b', 'key'));
    expect(advisoryLockKeyPair('ns', 'key_a')).not.toEqual(advisoryLockKeyPair('ns', 'key_b'));
    // namespace/key の境界を跨いだ連結衝突が起きない（"a" + " b" と "a " + "b" が別）。
    expect(advisoryLockKeyPair('a', ' b')).not.toEqual(advisoryLockKeyPair('a ', 'b'));
  });
});

describe('acquireAdvisoryTxLock', () => {
  it('issues pg_advisory_xact_lock with the derived int4 pair on the given tx', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const tx = { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient;

    await acquireAdvisoryTxLock(tx, 'business_holiday_dedup', 'org_1::2026-03-30:site_closure');

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const sql = executeRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
    expect(sql.strings.join('?')).toContain('pg_advisory_xact_lock');
    expect(sql.strings.join('')).toContain('::int4');
    expect(sql.values).toEqual(
      advisoryLockKeyPair('business_holiday_dedup', 'org_1::2026-03-30:site_closure'),
    );
  });
});
