import { expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  notificationFindManyMock,
  acquireSseConnectionMock,
  releaseSseConnectionMock,
  subscribeToChannelMock,
  unsubscribeFromChannelMock,
  getRealtimeAdapterMock,
  canAccessCollaborationEntityMock,
  loggerWarnMock,
  loggerInfoMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  acquireSseConnectionMock: vi.fn(),
  releaseSseConnectionMock: vi.fn(),
  subscribeToChannelMock: vi.fn(),
  unsubscribeFromChannelMock: vi.fn(),
  getRealtimeAdapterMock: vi.fn(),
  canAccessCollaborationEntityMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerInfoMock: vi.fn(),
}));

export const notificationStreamTestMocks = {
  acquireSseConnectionMock,
  canAccessCollaborationEntityMock,
  getRealtimeAdapterMock,
  loggerInfoMock,
  loggerWarnMock,
  notificationFindManyMock,
  releaseSseConnectionMock,
  requireAuthContextMock,
  subscribeToChannelMock,
  unsubscribeFromChannelMock,
  withOrgContextMock,
};

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: vi.fn(),
  },
}));

vi.mock('@/lib/auth/context', async () => {
  const { withSensitiveNoStore } = await import('@/lib/api/sensitive-response');
  return {
    requireAuthContext: requireAuthContextMock,
    withAuthContext:
      (handler: (...args: unknown[]) => Promise<Response>, options?: unknown) =>
      async (req: unknown, routeContext?: unknown) => {
        const authResult = await requireAuthContextMock(req, options);
        if ('response' in authResult) return withSensitiveNoStore(authResult.response);
        return withSensitiveNoStore(await handler(req, authResult.ctx, routeContext));
      },
  };
});

vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));

vi.mock('@/lib/api/rate-limit', () => ({
  acquireSseConnection: acquireSseConnectionMock,
  releaseSseConnection: releaseSseConnectionMock,
}));

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: getRealtimeAdapterMock,
}));

vi.mock('@/server/services/collaboration-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/collaboration-access')>();
  return {
    ...actual,
    canAccessCollaborationEntity: canAccessCollaborationEntityMock,
  };
});

import { GET } from './route';

export function streamRequest(
  signal: AbortSignal,
  url = 'http://localhost/api/notifications/stream',
) {
  return new NextRequest(url, { signal });
}

export function invokeGET(request: NextRequest) {
  return GET(request, { params: Promise.resolve({}) });
}

export async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

export async function openStreamForTest() {
  return openStreamForTestWithUrl('http://localhost/api/notifications/stream');
}

export async function openStreamForTestWithUrl(url: string) {
  const controller = new AbortController();
  const response = (await invokeGET(streamRequest(controller.signal, url)))!;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('reader is required');
  const keepalive = await reader.read();
  expect(new TextDecoder().decode(keepalive.value)).toBe(': keepalive\n\n');
  await flushAsyncWork();
  await expect(readSseEvent(reader, 'realtime_readiness')).resolves.toEqual({
    version: 1,
    org: true,
    user: true,
    presence: true,
  });
  return { controller, reader };
}

export async function readSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedEvent: string,
) {
  const chunk = await reader.read();
  const text = new TextDecoder().decode(chunk.value);
  const lines = text.trimEnd().split('\n');
  expect(lines[0]).toBe(`event: ${expectedEvent}`);
  const dataLine = lines.find((line) => line.startsWith('data: '));
  if (!dataLine) throw new Error(`missing SSE data: ${text}`);
  return JSON.parse(dataLine.slice(6));
}

export async function readSseData(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const chunk = await reader.read();
  const text = new TextDecoder().decode(chunk.value);
  if (!text.startsWith('data: ')) throw new Error(`unexpected SSE chunk: ${text}`);
  return JSON.parse(text.slice(6));
}
