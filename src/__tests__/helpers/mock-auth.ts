import { vi } from 'vitest';
import type { NextRequest } from 'next/server';

type MockAuthenticatedRequest = NextRequest & {
  orgId: string;
  userId: string;
  role?: string;
};

type MockAuthHandler = (req: MockAuthenticatedRequest) => Promise<Response>;

type MockAuthContext = {
  userId: string;
  orgId: string;
  role: string;
  ipAddress?: string;
  userAgent?: string;
};

type MockAuthRouteContext<TParams extends Record<string, string>> = {
  params: Promise<TParams>;
};

type MockAuthContextHandler<TParams extends Record<string, string> = Record<string, string>> = (
  req: NextRequest,
  ctx: MockAuthContext,
  routeContext: MockAuthRouteContext<TParams>,
) => Promise<Response>;

export function createAuthMock() {
  const handlerMock = vi.fn<MockAuthHandler>();
  return {
    handlerMock,
    withAuthFactory: () => ({
      withAuth: (handler: MockAuthHandler) => {
        handlerMock.mockImplementation(handler);
        return handler;
      },
    }),
  };
}

export function createAuthContextMock<
  TParams extends Record<string, string> = Record<string, string>,
>() {
  const handlerMock = vi.fn<MockAuthContextHandler<TParams>>();
  return {
    handlerMock,
    withAuthContextFactory: () => ({
      withAuthContext: (handler: MockAuthContextHandler<TParams>) => {
        handlerMock.mockImplementation(handler);
        return handler;
      },
    }),
  };
}

export function callWithAuth(
  handlerMock: ReturnType<typeof vi.fn<MockAuthHandler>>,
  url: string,
  opts?: {
    method?: string;
    body?: unknown;
    orgId?: string;
    userId?: string;
    role?: string;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const {
    method = 'GET',
    body,
    orgId = 'org_test',
    userId = 'user_test',
    role = 'pharmacist',
    headers = {},
  } = opts ?? {};
  const reqInit: RequestInit = { method, headers: { 'x-org-id': orgId, ...headers } };
  if (body) reqInit.body = JSON.stringify(body);
  const req = new Request(`http://localhost${url}`, reqInit) as MockAuthenticatedRequest;
  Object.assign(req, { orgId, userId, role });
  return handlerMock(req);
}

export function callWithAuthContext<
  TParams extends Record<string, string> = Record<string, string>,
>(
  handlerMock: ReturnType<typeof vi.fn<MockAuthContextHandler<TParams>>>,
  url: string,
  opts?: {
    method?: string;
    body?: unknown;
    orgId?: string;
    userId?: string;
    role?: string;
    headers?: Record<string, string>;
    params?: TParams;
  },
): Promise<Response> {
  const {
    method = 'GET',
    body,
    orgId = 'org_test',
    userId = 'user_test',
    role = 'pharmacist',
    headers = {},
    params = {} as TParams,
  } = opts ?? {};
  const reqInit: RequestInit = { method, headers: { 'x-org-id': orgId, ...headers } };
  if (body) reqInit.body = JSON.stringify(body);
  const req = new Request(`http://localhost${url}`, reqInit) as NextRequest;

  return handlerMock(
    req,
    { orgId, userId, role },
    {
      params: Promise.resolve(params),
    },
  );
}
