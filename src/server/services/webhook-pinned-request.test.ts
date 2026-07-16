import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('node:https', () => ({ request: requestMock }));

import { isPinnedWebhookPeer, sendPinnedWebhookRequest } from './webhook-pinned-request';

class FakeRequest extends EventEmitter {
  end = vi.fn();
}

class FakeSocket extends EventEmitter {
  remoteAddress: string | undefined;
  destroy = vi.fn();
}

describe('webhook-pinned-request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pins lookup while preserving the original hostname for TLS SNI and Host handling', async () => {
    const req = new FakeRequest();
    const socket = new FakeSocket();
    socket.remoteAddress = '8.8.8.8';
    requestMock.mockReturnValue(req);

    const responsePromise = sendPinnedWebhookRequest('https://hooks.example.com/events', {
      addresses: [{ address: '8.8.8.8', family: 4 }],
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: new AbortController().signal,
    });

    const [target, options, onResponse] = requestMock.mock.calls[0]!;
    expect(target).toEqual(new URL('https://hooks.example.com/events'));
    expect(options).toMatchObject({
      method: 'POST',
      agent: false,
      servername: 'hooks.example.com',
    });
    const lookupCallback = vi.fn();
    options.lookup('hooks.example.com', {}, lookupCallback);
    expect(lookupCallback).toHaveBeenCalledWith(null, '8.8.8.8', 4);

    req.emit('socket', socket);
    socket.emit('secureConnect');
    const response = { statusCode: 202, resume: vi.fn() };
    onResponse(response);

    await expect(responsePromise).resolves.toEqual({ status: 202, ok: true });
    expect(response.resume).toHaveBeenCalledOnce();
    expect(req.end).toHaveBeenCalledWith('{}');
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it('rejects a connected peer that differs from the pinned address', async () => {
    const req = new FakeRequest();
    const socket = new FakeSocket();
    socket.remoteAddress = '10.0.0.8';
    requestMock.mockReturnValue(req);

    const responsePromise = sendPinnedWebhookRequest('https://hooks.example.com/events', {
      addresses: [{ address: '8.8.8.8', family: 4 }],
      method: 'POST',
      redirect: 'manual',
      headers: {},
      body: '{}',
      signal: new AbortController().signal,
    });

    req.emit('socket', socket);
    socket.emit('secureConnect');

    await expect(responsePromise).rejects.toMatchObject({ name: 'WebhookPeerMismatchError' });
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('normalizes IPv4-mapped IPv6 peer addresses only for exact pinned equality', () => {
    expect(isPinnedWebhookPeer('::ffff:8.8.8.8', '8.8.8.8')).toBe(true);
    expect(isPinnedWebhookPeer('::ffff:127.0.0.1', '8.8.8.8')).toBe(false);
    expect(isPinnedWebhookPeer(undefined, '8.8.8.8')).toBe(false);
  });
});
