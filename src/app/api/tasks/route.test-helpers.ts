import { NextRequest } from 'next/server';
import { expect, type Mock } from 'vitest';
import { GET as routeGET, POST as routePOST } from './route';

export function GET(req: NextRequest) {
  return routeGET(req, { params: Promise.resolve({}) });
}

export function POST(req: NextRequest) {
  return routePOST(req, { params: Promise.resolve({}) });
}

export function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
}

export function createMalformedJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
}

export function createTaskAuthContext(role: string) {
  return {
    ctx: {
      orgId: 'org_1',
      userId: 'user_1',
      role,
      requestId: 'request_1',
      correlationId: 'correlation_1',
    },
  };
}

export function buildDefaultCreatedTask() {
  return {
    id: 'task_1',
    display_id: 't0000000001',
    title: '折返し対応',
  };
}

export function installTaskCreateTransactionMock(withOrgContextMock: Mock, taskCreateMock: Mock) {
  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({ task: { create: taskCreateMock } }),
  );
}

export function expectTaskWriteNotStarted(
  withOrgContextMock: Mock,
  allocateDisplayIdMock: Mock,
  taskCreateMock: Mock,
) {
  expect(withOrgContextMock).not.toHaveBeenCalled();
  expect(allocateDisplayIdMock).not.toHaveBeenCalled();
  expect(taskCreateMock).not.toHaveBeenCalled();
}
