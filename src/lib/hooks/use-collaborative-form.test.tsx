// @vitest-environment jsdom

import React, { type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';

const { createYjsProviderMock, isYjsProviderConfiguredMock, useOrgIdMock, useRealtimeEventsMock } =
  vi.hoisted(() => ({
    createYjsProviderMock: vi.fn(),
    isYjsProviderConfiguredMock: vi.fn(),
    useOrgIdMock: vi.fn(),
    useRealtimeEventsMock: vi.fn(),
  }));

vi.mock('@/lib/collaboration/yjs-provider', () => ({
  createYjsProvider: createYjsProviderMock,
  isYjsProviderConfigured: isYjsProviderConfiguredMock,
}));

vi.mock('./use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('./use-realtime-events', () => ({
  useRealtimeEvents: useRealtimeEventsMock,
}));

import { useCollaborativeForm } from './use-collaborative-form';

type TestForm = {
  note: string;
};

function createMockProvider() {
  const handlers = new Map<string, Array<(event?: unknown) => void>>();

  return {
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    }),
    emitStatus: (status: string) => {
      for (const handler of handlers.get('status') ?? []) {
        handler({ status });
      }
    },
    emitConnectionError: () => {
      for (const handler of handlers.get('connection-error') ?? []) {
        handler();
      }
    },
    awareness: { setLocalStateField: vi.fn() },
    disconnect: vi.fn(),
    destroy: vi.fn(),
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function useTestCollaborativeForm() {
  const form = useForm<TestForm>({
    defaultValues: { note: '' },
  });
  return useCollaborativeForm({
    form,
    entityType: 'dispense_task',
    entityId: 'dt_1',
  });
}

function useTestCollaborativeFormWithForm(options?: { textFields?: string[] }) {
  const form = useForm<TestForm>({
    defaultValues: { note: '' },
  });
  const collaboration = useCollaborativeForm({
    form,
    entityType: 'dispense_task',
    entityId: 'dt_1',
    textFields: options?.textFields,
  });
  return { form, collaboration };
}

function futureExpiresAt(offsetMs = 30 * 60 * 1000) {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe('useCollaborativeForm', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeEventsMock.mockReturnValue(undefined);
    isYjsProviderConfiguredMock.mockReturnValue(true);
    createYjsProviderMock.mockReturnValue(createMockProvider());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates the Yjs provider only after fetching an authorized room token', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: 'room-token',
            expires_at: futureExpiresAt(),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(createYjsProviderMock).toHaveBeenCalledWith(
        'org_1:dispense_task:dt_1',
        expect.anything(),
        { token: 'room-token' },
      );
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/collaboration/room-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
      body: JSON.stringify({
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
      }),
    });
  });

  it('ignores malformed presence payloads before exposing active collaborators', async () => {
    isYjsProviderConfiguredMock.mockReturnValue(false);
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/presence?')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                user_id: ' user_1 ',
                display_name: ' 田中 ',
                active_field: 'note',
                updated_at: ' 2026-05-31T00:00:00.000Z ',
              },
              {
                user_id: 123,
                display_name: 'broken',
                active_field: null,
                updated_at: '2026-05-31T00:00:00.000Z',
              },
              {
                user_id: 'user_2',
                display_name: '佐藤',
                active_field: { field: 'note' },
                updated_at: '2026-05-31T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.presenceData).toEqual([
        {
          user_id: 'user_1',
          display_name: '田中',
          active_field: 'note',
          updated_at: '2026-05-31T00:00:00.000Z',
        },
      ]);
    });
    expect(createYjsProviderMock).not.toHaveBeenCalled();
  });

  it('does not create a Yjs provider when room token authorization fails', async () => {
    vi.useFakeTimers();
    let tokenRequestCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        return new Response(null, { status: 404 });
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/collaboration/room-token', expect.any(Object));
    expect(createYjsProviderMock).not.toHaveBeenCalled();
    expect(result.current.yDoc).toBeNull();
    expect(result.current.awareness).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    result.current.registerCollaborative('note').onFocus();

    const presencePostCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([input, init]) => String(input) === '/api/presence' && init?.method === 'POST',
    );
    expect(tokenRequestCount).toBe(1);
    expect(presencePostCalls).toHaveLength(0);
  });

  it('refreshes the Yjs provider before the room token expires without recreating the document', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));

    const firstProvider = createMockProvider();
    const secondProvider = createMockProvider();
    createYjsProviderMock.mockReturnValueOnce(firstProvider).mockReturnValueOnce(secondProvider);
    let tokenRequestCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: tokenRequestCount === 1 ? 'room-token-1' : 'room-token-2',
            expires_at:
              tokenRequestCount === 1
                ? futureExpiresAt(2 * 60 * 1000)
                : futureExpiresAt(7 * 60 * 1000),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(createYjsProviderMock).toHaveBeenCalledTimes(1);
    const firstDoc = createYjsProviderMock.mock.calls[0]?.[1];

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(createYjsProviderMock).toHaveBeenCalledTimes(2);
    expect(createYjsProviderMock).toHaveBeenNthCalledWith(2, 'org_1:dispense_task:dt_1', firstDoc, {
      token: 'room-token-2',
    });
    expect(firstProvider.disconnect).not.toHaveBeenCalled();
    expect(firstProvider.destroy).not.toHaveBeenCalled();

    act(() => {
      secondProvider.emitStatus('connected');
    });

    expect(firstProvider.disconnect).toHaveBeenCalledTimes(1);
    expect(firstProvider.destroy).toHaveBeenCalledTimes(1);
    expect(secondProvider.awareness.setLocalStateField).toHaveBeenCalledWith('user', {
      userId: 'org_1',
      displayName: 'org_1',
    });
  });

  it('keeps the current provider when a renewal candidate disconnects before connecting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const firstProvider = createMockProvider();
    const secondProvider = createMockProvider();
    const thirdProvider = createMockProvider();
    createYjsProviderMock
      .mockReturnValueOnce(firstProvider)
      .mockReturnValueOnce(secondProvider)
      .mockReturnValueOnce(thirdProvider);
    let tokenRequestCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: `room-token-${tokenRequestCount}`,
            expires_at: futureExpiresAt(2 * 60 * 1000),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    act(() => {
      firstProvider.emitStatus('connected');
    });
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(createYjsProviderMock).toHaveBeenCalledTimes(2);
    expect(firstProvider.disconnect).not.toHaveBeenCalled();
    expect(firstProvider.destroy).not.toHaveBeenCalled();

    act(() => {
      secondProvider.emitStatus('disconnected');
    });

    expect(secondProvider.disconnect).toHaveBeenCalledTimes(1);
    expect(secondProvider.destroy).toHaveBeenCalledTimes(1);
    expect(firstProvider.disconnect).not.toHaveBeenCalled();
    expect(firstProvider.destroy).not.toHaveBeenCalled();
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(3);
    expect(createYjsProviderMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the current provider and retries when a renewal candidate never connects', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const firstProvider = createMockProvider();
    const secondProvider = createMockProvider();
    const thirdProvider = createMockProvider();
    createYjsProviderMock
      .mockReturnValueOnce(firstProvider)
      .mockReturnValueOnce(secondProvider)
      .mockReturnValueOnce(thirdProvider);
    let tokenRequestCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: `room-token-${tokenRequestCount}`,
            expires_at: futureExpiresAt(2 * 60 * 1000),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    act(() => {
      firstProvider.emitStatus('connected');
    });
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(createYjsProviderMock).toHaveBeenCalledTimes(2);
    expect(firstProvider.disconnect).not.toHaveBeenCalled();
    expect(secondProvider.disconnect).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
      await Promise.resolve();
    });

    expect(secondProvider.disconnect).not.toHaveBeenCalled();
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(secondProvider.disconnect).toHaveBeenCalledTimes(1);
    expect(secondProvider.destroy).toHaveBeenCalledTimes(1);
    expect(firstProvider.disconnect).not.toHaveBeenCalled();
    expect(firstProvider.destroy).not.toHaveBeenCalled();
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(3);
    expect(createYjsProviderMock).toHaveBeenCalledTimes(3);
  });

  it('destroys a pending renewal candidate when the hook unmounts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));

    const firstProvider = createMockProvider();
    const secondProvider = createMockProvider();
    createYjsProviderMock.mockReturnValueOnce(firstProvider).mockReturnValueOnce(secondProvider);
    let tokenRequestCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: `room-token-${tokenRequestCount}`,
            expires_at: futureExpiresAt(2 * 60 * 1000),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { unmount } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    act(() => {
      firstProvider.emitStatus('connected');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(createYjsProviderMock).toHaveBeenCalledTimes(2);

    unmount();

    expect(secondProvider.disconnect).toHaveBeenCalledTimes(1);
    expect(secondProvider.destroy).toHaveBeenCalledTimes(1);
    expect(firstProvider.disconnect).toHaveBeenCalledTimes(1);
    expect(firstProvider.destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the current provider and retries when a renewal candidate has a connection error', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const firstProvider = createMockProvider();
    const secondProvider = createMockProvider();
    const thirdProvider = createMockProvider();
    createYjsProviderMock
      .mockReturnValueOnce(firstProvider)
      .mockReturnValueOnce(secondProvider)
      .mockReturnValueOnce(thirdProvider);
    let tokenRequestCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: `room-token-${tokenRequestCount}`,
            expires_at: futureExpiresAt(2 * 60 * 1000),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    act(() => {
      firstProvider.emitStatus('connected');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    act(() => {
      secondProvider.emitConnectionError();
    });

    expect(secondProvider.disconnect).toHaveBeenCalledTimes(1);
    expect(secondProvider.destroy).toHaveBeenCalledTimes(1);
    expect(firstProvider.disconnect).not.toHaveBeenCalled();
    expect(firstProvider.destroy).not.toHaveBeenCalled();
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(3);
    expect(createYjsProviderMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the current provider and retries when renewal candidate activation fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const firstProvider = createMockProvider();
    const secondProvider = createMockProvider();
    const thirdProvider = createMockProvider();
    secondProvider.awareness.setLocalStateField.mockImplementation(() => {
      throw new Error('awareness unavailable');
    });
    createYjsProviderMock
      .mockReturnValueOnce(firstProvider)
      .mockReturnValueOnce(secondProvider)
      .mockReturnValueOnce(thirdProvider);
    let tokenRequestCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: `room-token-${tokenRequestCount}`,
            expires_at: futureExpiresAt(2 * 60 * 1000),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    act(() => {
      firstProvider.emitStatus('connected');
    });
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(secondProvider.disconnect).toHaveBeenCalledTimes(1);
    expect(secondProvider.destroy).toHaveBeenCalledTimes(1);
    expect(firstProvider.disconnect).not.toHaveBeenCalled();
    expect(firstProvider.destroy).not.toHaveBeenCalled();
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(3);
    expect(createYjsProviderMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the current provider when a renewal provider cannot be created', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const firstProvider = createMockProvider();
    const secondProvider = createMockProvider();
    createYjsProviderMock
      .mockReturnValueOnce(firstProvider)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(secondProvider);
    let tokenRequestCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: `room-token-${tokenRequestCount}`,
            expires_at: futureExpiresAt(2 * 60 * 1000),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    act(() => {
      firstProvider.emitStatus('connected');
    });
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(createYjsProviderMock).toHaveBeenCalledTimes(2);
    expect(firstProvider.disconnect).not.toHaveBeenCalled();
    expect(firstProvider.destroy).not.toHaveBeenCalled();
    expect(result.current.yDoc).not.toBeNull();
    expect(result.current.awareness).toBe(firstProvider.awareness);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(3);
    expect(createYjsProviderMock).toHaveBeenCalledTimes(3);
  });

  it('disconnects the current provider when renewal transient failures outlive the token expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));

    const firstProvider = createMockProvider();
    createYjsProviderMock.mockReturnValue(firstProvider);
    let tokenRequestCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        if (tokenRequestCount === 1) {
          return new Response(
            JSON.stringify({
              room: 'org_1:dispense_task:dt_1',
              token: 'room-token-1',
              expires_at: futureExpiresAt(2 * 60 * 1000),
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 503, headers: { 'Retry-After': '120' } });
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    act(() => {
      firstProvider.emitStatus('connected');
    });
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(2);
    expect(firstProvider.disconnect).not.toHaveBeenCalled();
    expect(result.current.yDoc).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(firstProvider.disconnect).toHaveBeenCalledTimes(1);
    expect(firstProvider.destroy).toHaveBeenCalledTimes(1);
    expect(result.current.connected).toBe(false);
    expect(result.current.yDoc).toBeNull();
    expect(result.current.awareness).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(2);
  });

  it('disconnects the current provider when token renewal is denied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));

    const firstProvider = createMockProvider();
    createYjsProviderMock.mockReturnValue(firstProvider);
    let tokenRequestCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        if (tokenRequestCount === 1) {
          return new Response(
            JSON.stringify({
              room: 'org_1:dispense_task:dt_1',
              token: 'room-token-1',
              expires_at: futureExpiresAt(2 * 60 * 1000),
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(createYjsProviderMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(createYjsProviderMock).toHaveBeenCalledTimes(1);
    expect(firstProvider.disconnect).toHaveBeenCalledTimes(1);
    expect(firstProvider.destroy).toHaveBeenCalledTimes(1);
    expect(result.current.yDoc).toBeNull();
    expect(result.current.awareness).toBeNull();
    expect(result.current.getTextField('note')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(2);
    expect(createYjsProviderMock).toHaveBeenCalledTimes(1);
  });

  it('treats malformed room token payloads as transient failures before provider creation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);

    let tokenRequestCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        return new Response(
          JSON.stringify({
            room: 123,
            token: 'room-token',
            expires_at: futureExpiresAt(),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(1);
    expect(createYjsProviderMock).not.toHaveBeenCalled();
    expect(result.current.yDoc).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(2);
    expect(createYjsProviderMock).not.toHaveBeenCalled();
  });

  it('does not request a room token when the Yjs provider config is disabled', async () => {
    isYjsProviderConfiguredMock.mockReturnValue(false);
    global.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/collaboration/room-token',
      expect.any(Object),
    );
    expect(createYjsProviderMock).not.toHaveBeenCalled();
    expect(result.current.yDoc).toBeNull();
    expect(result.current.awareness).toBeNull();
  });

  it('keeps collaboration disabled when a room token is issued but the provider cannot be created', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));

    createYjsProviderMock.mockReturnValue(null);
    let tokenRequestCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: 'room-token',
            expires_at: futureExpiresAt(2 * 60 * 1000),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(createYjsProviderMock).toHaveBeenCalledTimes(1);
    expect(result.current.yDoc).toBeNull();
    expect(result.current.awareness).toBeNull();
    expect(result.current.getTextField('note')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(1);
    expect(createYjsProviderMock).toHaveBeenCalledTimes(1);
  });

  it('does not create or churn providers when the room token expiry is invalid', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);

    let tokenRequestCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: 'room-token',
            expires_at: 'not-a-date',
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(createYjsProviderMock).not.toHaveBeenCalled();
    expect(result.current.yDoc).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(2);
    expect(createYjsProviderMock).not.toHaveBeenCalled();
  });

  it('honors Retry-After before retrying a transient room token throttle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));

    let tokenRequestCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        if (tokenRequestCount === 1) {
          return new Response(null, { status: 429, headers: { 'Retry-After': '12' } });
        }
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: 'room-token',
            expires_at: futureExpiresAt(),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(1);
    expect(createYjsProviderMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_999);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(2);
    expect(createYjsProviderMock).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially for repeated transient room token failures', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T15:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);

    let tokenRequestCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        tokenRequestCount += 1;
        if (tokenRequestCount <= 2) {
          return new Response(null, { status: 503 });
        }
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: 'room-token',
            expires_at: futureExpiresAt(),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    renderHook(() => useTestCollaborativeForm(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(2);
    expect(createYjsProviderMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(tokenRequestCount).toBe(3);
    expect(createYjsProviderMock).toHaveBeenCalledTimes(1);
  });

  it('seeds React Hook Form defaults into empty Y.Map fields on activation', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: 'room-token',
            expires_at: futureExpiresAt(),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(
      () => {
        const form = useForm<TestForm>({
          defaultValues: { note: 'seeded-note' },
        });
        return useCollaborativeForm({
          form,
          entityType: 'dispense_task',
          entityId: 'dt_1',
        });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.yDoc).not.toBeNull();
    });

    expect(result.current.yDoc?.getMap('form').get('note')).toBe('seeded-note');
  });

  it('does not overwrite existing remote Y.Map values when seeding defaults', async () => {
    createYjsProviderMock.mockImplementation((_room, doc) => {
      doc.getMap('form').set('note', 'remote-note');
      return createMockProvider();
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: 'room-token',
            expires_at: futureExpiresAt(),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(
      () => {
        const form = useForm<TestForm>({
          defaultValues: { note: 'local-note' },
        });
        return useCollaborativeForm({
          form,
          entityType: 'dispense_task',
          entityId: 'dt_1',
        });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.yDoc).not.toBeNull();
    });

    expect(result.current.yDoc?.getMap('form').get('note')).toBe('remote-note');
  });

  it('seeds React Hook Form defaults into empty Y.Text fields on activation', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: 'room-token',
            expires_at: futureExpiresAt(),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(
      () => {
        const form = useForm<TestForm>({
          defaultValues: { note: 'seeded text' },
        });
        return useCollaborativeForm({
          form,
          entityType: 'dispense_task',
          entityId: 'dt_1',
          textFields: ['note'],
        });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.getTextField('note')).not.toBeNull();
    });

    expect(result.current.getTextField('note')?.toString()).toBe('seeded text');
    expect(result.current.yDoc?.getMap('form').get('note')).toBeUndefined();
  });

  it('does not overwrite existing remote Y.Text values when seeding defaults', async () => {
    createYjsProviderMock.mockImplementation((_room, doc) => {
      doc.getText('note').insert(0, 'remote text');
      return createMockProvider();
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: 'room-token',
            expires_at: futureExpiresAt(),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(
      () => {
        const form = useForm<TestForm>({
          defaultValues: { note: 'local text' },
        });
        return useCollaborativeForm({
          form,
          entityType: 'dispense_task',
          entityId: 'dt_1',
          textFields: ['note'],
        });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.getTextField('note')).not.toBeNull();
    });

    expect(result.current.getTextField('note')?.toString()).toBe('remote text');
  });

  it('applies remote Y.Map updates only while a field is mounted and registered', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: 'room-token',
            expires_at: futureExpiresAt(),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(() => useTestCollaborativeFormWithForm(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.collaboration.yDoc).not.toBeNull();
    });

    act(() => {
      result.current.collaboration.yDoc?.getMap('form').set('note', 'ignored-before-mount');
    });
    expect(result.current.form.getValues('note')).toBe('');

    const registered = result.current.collaboration.registerCollaborative('note');
    const input = document.createElement('input');

    act(() => {
      registered.ref(input);
      result.current.collaboration.yDoc?.getMap('form').set('note', 'remote-value');
    });
    expect(result.current.form.getValues('note')).toBe('remote-value');
    expect(result.current.form.getFieldState('note').isDirty).toBe(false);

    act(() => {
      registered.ref(null);
      result.current.collaboration.yDoc?.getMap('form').set('note', 'ignored-after-unmount');
    });
    expect(result.current.form.getValues('note')).toBe('remote-value');
  });

  it('does not apply remote Y.Map updates to collaborative text fields', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/collaboration/room-token') {
        return new Response(
          JSON.stringify({
            room: 'org_1:dispense_task:dt_1',
            token: 'room-token',
            expires_at: futureExpiresAt(),
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/presence?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const { result } = renderHook(
      () => useTestCollaborativeFormWithForm({ textFields: ['note'] }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.collaboration.yDoc).not.toBeNull();
    });

    const registered = result.current.collaboration.registerCollaborative('note');
    const input = document.createElement('input');

    act(() => {
      registered.ref(input);
      result.current.collaboration.yDoc?.getMap('form').set('note', 'ignored-text-field');
    });

    expect(result.current.form.getValues('note')).toBe('');
    expect(result.current.collaboration.getTextField('note')).not.toBeNull();
  });
});
