import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const { websocketProviderMock } = vi.hoisted(() => ({
  websocketProviderMock: vi.fn(),
}));

vi.mock('y-websocket', () => ({
  WebsocketProvider: websocketProviderMock,
}));

import { createYjsProvider, isYjsProviderConfigured } from './yjs-provider';

describe('createYjsProvider', () => {
  const originalWsUrl = process.env.NEXT_PUBLIC_YJS_WEBSOCKET_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_YJS_WEBSOCKET_URL', 'wss://example.test/yjs');
    websocketProviderMock.mockImplementation(function MockWebsocketProvider(
      this: Record<string, unknown>,
      url,
      room,
      doc,
      options,
    ) {
      this.url = url;
      this.room = room;
      this.doc = doc;
      this.options = options;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalWsUrl === undefined) delete process.env.NEXT_PUBLIC_YJS_WEBSOCKET_URL;
    else process.env.NEXT_PUBLIC_YJS_WEBSOCKET_URL = originalWsUrl;
  });

  it('passes only server-issued room and token to the websocket provider', () => {
    const doc = new Y.Doc();

    const provider = createYjsProvider('org_1:dispense_task:dt_1', doc, {
      token: 'room-token',
    });

    expect(provider).toMatchObject({
      url: 'wss://example.test/yjs',
      room: 'org_1:dispense_task:dt_1',
      options: { params: { token: 'room-token' } },
    });
    expect(websocketProviderMock).toHaveBeenCalledWith(
      'wss://example.test/yjs',
      'org_1:dispense_task:dt_1',
      doc,
      { params: { token: 'room-token' } },
    );
  });

  it('does not create a provider without a room token', () => {
    const doc = new Y.Doc();

    const provider = createYjsProvider('org_1:dispense_task:dt_1', doc, {
      token: '',
    });

    expect(provider).toBeNull();
    expect(websocketProviderMock).not.toHaveBeenCalled();
  });

  it('rejects plaintext non-local websocket URLs in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_YJS_WEBSOCKET_URL', 'ws://example.test/yjs');
    const doc = new Y.Doc();

    const provider = createYjsProvider('org_1:dispense_task:dt_1', doc, {
      token: 'room-token',
    });

    expect(provider).toBeNull();
    expect(websocketProviderMock).not.toHaveBeenCalled();
    expect(isYjsProviderConfigured()).toBe(false);
  });

  it('allows secure websocket URLs in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_YJS_WEBSOCKET_URL', 'wss://example.test/yjs');
    const doc = new Y.Doc();

    const provider = createYjsProvider('org_1:dispense_task:dt_1', doc, {
      token: 'room-token',
    });

    expect(provider).toMatchObject({
      url: 'wss://example.test/yjs',
      room: 'org_1:dispense_task:dt_1',
    });
    expect(isYjsProviderConfigured()).toBe(true);
  });

  it('allows localhost plaintext websocket URLs outside production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_YJS_WEBSOCKET_URL', 'ws://localhost:1234');
    const doc = new Y.Doc();

    const provider = createYjsProvider('org_1:dispense_task:dt_1', doc, {
      token: 'room-token',
    });

    expect(provider).toMatchObject({
      url: 'ws://localhost:1234',
      room: 'org_1:dispense_task:dt_1',
    });
    expect(isYjsProviderConfigured()).toBe(true);
  });

  it('reports disabled config when the websocket URL is missing or malformed', () => {
    vi.stubEnv('NEXT_PUBLIC_YJS_WEBSOCKET_URL', '');
    expect(isYjsProviderConfigured()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_YJS_WEBSOCKET_URL', 'not-a-url');
    expect(isYjsProviderConfigured()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_YJS_WEBSOCKET_URL', 'https://example.test/yjs');
    expect(isYjsProviderConfigured()).toBe(false);
  });
});
