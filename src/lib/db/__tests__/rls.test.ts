import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client before importing the module under test
vi.mock('../client', () => {
  const mockExecuteRawUnsafe = vi.fn().mockResolvedValue(undefined);
  const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const mockTx = { $executeRawUnsafe: mockExecuteRawUnsafe };
    return fn(mockTx);
  });

  return {
    prisma: {
      $transaction: mockTransaction,
    },
    mockExecuteRawUnsafe,
  };
});

import { withOrgContext } from '../rls';
import * as clientModule from '../client';

// Access the mock via module cast
const mockClient = clientModule as unknown as {
  prisma: { $transaction: ReturnType<typeof vi.fn> };
  mockExecuteRawUnsafe: ReturnType<typeof vi.fn>;
};

describe('withOrgContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('orgId validation', () => {
    it('throws for empty string', async () => {
      await expect(withOrgContext('', async () => null)).rejects.toThrow(
        'Invalid orgId format'
      );
    });

    it('throws for SQL injection attempt', async () => {
      await expect(
        withOrgContext("' OR '1'='1", async () => null)
      ).rejects.toThrow('Invalid orgId format');
    });

    it('throws for uuid-style id (not cuid)', async () => {
      await expect(
        withOrgContext('550e8400-e29b-41d4-a716-446655440000', async () => null)
      ).rejects.toThrow('Invalid orgId format');
    });

    it('throws for id with uppercase letters', async () => {
      await expect(
        withOrgContext('CUID_UPPERCASE_NOT_VALID_1234', async () => null)
      ).rejects.toThrow('Invalid orgId format');
    });

    it('throws for id that is too short', async () => {
      await expect(
        withOrgContext('cshort', async () => null)
      ).rejects.toThrow('Invalid orgId format');
    });

    it('accepts a valid cuid v1 style id', async () => {
      const validCuid = 'clh4dz2xq0000qzrm8n9j3k1p';
      await expect(
        withOrgContext(validCuid, async () => 'ok')
      ).resolves.toBe('ok');
    });
  });

  describe('transaction and RLS setup', () => {
    it('calls $transaction on the prisma client', async () => {
      const validCuid = 'clh4dz2xq0000qzrm8n9j3k1p';
      await withOrgContext(validCuid, async () => null);
      expect(mockClient.prisma.$transaction).toHaveBeenCalledOnce();
    });

    it('calls $executeRawUnsafe with the correct SET LOCAL statement', async () => {
      const validCuid = 'clh4dz2xq0000qzrm8n9j3k1p';
      await withOrgContext(validCuid, async () => null);
      expect(mockClient.mockExecuteRawUnsafe).toHaveBeenCalledWith(
        `SET LOCAL app.current_org_id = '${validCuid}'`
      );
    });

    it('returns the value from the callback function', async () => {
      const validCuid = 'clh4dz2xq0000qzrm8n9j3k1p';
      const result = await withOrgContext(validCuid, async () => ({ data: 42 }));
      expect(result).toEqual({ data: 42 });
    });

    it('does not call $transaction when orgId is invalid', async () => {
      await expect(withOrgContext('invalid!', async () => null)).rejects.toThrow();
      expect(mockClient.prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
