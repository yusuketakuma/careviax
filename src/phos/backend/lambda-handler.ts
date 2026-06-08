import { randomUUID } from 'node:crypto';
import { toErrorLambdaResponse, toLambdaJsonResponse } from './error-response';
import type { PhosLambdaResponse } from './error-response';
import {
  assertTenantIdNotInExternalInput,
  buildTenantContext,
  TenantContextError,
} from './tenant-context';
import type { TenantContext, JwtClaims } from './tenant-context';

export type PhosHttpEvent = {
  version?: string;
  routeKey?: string;
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  requestContext?: {
    requestId?: string;
    authorizer?: {
      jwt?: {
        claims?: JwtClaims;
      };
    };
  };
};

export type PhosHandlerInput = {
  event: PhosHttpEvent;
  ctx: TenantContext;
  body: unknown;
};

export type PhosHandler = (input: PhosHandlerInput) => Promise<unknown | PhosLambdaResponse>;

function readHeader(
  headers: Record<string, string | undefined> | undefined,
  key: string,
): string | undefined {
  const target = key.toLowerCase();
  const found = Object.entries(headers ?? {}).find(
    ([headerKey]) => headerKey.toLowerCase() === target,
  );
  return found?.[1];
}

function parseJsonBody(body: string | null | undefined, request_id: string): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    throw new TenantContextError(400, {
      request_id,
      error_code: 'VALIDATION_ERROR',
      message_key: 'api.error.invalid_json',
    });
  }
}

function isLambdaResponse(value: unknown): value is PhosLambdaResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as PhosLambdaResponse).statusCode === 'number' &&
    typeof (value as PhosLambdaResponse).body === 'string'
  );
}

export function withTenantContext(handler: PhosHandler) {
  return async (event: PhosHttpEvent) => {
    const request_id = event.requestContext?.requestId ?? randomUUID();
    const correlation_id = readHeader(event.headers, 'x-correlation-id') ?? request_id;

    try {
      const body = parseJsonBody(event.body, request_id);
      assertTenantIdNotInExternalInput({
        request_id,
        body,
        query: event.queryStringParameters,
        path: event.pathParameters,
      });

      const ctx = buildTenantContext({
        claims: event.requestContext?.authorizer?.jwt?.claims ?? {},
        request_id,
        correlation_id,
      });

      const result = await handler({ event, ctx, body });
      if (isLambdaResponse(result)) return result;
      return toLambdaJsonResponse(200, result);
    } catch (error) {
      if (error instanceof TenantContextError) {
        return toErrorLambdaResponse(error.status, error.response);
      }

      return toErrorLambdaResponse(500, {
        request_id,
        error_code: 'INTERNAL_ERROR',
        message_key: 'api.error.internal',
      });
    }
  };
}
