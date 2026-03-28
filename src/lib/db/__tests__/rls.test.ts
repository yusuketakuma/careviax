import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getRequestAuthContextMock } = vi.hoisted(() => ({
  getRequestAuthContextMock: vi.fn(),
}));

// Mock the prisma client before importing the module under test
vi.mock('../client', () => {
  const mockExecuteRaw = vi.fn().mockResolvedValue(undefined);
  const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const mockTx = { $executeRaw: mockExecuteRaw };
    return fn(mockTx);
  });

  return {
    prisma: {
      $transaction: mockTransaction,
    },
    mockExecuteRaw,
  };
});

vi.mock('@/lib/auth/request-context', () => ({
  getRequestAuthContext: getRequestAuthContextMock,
}));

import { withOrgContext } from '../rls';
import * as clientModule from '../client';

// Access the mock via module cast
const mockClient = clientModule as unknown as {
  prisma: { $transaction: ReturnType<typeof vi.fn> };
  mockExecuteRaw: ReturnType<typeof vi.fn>;
};

describe('withOrgContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestAuthContextMock.mockReturnValue(undefined);
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

    it('sets org and request metadata via set_config', async () => {
      const validCuid = 'clh4dz2xq0000qzrm8n9j3k1p';
      await withOrgContext(validCuid, async () => null);
      expect(mockClient.mockExecuteRaw).toHaveBeenCalledTimes(5);
      expect(
        mockClient.mockExecuteRaw.mock.calls.map(([query]) => query.values)
      ).toEqual([
        ['app.current_org_id', validCuid],
        ['app.current_actor_id', ''],
        ['app.current_member_role', ''],
        ['app.current_ip_address', ''],
        ['app.current_user_agent', ''],
      ]);
    });

    it('propagates actor, role, and request metadata from auth context', async () => {
      const validCuid = 'clh4dz2xq0000qzrm8n9j3k1p';
      getRequestAuthContextMock.mockReturnValue({
        userId: 'user_1',
        orgId: validCuid,
        role: 'admin',
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Browser',
      });

      await withOrgContext(validCuid, async () => null);

      expect(
        mockClient.mockExecuteRaw.mock.calls.map(([query]) => query.values)
      ).toEqual([
        ['app.current_org_id', validCuid],
        ['app.current_actor_id', 'user_1'],
        ['app.current_member_role', 'admin'],
        ['app.current_ip_address', '203.0.113.10'],
        ['app.current_user_agent', 'Vitest Browser'],
      ]);
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
