import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@/phos/contracts/phos_contracts';
import type { PhosLambdaResponse } from '@/phos/backend/error-response';
import type { PhosHttpEvent } from '@/phos/backend/lambda-handler';
import { PHOS_API_ROUTES, type PhosApiRoute } from './api-gateway-routes';
import { bindPhosApiRouteForDeployment } from './api-gateway-lambda-template';

type PhosLambdaHandler = (event: PhosHttpEvent) => Promise<PhosLambdaResponse>;

function pathFor(route: PhosApiRoute): string {
  return route.path.replace(/\{([^}]+)\}/g, (_, name: string) => `${name}_1`);
}

function pathParametersFor(route: PhosApiRoute): Record<string, string> | undefined {
  const matches = [...route.path.matchAll(/\{([^}]+)\}/g)];
  if (matches.length === 0) return undefined;
  return Object.fromEntries(matches.map((match) => [match[1], `${match[1]}_1`]));
}

function apiGatewayEventFor(
  route: PhosApiRoute,
  overrides: Partial<PhosHttpEvent> = {},
): PhosHttpEvent {
  return {
    resource: route.path,
    httpMethod: route.method,
    rawPath: pathFor(route),
    headers: {
      authorization: 'Bearer test.jwt',
      'x-correlation-id': 'corr_runtime',
    },
    pathParameters: pathParametersFor(route),
    queryStringParameters: null,
    body: route.method === 'POST' ? '{}' : undefined,
    requestContext: {
      requestId: `req_${route.route_key.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      authorizer: {
        claims: {
          token_use: 'access',
          tenant_id: 'tenant_abc123',
          sub: 'user_1',
          role: route.allowed_roles[0] ?? UserRole.ADMIN,
          scope: route.required_scopes.join(' '),
        },
      },
    },
    ...overrides,
  };
}

function withJwtClaims(event: PhosHttpEvent, claims: Record<string, string>): PhosHttpEvent {
  const existingJwtClaims = event.requestContext?.authorizer?.jwt?.claims;
  const existingRestClaims = event.requestContext?.authorizer?.claims;
  return {
    ...event,
    requestContext: {
      ...event.requestContext,
      authorizer: {
        ...(existingJwtClaims
          ? {
              jwt: {
                claims: {
                  ...existingJwtClaims,
                  ...claims,
                },
              },
            }
          : {
              claims: {
                ...(existingRestClaims ?? {}),
                ...claims,
              },
            }),
      },
    },
  };
}

function disallowedRoleFor(route: PhosApiRoute): UserRole | undefined {
  return Object.values(UserRole).find((role) => !route.allowed_roles.includes(role));
}

async function importRouteHandler(route: PhosApiRoute): Promise<PhosLambdaHandler> {
  const [modulePath, exportName] = route.lambda_handler.split('#');
  expect(modulePath).toBeTruthy();
  expect(exportName).toBeTruthy();
  const lambdaModule = (await import(modulePath.replace('@/', '@/'))) as Record<string, unknown>;
  const handler = lambdaModule[exportName];
  expect(handler).toEqual(expect.any(Function));
  return handler as PhosLambdaHandler;
}

function parseBody(response: PhosLambdaResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

function parsedConsoleLogEntries(): Record<string, unknown>[] {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

function parsedConsoleErrorEntries(): Record<string, unknown>[] {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

function clearConsoleSpies() {
  vi.mocked(console.log).mockClear();
  vi.mocked(console.error).mockClear();
}

describe('PH-OS API Gateway/Lambda runtime proof', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes every manifest Lambda export and rejects external tenant_id with JWT attribution', async () => {
    for (const route of PHOS_API_ROUTES) {
      const binding = bindPhosApiRouteForDeployment(route);
      const handler = await importRouteHandler(route);
      expect(binding.cloudformation_handler).toBe(
        `${binding.lambda_handler_file}.${binding.lambda_handler_export}`,
      );

      const cases: Array<{
        source: 'query' | 'path' | 'body';
        overrides: Partial<PhosHttpEvent>;
      }> = [
        {
          source: 'query',
          overrides: { queryStringParameters: { tenant_id: 'tenant_other' } },
        },
        {
          source: 'path',
          overrides: {
            pathParameters: {
              ...(pathParametersFor(route) ?? {}),
              tenant_id: 'tenant_other',
            },
          },
        },
        ...(route.method === 'POST'
          ? [
              {
                source: 'body' as const,
                overrides: { body: JSON.stringify({ tenant_id: 'tenant_other' }) },
              },
            ]
          : []),
      ];

      for (const testCase of cases) {
        clearConsoleSpies();
        const response = await handler(apiGatewayEventFor(route, testCase.overrides));

        expect(response.statusCode).toBe(400);
        expect(parseBody(response)).toMatchObject({
          error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
          message_key: 'api.error.tenant_id_in_payload_forbidden',
          details: { source: testCase.source },
        });
        expect(parsedConsoleErrorEntries()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              level: 'ERROR',
              message: 'PH-OS lambda boundary failed',
              result: 'ERROR',
              status_code: 400,
              tenant_id: 'tenant_abc123',
              user_id: 'user_1',
              request_id: `req_${route.route_key.replace(/[^a-zA-Z0-9]+/g, '_')}`,
              correlation_id: 'corr_runtime',
              route_key: route.route_key,
              error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
              details: { source: testCase.source },
            }),
          ]),
        );
        expect(parsedConsoleLogEntries()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              route_key: route.route_key,
              tenant_id: 'tenant_abc123',
              user_id: 'user_1',
              TenantBoundaryRejectedCount: 1,
            }),
            expect.objectContaining({
              route_key: route.route_key,
              tenant_id: 'tenant_abc123',
              user_id: 'user_1',
              CrossTenantAttemptCount: 1,
            }),
          ]),
        );
      }
    }
  });

  it('fails closed for every manifest route when API Gateway JWT claims are missing', async () => {
    for (const route of PHOS_API_ROUTES) {
      const handler = await importRouteHandler(route);
      const response = await handler(
        apiGatewayEventFor(route, {
          requestContext: { requestId: 'req_missing_claims' },
        }),
      );

      expect(response.statusCode).toBe(401);
      expect(parseBody(response)).toMatchObject({
        request_id: 'req_missing_claims',
        error_code: 'TENANT_CONTEXT_MISSING',
      });
    }
  });

  it('rejects malformed JSON before any route repository can run', async () => {
    const postRoutes = PHOS_API_ROUTES.filter((route) => route.method === 'POST');

    for (const route of postRoutes) {
      const handler = await importRouteHandler(route);
      const response = await handler(apiGatewayEventFor(route, { body: '{' }));

      expect(response.statusCode).toBe(400);
      expect(parseBody(response)).toMatchObject({
        error_code: 'VALIDATION_ERROR',
        message_key: 'api.error.invalid_json',
      });
    }
  });

  it('returns canonical 403 responses for every manifest route when required scopes are missing', async () => {
    for (const route of PHOS_API_ROUTES) {
      const handler = await importRouteHandler(route);
      const response = await handler(
        withJwtClaims(apiGatewayEventFor(route), {
          scope: 'phos/unrelated.read',
        }),
      );

      expect(response.statusCode).toBe(403);
      expect(parseBody(response)).toMatchObject({
        request_id: `req_${route.route_key.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        error_code: 'FORBIDDEN',
        message_key: 'api.error.forbidden',
        details: { missing_scopes: [...route.required_scopes] },
      });
      expect(parsedConsoleErrorEntries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'ERROR',
            message: 'PH-OS lambda request completed',
            result: 'ERROR',
            status_code: 403,
            tenant_id: 'tenant_abc123',
            user_id: 'user_1',
            route_key: route.route_key,
            error_code: 'FORBIDDEN',
          }),
        ]),
      );
      clearConsoleSpies();
    }
  });

  it('returns canonical 403 responses for manifest routes when the caller role is not allowed', async () => {
    for (const route of PHOS_API_ROUTES) {
      const disallowedRole = disallowedRoleFor(route);
      if (!disallowedRole) continue;

      const handler = await importRouteHandler(route);
      const response = await handler(
        withJwtClaims(apiGatewayEventFor(route), {
          role: disallowedRole,
        }),
      );

      expect(response.statusCode).toBe(403);
      expect(parseBody(response)).toMatchObject({
        request_id: `req_${route.route_key.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        error_code: 'FORBIDDEN',
        message_key: 'api.error.forbidden',
        details: {
          role: disallowedRole,
          allowed_roles: [...route.allowed_roles],
        },
      });
      expect(parsedConsoleErrorEntries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'ERROR',
            message: 'PH-OS lambda request completed',
            result: 'ERROR',
            status_code: 403,
            tenant_id: 'tenant_abc123',
            user_id: 'user_1',
            route_key: route.route_key,
            error_code: 'FORBIDDEN',
          }),
        ]),
      );
      clearConsoleSpies();
    }
  });
});
