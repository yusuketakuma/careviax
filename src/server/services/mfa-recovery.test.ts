import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  settingFindFirstMock,
  settingDeleteMock,
  settingUpdateMock,
  settingUpsertMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  settingFindFirstMock: vi.fn(),
  settingDeleteMock: vi.fn(),
  settingUpdateMock: vi.fn(),
  settingUpsertMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    $transaction: transactionMock,
    setting: {
      findFirst: settingFindFirstMock,
      delete: settingDeleteMock,
      update: settingUpdateMock,
      upsert: settingUpsertMock,
      deleteMany: vi.fn(),
    },
  },
}));

import {
  consumeMfaRecoveryCode,
  restoreMfaRecoveryCodes,
  takeMfaRecoveryCodesForRecovery,
} from './mfa-recovery';

function hashRecoveryCode(secret: string, code: string) {
  const normalized = code.toUpperCase().replace(/[^A-Z2-9]/g, '');
  return crypto.createHash('sha256').update(`${secret}:${normalized}`).digest('hex');
}

describe('mfa-recovery service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = 'test-secret';
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          setting: {
            findFirst: settingFindFirstMock,
            delete: settingDeleteMock,
            update: settingUpdateMock,
          },
        }),
    );
    settingDeleteMock.mockResolvedValue(undefined);
    settingUpdateMock.mockResolvedValue(undefined);
    settingUpsertMock.mockResolvedValue(undefined);
  });

  it('sets a short-lived recovery lock when a valid recovery flow starts', async () => {
    const matchingHash = hashRecoveryCode(process.env.NEXTAUTH_SECRET!, 'ABCD-EFGH');
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        hashes: [matchingHash, 'other_hash'],
        generatedAt: '2026-04-04T00:00:00.000Z',
      },
    });

    const snapshot = await takeMfaRecoveryCodesForRecovery('user_1', 'ABCD-EFGH');

    expect(snapshot).toEqual({
      version: 1,
      hashes: [matchingHash, 'other_hash'],
      generatedAt: '2026-04-04T00:00:00.000Z',
      recoveryLock: null,
    });
    expect(settingUpdateMock).toHaveBeenCalledWith({
      where: { id: 'setting_1' },
      data: {
        value: expect.objectContaining({
          version: 1,
          hashes: [matchingHash, 'other_hash'],
          generatedAt: '2026-04-04T00:00:00.000Z',
          recoveryLock: expect.objectContaining({
            startedAt: expect.any(String),
            expiresAt: expect.any(String),
          }),
        }),
      },
    });
    expect(settingDeleteMock).not.toHaveBeenCalled();
  });

  it('consumes only the matching recovery code within a serializable transaction', async () => {
    const matchingHash = hashRecoveryCode(process.env.NEXTAUTH_SECRET!, 'ABCD-EFGH');
    settingFindFirstMock.mockResolvedValue({
      id: 'setting_1',
      value: {
        version: 1,
        hashes: [matchingHash, 'other_hash'],
        generatedAt: '2026-04-04T00:00:00.000Z',
      },
    });

    const consumed = await consumeMfaRecoveryCode('user_1', 'ABCD-EFGH');

    expect(consumed).toBe(true);
    expect(settingUpdateMock).toHaveBeenCalledWith({
      where: { id: 'setting_1' },
      data: {
        value: {
          version: 1,
          hashes: ['other_hash'],
          generatedAt: '2026-04-04T00:00:00.000Z',
          recoveryLock: null,
        },
      },
    });
    expect(settingDeleteMock).not.toHaveBeenCalled();
  });

  it('restores a recovery-code snapshot after a failed external recovery step', async () => {
    const snapshot = {
      version: 1 as const,
      hashes: ['hash_1', 'hash_2'],
      generatedAt: '2026-04-04T00:00:00.000Z',
    };

    await restoreMfaRecoveryCodes('user_1', snapshot);

    expect(settingUpsertMock).toHaveBeenCalledWith({
      where: {
        scope_scope_id_key: {
          scope: 'user',
          scope_id: 'user_1',
          key: 'mfa_recovery_codes',
        },
      },
      create: {
        scope: 'user',
        scope_id: 'user_1',
        key: 'mfa_recovery_codes',
        value: snapshot,
      },
      update: {
        value: snapshot,
      },
    });
  });
});
