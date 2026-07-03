import { NextResponse } from 'next/server';

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

const defaultLabelKeysByCode: Partial<Record<string, string>> = {
  AUTH_UNAUTHENTICATED: 'api.error.auth.unauthenticated',
  AUTH_NO_ORG: 'api.error.auth.no_org',
  AUTH_FORBIDDEN: 'api.error.auth.forbidden',
  VALIDATION_ERROR: 'api.error.validation.generic',
  WORKFLOW_NOT_FOUND: 'api.error.workflow.not_found',
  WORKFLOW_CONFLICT: 'api.error.workflow.conflict',
};

export function success<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function error(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ code, message, details } satisfies ApiError, { status });
}

export function validationError(message: string, details?: unknown) {
  return error('VALIDATION_ERROR', message, 400, details);
}

/**
 * 想定外の throw を標準 {code,message} 500 エンベロープに変換する。
 * 生のエラーメッセージは情報漏洩を避けるため出さず、固定文言を返す。
 */
export function internalError(message = 'サーバー内部でエラーが発生しました') {
  return error('INTERNAL_ERROR', message, 500);
}

export function compatibilityError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
  fieldErrors?: unknown,
) {
  return NextResponse.json({ error: message, code, message, details, fieldErrors }, { status });
}

export function validationCompatibilityError(message: string, details?: unknown) {
  return compatibilityError('VALIDATION_ERROR', message, 400, details, details);
}

export function notFound(message = 'リソースが見つかりません') {
  return error('WORKFLOW_NOT_FOUND', message, 404);
}

export function forbidden(message = '権限がありません') {
  return error('AUTH_FORBIDDEN', message, 403);
}

export function conflict(message = '競合が発生しました', details?: unknown) {
  return error('WORKFLOW_CONFLICT', message, 409, details);
}

/**
 * 429 Too Many Requests。Retry-After ヘッダ(秒)付き。
 * `retryAfterSeconds` は 1 秒未満・NaN・負数を切り上げてガードする。
 */
export function rateLimited(
  retryAfterSeconds: number,
  message = 'リクエストが多すぎます。しばらくしてから再度お試しください',
) {
  const safeRetryAfterSeconds = Number.isFinite(retryAfterSeconds)
    ? Math.max(1, Math.ceil(retryAfterSeconds))
    : 1;
  return NextResponse.json({ code: 'RATE_LIMIT_EXCEEDED', message } satisfies ApiError, {
    status: 429,
    headers: { 'Retry-After': String(safeRetryAfterSeconds) },
  });
}

async function resolveLocalizedMessage(code: string, message: string, labelKey?: string) {
  const resolvedLabelKey = labelKey ?? defaultLabelKeysByCode[code];
  if (!resolvedLabelKey) return message;
  try {
    const { getLabelDictionaryValue } = await import('@/server/services/label-dictionary');
    return await getLabelDictionaryValue(resolvedLabelKey, message);
  } catch {
    return message;
  }
}

export async function localizedError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
  labelKey?: string,
) {
  const localizedMessage = await resolveLocalizedMessage(code, message, labelKey);
  return error(code, localizedMessage, status, details);
}

export async function unauthorized(message = '認証が必要です', details?: unknown) {
  return localizedError('AUTH_UNAUTHENTICATED', message, 401, details);
}

export async function authNoOrg(message = '組織IDが必要です', details?: unknown) {
  return localizedError('AUTH_NO_ORG', message, 400, details);
}

export async function forbiddenResponse(message = '権限がありません', details?: unknown) {
  return localizedError('AUTH_FORBIDDEN', message, 403, details);
}

export async function externalError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
  labelKey?: string,
) {
  return localizedError(code, message, status, details, labelKey);
}
