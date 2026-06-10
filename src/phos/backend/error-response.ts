import type { ErrorResponse } from '@/phos/contracts/phos_contracts';

export type PhosLambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export function toLambdaJsonResponse(statusCode: number, body: unknown): PhosLambdaResponse {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json',
      Pragma: 'no-cache',
      'X-Request-Id': readRequestId(body),
    },
    body: JSON.stringify(body),
  };
}

export function toErrorLambdaResponse(status: number, response: ErrorResponse): PhosLambdaResponse {
  return toLambdaJsonResponse(status, response);
}

function readRequestId(body: unknown): string {
  if (body && typeof body === 'object' && 'request_id' in body) {
    const requestId = (body as { request_id?: unknown }).request_id;
    if (typeof requestId === 'string') return requestId;
  }
  return '';
}
