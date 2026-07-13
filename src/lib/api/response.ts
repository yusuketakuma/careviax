import { NextResponse } from 'next/server';
import { getApiErrorDefinition, type RegisteredApiErrorCode } from '@/lib/api/error-codes';

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiSuccess<TData, TMeta extends object = Record<string, unknown>> = {
  data: TData;
  meta?: TMeta;
};

export function success<TData, TMeta extends object = Record<string, unknown>>(
  payload: ApiSuccess<TData, TMeta>,
  status = 200,
) {
  return NextResponse.json(payload, { status });
}

const jsonPayloadEncoder = new TextEncoder();

export function successWithMeasuredJsonPayload<
  TData,
  TMeta extends object = Record<string, unknown>,
>(payload: ApiSuccess<TData, TMeta>, status = 200) {
  const response = success(payload, status);
  response.headers.set(
    'Content-Length',
    String(jsonPayloadEncoder.encode(JSON.stringify(payload)).length),
  );
  return response;
}

export function error(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ code, message, details } satisfies ApiError, { status });
}

export function registeredError(code: RegisteredApiErrorCode, message: string, details?: unknown) {
  const definition = getApiErrorDefinition(code);
  return error(code, message, definition.httpStatus, details);
}

export function validationError(message: string, details?: unknown) {
  return registeredError('VALIDATION_ERROR', message, details);
}

/**
 * 想定外の throw を標準 {code,message} 500 エンベロープに変換する。
 * 生のエラーメッセージは情報漏洩を避けるため出さず、固定文言を返す。
 */
export function internalError(message = 'サーバー内部でエラーが発生しました') {
  return registeredError('INTERNAL_ERROR', message);
}

export function notFound(message = 'リソースが見つかりません') {
  return registeredError('WORKFLOW_NOT_FOUND', message);
}

export function forbidden(message = '権限がありません') {
  return registeredError('AUTH_FORBIDDEN', message);
}

export function conflict(message = '競合が発生しました', details?: unknown) {
  return registeredError('WORKFLOW_CONFLICT', message, details);
}

/**
 * 429 Too Many Requests。Retry-After ヘッダ(秒)付き。
 * `retryAfterSeconds` は 1 秒未満・NaN・負数を切り上げてガードする。
 */
export function rateLimited(
  retryAfterSeconds: number,
  message = 'リクエストが多すぎます。しばらくしてから再度お試しください',
) {
  const definition = getApiErrorDefinition('RATE_LIMIT_EXCEEDED');
  const safeRetryAfterSeconds = Number.isFinite(retryAfterSeconds)
    ? Math.max(1, Math.ceil(retryAfterSeconds))
    : 1;
  return NextResponse.json({ code: 'RATE_LIMIT_EXCEEDED', message } satisfies ApiError, {
    status: definition.httpStatus,
    headers: { 'Retry-After': String(safeRetryAfterSeconds) },
  });
}

async function resolveLocalizedMessage(message: string, labelKey?: string) {
  if (!labelKey) return message;
  try {
    const { getLabelDictionaryValue } = await import('@/server/services/label-dictionary');
    return await getLabelDictionaryValue(labelKey, message);
  } catch {
    return message;
  }
}

async function localizedRegisteredError(
  code: RegisteredApiErrorCode,
  message: string,
  details?: unknown,
) {
  const definition = getApiErrorDefinition(code);
  const localizedMessage = await resolveLocalizedMessage(message, definition.messageLabel);
  return error(code, localizedMessage, definition.httpStatus, details);
}

export async function localizedError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
  labelKey?: string,
) {
  const localizedMessage = await resolveLocalizedMessage(message, labelKey);
  return error(code, localizedMessage, status, details);
}

export async function unauthorized(message = '認証が必要です', details?: unknown) {
  return localizedRegisteredError('AUTH_UNAUTHENTICATED', message, details);
}

export async function authNoOrg(message = '組織IDが必要です', details?: unknown) {
  return localizedRegisteredError('AUTH_NO_ORG', message, details);
}

export async function forbiddenResponse(message = '権限がありません', details?: unknown) {
  return localizedRegisteredError('AUTH_FORBIDDEN', message, details);
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
