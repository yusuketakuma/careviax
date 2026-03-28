import crypto from 'node:crypto';
import { prisma } from '@/lib/db/client';

const RECOVERY_CODE_SETTING_KEY = 'mfa_recovery_codes';
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_LENGTH = 8;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type StoredRecoveryCodes = {
  version: 1;
  hashes: string[];
  generatedAt: string;
};

function normalizeRecoveryCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z2-9]/g, '');
}

function hashRecoveryCode(code: string) {
  const secret = process.env.NEXTAUTH_SECRET ?? 'careviax-mfa-recovery';
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

  return {
    version: 1,
    hashes,
    generatedAt,
  };
}

export async function issueMfaRecoveryCodes(userId: string) {
  const rawCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => createRecoveryCode());

  await prisma.setting.upsert({
    where: {
      scope_scope_id_key: {
        scope: 'user',
        scope_id: userId,
        key: RECOVERY_CODE_SETTING_KEY,
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
      scope: 'user',
      scope_id: userId,
      key: RECOVERY_CODE_SETTING_KEY,
    },
    select: { value: true },
  });

  const parsed = parseStoredRecoveryCodes(setting?.value);
  return Boolean(parsed && parsed.hashes.length > 0);
}

export async function verifyMfaRecoveryCode(userId: string, code: string) {
  const setting = await prisma.setting.findFirst({
    where: {
      scope: 'user',
      scope_id: userId,
      key: RECOVERY_CODE_SETTING_KEY,
    },
    select: { value: true },
  });

  const parsed = parseStoredRecoveryCodes(setting?.value);
  if (!parsed) {
    return false;
  }

  const targetHash = hashRecoveryCode(code);
  return parsed.hashes.includes(targetHash);
}

export async function consumeMfaRecoveryCode(userId: string, code: string) {
  const setting = await prisma.setting.findFirst({
    where: {
      scope: 'user',
      scope_id: userId,
      key: RECOVERY_CODE_SETTING_KEY,
    },
    select: {
      id: true,
      value: true,
    },
  });

  if (!setting) return false;

  const parsed = parseStoredRecoveryCodes(setting.value);
  if (!parsed) return false;

  const targetHash = hashRecoveryCode(code);
  const remainingHashes = parsed.hashes.filter((hash) => hash !== targetHash);
  if (remainingHashes.length === parsed.hashes.length) {
    return false;
  }

  if (remainingHashes.length === 0) {
    await prisma.setting.delete({
      where: { id: setting.id },
    });
    return true;
  }

  await prisma.setting.update({
    where: { id: setting.id },
    data: {
      value: {
        ...parsed,
        hashes: remainingHashes,
      },
    },
  });

  return true;
}

export async function clearMfaRecoveryCodes(userId: string) {
  await prisma.setting.deleteMany({
    where: {
      scope: 'user',
      scope_id: userId,
      key: RECOVERY_CODE_SETTING_KEY,
    },
  });
}
