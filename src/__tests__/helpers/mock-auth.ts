import { vi } from 'vitest';
import type { NextRequest } from 'next/server';

type MockAuthenticatedRequest = NextRequest & {
  orgId: string;
  userId: string;
  role?: string;
};

type MockAuthHandler = (req: MockAuthenticatedRequest) => Promise<Response>;

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

export function callWithAuth(
  handlerMock: ReturnType<typeof vi.fn<MockAuthHandler>>,
  url: string,
  opts?: { method?: string; body?: unknown; orgId?: string; userId?: string; role?: string; headers?: Record<string, string> }
): Promise<Response> {
  const { method = 'GET', body, orgId = 'org_test', userId = 'user_test', role = 'pharmacist', headers = {} } = opts ?? {};
  const reqInit: RequestInit = { method, headers: { 'x-org-id': orgId, ...headers } };
  if (body) reqInit.body = JSON.stringify(body);
  const req = new Request(`http://localhost${url}`, reqInit) as MockAuthenticatedRequest;
  Object.assign(req, { orgId, userId, role });
  return handlerMock(req);
}
