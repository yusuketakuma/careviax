import type { NextResponse } from 'next/server';
import { error } from './response';

export const PHOS_DISABLE_LEGACY_FILE_API_ENV = 'PHOS_DISABLE_LEGACY_FILE_API';
export const PHOS_LEGACY_FILE_API_DISABLED_CODE = 'PHOS_LEGACY_FILE_API_DISABLED';

export function isLegacyFileApiDisabled(env: NodeJS.ProcessEnv = process.env) {
  const value = env[PHOS_DISABLE_LEGACY_FILE_API_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true';
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
