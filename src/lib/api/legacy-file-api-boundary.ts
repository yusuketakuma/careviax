import type { NextResponse } from 'next/server';
import { error } from './response';

export const PHOS_DISABLE_LEGACY_FILE_API_ENV = 'PHOS_DISABLE_LEGACY_FILE_API';
export const PHOS_ENABLE_LEGACY_FILE_API_ENV = 'PHOS_ENABLE_LEGACY_FILE_API';
export const PHOS_LEGACY_FILE_API_DISABLED_CODE = 'PHOS_LEGACY_FILE_API_DISABLED';

function isTruthy(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

export function isLegacyFileApiDisabled(env: NodeJS.ProcessEnv = process.env) {
  if (isTruthy(env[PHOS_DISABLE_LEGACY_FILE_API_ENV])) return true;

  if (env.NODE_ENV?.trim().toLowerCase() === 'production') {
    return !isTruthy(env[PHOS_ENABLE_LEGACY_FILE_API_ENV]);
  }

  return false;
}

export function legacyFileApiDisabledResponse(
  env: NodeJS.ProcessEnv = process.env,
): NextResponse | undefined {
  if (!isLegacyFileApiDisabled(env)) return undefined;

  return error(
    PHOS_LEGACY_FILE_API_DISABLED_CODE,
    'PH-OS production disables this legacy file API. Use API Gateway /evidence/presign-upload.',
    410,
  );
}
