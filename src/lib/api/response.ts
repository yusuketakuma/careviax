import { NextResponse } from 'next/server';

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
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

export function notFound(message = 'リソースが見つかりません') {
  return error('NOT_FOUND', message, 404);
}

export function forbidden(message = '権限がありません') {
  return error('AUTH_FORBIDDEN', message, 403);
}

export function conflict(message = '競合が発生しました') {
  return error('CONFLICT', message, 409);
}
