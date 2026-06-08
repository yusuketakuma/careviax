import { randomUUID } from 'node:crypto';
import { toErrorLambdaResponse, toLambdaJsonResponse } from './error-response';
import type { PhosLambdaResponse } from './error-response';
import { buildLogEntry, logPhosEvent } from './structured-logger';
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

function routeKey(event: PhosHttpEvent): string {
  return event.routeKey ?? event.rawPath ?? 'UNKNOWN_ROUTE';
}

function logBoundaryError(input: {
  event: PhosHttpEvent;
  ctx?: TenantContext;
  request_id: string;
  correlation_id: string;
  error_code: string;
  details?: Record<string, unknown>;
}) {
  if (input.ctx) {
    logPhosEvent(
      buildLogEntry({
        level: 'ERROR',
        message: 'PH-OS lambda boundary failed',
        ctx: input.ctx,
        route_key: routeKey(input.event),
        error_code: input.error_code,
        details: input.details,
      }),
    );
    return;
  }

  logPhosEvent({
    level: 'ERROR',
    message: 'PH-OS lambda boundary failed before tenant context',
    tenant_id: 'UNKNOWN',
    user_id: 'UNKNOWN',
    request_id: input.request_id,
    correlation_id: input.correlation_id,
    route_key: routeKey(input.event),
    error_code: input.error_code,
    ...(input.details ? { details: input.details } : {}),
  });
}

export function withTenantContext(handler: PhosHandler) {
  return async (event: PhosHttpEvent) => {
    const request_id = event.requestContext?.requestId ?? randomUUID();
    const correlation_id = readHeader(event.headers, 'x-correlation-id') ?? request_id;
    let ctx: TenantContext | undefined;

    try {
      const body = parseJsonBody(event.body, request_id);
      assertTenantIdNotInExternalInput({
        request_id,
        body,
        query: event.queryStringParameters,
        path: event.pathParameters,
      });

      ctx = buildTenantContext({
        claims: event.requestContext?.authorizer?.jwt?.claims ?? {},
        request_id,
        correlation_id,
      });

      const result = await handler({ event, ctx, body });
      if (isLambdaResponse(result)) return result;
      return toLambdaJsonResponse(200, result);
    } catch (error) {
      if (error instanceof TenantContextError) {
        logBoundaryError({
          event,
          ctx,
          request_id,
          correlation_id,
          error_code: error.response.error_code,
          details: error.response.details,
        });
        return toErrorLambdaResponse(error.status, error.response);
      }

      logBoundaryError({
        event,
        ctx,
        request_id,
        correlation_id,
        error_code: 'INTERNAL_ERROR',
      });
      return toErrorLambdaResponse(500, {
        request_id,
        error_code: 'INTERNAL_ERROR',
        message_key: 'api.error.internal',
      });
    }
  };
}
