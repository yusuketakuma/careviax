import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { getRequestAuthContextMock } = vi.hoisted(() => ({
  getRequestAuthContextMock: vi.fn(),
}));

const { logSecurityEventMock } = vi.hoisted(() => ({
  logSecurityEventMock: vi.fn(),
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

vi.mock('@/lib/auth/security-events', () => ({
  logSecurityEvent: logSecurityEventMock,
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
      await expect(withOrgContext('', async () => null)).rejects.toThrow('Invalid orgId format');
    });

    it('throws for SQL injection attempt', async () => {
      await expect(withOrgContext("' OR '1'='1", async () => null)).rejects.toThrow(
        'Invalid orgId format',
      );
    });

    it('throws for uuid-style id that starts with a digit', async () => {
      await expect(
        withOrgContext('550e8400-e29b-41d4-a716-446655440000', async () => null),
      ).rejects.toThrow('Invalid orgId format');
    });

    it('throws for id with uppercase letters', async () => {
      await expect(
        withOrgContext('CUID_UPPERCASE_NOT_VALID_1234', async () => null),
      ).rejects.toThrow('Invalid orgId format');
    });

    it('throws for id with unsupported punctuation', async () => {
      await expect(withOrgContext('org.example', async () => null)).rejects.toThrow(
        'Invalid orgId format',
      );
    });

    it('throws for id that exceeds the safe app id length', async () => {
      await expect(withOrgContext(`org_${'a'.repeat(70)}`, async () => null)).rejects.toThrow(
        'Invalid orgId format',
      );
    });

    it('accepts a valid cuid v1 style id', async () => {
      const validCuid = 'clh4dz2xq0000qzrm8n9j3k1p';
      await expect(withOrgContext(validCuid, async () => 'ok')).resolves.toBe('ok');
    });

    it('accepts the local seed org id format', async () => {
      await expect(withOrgContext('cmnhseedorg0000amq9ph-os', async () => 'ok')).resolves.toBe(
        'ok',
      );
    });

    it('accepts audit verifier ids with underscores', async () => {
      await expect(
        withOrgContext('audit_verify_org_1780141107010', async () => 'ok'),
      ).resolves.toBe('ok');
    });
  });

  describe('transaction and RLS setup', () => {
    it('calls $transaction on the prisma client', async () => {
      const validCuid = 'clh4dz2xq0000qzrm8n9j3k1p';
      await withOrgContext(validCuid, async () => null);
      expect(mockClient.prisma.$transaction).toHaveBeenCalledOnce();
    });

    it('passes an explicit transaction isolation level when provided', async () => {
      const validCuid = 'clh4dz2xq0000qzrm8n9j3k1p';
      await withOrgContext(validCuid, async () => null, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });

      expect(mockClient.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    });

    it('sets org and request metadata via set_config', async () => {
      const validCuid = 'clh4dz2xq0000qzrm8n9j3k1p';
      await withOrgContext(validCuid, async () => null);
      expect(logSecurityEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'rls_context_missing',
          org_id: validCuid,
        }),
      );
      expect(mockClient.mockExecuteRaw).toHaveBeenCalledTimes(8);
      expect(mockClient.mockExecuteRaw.mock.calls.map(([query]) => query.values)).toEqual([
        ['app.current_org_id', validCuid],
        ['app.rls_context_applied', 'true'],
        ['app.current_actor_id', ''],
        ['app.current_member_role', ''],
        ['app.current_actor_pharmacy_id', validCuid],
        ['app.current_actor_site_id', ''],
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
        actorSiteId: 'site_1',
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Browser',
      });

      await withOrgContext(validCuid, async () => null);

      expect(mockClient.mockExecuteRaw.mock.calls.map(([query]) => query.values)).toEqual([
        ['app.current_org_id', validCuid],
        ['app.rls_context_applied', 'true'],
        ['app.current_actor_id', 'user_1'],
        ['app.current_member_role', 'admin'],
        ['app.current_actor_pharmacy_id', validCuid],
        ['app.current_actor_site_id', 'site_1'],
        ['app.current_ip_address', '203.0.113.10'],
        ['app.current_user_agent', 'Vitest Browser'],
      ]);
    });

    it('rejects mismatched request context org ids before starting a transaction', async () => {
      getRequestAuthContextMock.mockReturnValue({
        userId: 'user_1',
        orgId: 'clh4dz2xq1111qzrm8n9j3k1p',
        role: 'admin',
      });

      await expect(withOrgContext('clh4dz2xq0000qzrm8n9j3k1p', async () => null)).rejects.toThrow(
        'Request orgId mismatch',
      );
      expect(mockClient.prisma.$transaction).not.toHaveBeenCalled();
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
