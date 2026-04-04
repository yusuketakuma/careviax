import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

const RECOVERY_CODE_SETTING_KEY = 'mfa_recovery_codes';
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_LENGTH = 8;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type StoredRecoveryCodes = {
  version: 1;
  hashes: string[];
  generatedAt: string;
  recoveryLock?: {
    startedAt: string;
    expiresAt: string;
  } | null;
};

const SERIALIZABLE_RETRY_LIMIT = 3;
const RECOVERY_LOCK_TTL_MS = 5 * 60 * 1000;

export class MfaRecoveryConfigError extends Error {
  constructor(message = 'MFA recovery secret is not configured') {
    super(message);
    this.name = 'MfaRecoveryConfigError';
  }
}

function normalizeRecoveryCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z2-9]/g, '');
}

function hashRecoveryCode(code: string) {
  const secret =
    process.env.MFA_RECOVERY_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new MfaRecoveryConfigError();
  }
  return crypto
    .createHash('sha256')
    .update(`${secret}:${normalizeRecoveryCode(code)}`)
    .digest('hex');
}

function formatRecoveryCode(code: string) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function createRecoveryCode() {
  const bytes = crypto.randomBytes(RECOVERY_CODE_LENGTH);
  let code = '';

  for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
    code += RECOVERY_ALPHABET[bytes[index] % RECOVERY_ALPHABET.length];
  }

  return code;
}

function parseStoredRecoveryCodes(value: unknown): StoredRecoveryCodes | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.hashes)) return null;

  const hashes = record.hashes.filter((item): item is string => typeof item === 'string');
  const generatedAt = typeof record.generatedAt === 'string' ? record.generatedAt : new Date().toISOString();
  const recoveryLockRecord =
    record.recoveryLock && typeof record.recoveryLock === 'object'
      ? (record.recoveryLock as Record<string, unknown>)
      : null;
  const recoveryLock =
    typeof recoveryLockRecord?.startedAt === 'string' &&
    typeof recoveryLockRecord?.expiresAt === 'string'
      ? {
          startedAt: recoveryLockRecord.startedAt,
          expiresAt: recoveryLockRecord.expiresAt,
        }
      : null;

  return {
    version: 1,
    hashes,
    generatedAt,
    recoveryLock,
  };
}

function hasActiveRecoveryLock(
  recoveryLock: StoredRecoveryCodes['recoveryLock'],
  now = new Date(),
) {
  if (!recoveryLock) return false;
  const expiresAt = Date.parse(recoveryLock.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

function getRecoveryCodeSettingWhere(userId: string) {
  return {
    scope: 'user' as const,
    scope_id: userId,
    key: RECOVERY_CODE_SETTING_KEY,
  };
}

async function withSerializableRetry<TValue>(
  work: (tx: Prisma.TransactionClient) => Promise<TValue>,
): Promise<TValue> {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      const isRetryableConflict =
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === 'P2034';

      if (!isRetryableConflict || attempt === SERIALIZABLE_RETRY_LIMIT - 1) {
        throw cause;
      }
    }
  }

  throw new Error('mfa recovery transaction could not be completed');
}

export async function issueMfaRecoveryCodes(userId: string) {
  const rawCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => createRecoveryCode());

  await prisma.setting.upsert({
    where: {
      scope_scope_id_key: {
        ...getRecoveryCodeSettingWhere(userId),
      },
    },
    create: {
      scope: 'user',
      scope_id: userId,
      key: RECOVERY_CODE_SETTING_KEY,
      value: {
        version: 1,
        hashes: rawCodes.map(hashRecoveryCode),
        generatedAt: new Date().toISOString(),
      },
    },
    update: {
      value: {
        version: 1,
        hashes: rawCodes.map(hashRecoveryCode),
        generatedAt: new Date().toISOString(),
      },
    },
  });

  return rawCodes.map(formatRecoveryCode);
}

export async function hasMfaRecoveryCodes(userId: string) {
  const setting = await prisma.setting.findFirst({
    where: {
      ...getRecoveryCodeSettingWhere(userId),
    },
    select: { value: true },
  });

  const parsed = parseStoredRecoveryCodes(setting?.value);
  return Boolean(parsed && parsed.hashes.length > 0);
}

export async function verifyMfaRecoveryCode(userId: string, code: string) {
  const setting = await prisma.setting.findFirst({
    where: {
      ...getRecoveryCodeSettingWhere(userId),
    },
    select: { value: true },
  });

  const parsed = parseStoredRecoveryCodes(setting?.value);
  if (!parsed) {
    return false;
  }
  if (hasActiveRecoveryLock(parsed.recoveryLock)) {
    return false;
  }

  const targetHash = hashRecoveryCode(code);
  return parsed.hashes.includes(targetHash);
}

export async function consumeMfaRecoveryCode(userId: string, code: string) {
  const targetHash = hashRecoveryCode(code);

  return withSerializableRetry(async (tx) => {
    const setting = await tx.setting.findFirst({
      where: {
        ...getRecoveryCodeSettingWhere(userId),
      },
      select: {
        id: true,
        value: true,
      },
    });

    if (!setting) return false;

    const parsed = parseStoredRecoveryCodes(setting.value);
    if (!parsed) return false;
    if (hasActiveRecoveryLock(parsed.recoveryLock)) {
      return false;
    }

    const remainingHashes = parsed.hashes.filter((hash) => hash !== targetHash);
    if (remainingHashes.length === parsed.hashes.length) {
      return false;
    }

    if (remainingHashes.length === 0) {
      await tx.setting.delete({
        where: { id: setting.id },
      });
      return true;
    }

    await tx.setting.update({
      where: { id: setting.id },
      data: {
        value: {
          ...parsed,
          hashes: remainingHashes,
          recoveryLock: null,
        },
      },
    });

    return true;
  });
}

export async function takeMfaRecoveryCodesForRecovery(
  userId: string,
  code: string,
): Promise<StoredRecoveryCodes | null> {
  const targetHash = hashRecoveryCode(code);

  return withSerializableRetry(async (tx) => {
    const now = new Date();
    const setting = await tx.setting.findFirst({
      where: {
        ...getRecoveryCodeSettingWhere(userId),
      },
      select: {
        id: true,
        value: true,
      },
    });

    if (!setting) return null;

    const parsed = parseStoredRecoveryCodes(setting.value);
    if (!parsed || hasActiveRecoveryLock(parsed.recoveryLock) || !parsed.hashes.includes(targetHash)) {
      return null;
    }

    await tx.setting.update({
      where: { id: setting.id },
      data: {
        value: {
          ...parsed,
          recoveryLock: {
            startedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + RECOVERY_LOCK_TTL_MS).toISOString(),
          },
        },
      },
    });

    return parsed;
  });
}

export async function restoreMfaRecoveryCodes(userId: string, snapshot: StoredRecoveryCodes | null) {
  if (!snapshot || snapshot.hashes.length === 0) {
    return;
  }

  await prisma.setting.upsert({
    where: {
      scope_scope_id_key: {
        ...getRecoveryCodeSettingWhere(userId),
      },
    },
    create: {
      scope: 'user',
      scope_id: userId,
      key: RECOVERY_CODE_SETTING_KEY,
      value: snapshot,
    },
    update: {
      value: snapshot,
    },
  });
}

export async function clearMfaRecoveryCodes(userId: string) {
  await prisma.setting.deleteMany({
    where: {
      ...getRecoveryCodeSettingWhere(userId),
    },
  });
}
