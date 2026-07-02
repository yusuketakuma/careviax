import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => {
  type Deferred = {
    promise: Promise<number>;
    resolve: (value: number) => void;
    reject: (error: unknown) => void;
  };

  const unsubscribeDeferreds: Deferred[] = [];
  const subscribeResults: Array<Promise<number>> = [];

  class RedisMock {
    on = vi.fn();
    publish = vi.fn(async () => 1);
    subscribe = vi.fn(() => subscribeResults.shift() ?? Promise.resolve(1));
    unsubscribe = vi.fn(() => {
      const deferred = unsubscribeDeferreds.shift();
      return deferred ? deferred.promise : Promise.resolve(1);
    });

    constructor() {
      instances.push(this);
    }
  }

  const instances: RedisMock[] = [];

  return {
    RedisMock,
    instances,
    unsubscribeDeferreds,
    subscribeResults,
    deferUnsubscribe() {
      let resolve: Deferred['resolve'] = () => undefined;
      let reject: Deferred['reject'] = () => undefined;
      const promise = new Promise<number>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      const deferred = { promise, resolve, reject };
      unsubscribeDeferreds.push(deferred);
      return deferred;
    },
    rejectNextSubscribe(error: Error) {
      subscribeResults.push(Promise.reject(error));
    },
  };
});

vi.mock('ioredis', () => ({
  default: redisMock.RedisMock,
}));

beforeEach(() => {
  vi.resetModules();
  process.env.REDIS_URL = 'redis://localhost:6379';
  redisMock.instances.length = 0;
  redisMock.unsubscribeDeferreds.length = 0;
  redisMock.subscribeResults.length = 0;
});

afterEach(() => {
  delete process.env.REDIS_URL;
  vi.clearAllMocks();
});

describe('redis realtime adapter message parsing', () => {
  it('parses object messages', async () => {
    const { parseRedisRealtimeMessage } = await import('./redis-adapter');

    expect(parseRedisRealtimeMessage('{"type":"presence_update","entity_id":"vr_1"}')).toEqual({
      type: 'presence_update',
      entity_id: 'vr_1',
    });
  });

  it('rejects malformed JSON and non-object roots', async () => {
    const { parseRedisRealtimeMessage } = await import('./redis-adapter');

    expect(parseRedisRealtimeMessage('not-json')).toBeNull();
    expect(parseRedisRealtimeMessage('[]')).toBeNull();
    expect(parseRedisRealtimeMessage('null')).toBeNull();
    expect(parseRedisRealtimeMessage('"presence_update"')).toBeNull();
    expect(parseRedisRealtimeMessage('false')).toBeNull();
    expect(parseRedisRealtimeMessage('123')).toBeNull();
  });
});

describe('redis realtime adapter subscriptions', () => {
  it('resubscribes when a new listener is added while Redis unsubscribe is pending', async () => {
    const { RealtimeAdapter } = await import('./redis-adapter');
    const adapter = new RealtimeAdapter();
    const channel = 'org_1:presence';
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    await adapter.subscribeToChannel(channel, firstListener);
    const subscriber = redisMock.instances[1];
    expect(subscriber).toBeDefined();
    expect(subscriber?.subscribe).toHaveBeenCalledTimes(1);

    const unsubscribe = redisMock.deferUnsubscribe();
    adapter.unsubscribeFromChannel(channel, firstListener);
    expect(subscriber?.unsubscribe).toHaveBeenCalledWith(channel);

    const subscribeDuringUnsubscribe = adapter.subscribeToChannel(channel, secondListener);
    await Promise.resolve();
    expect(subscriber?.subscribe).toHaveBeenCalledTimes(1);

    unsubscribe.resolve(1);
    await subscribeDuringUnsubscribe;

    expect(subscriber?.subscribe).toHaveBeenCalledTimes(2);
    expect(subscriber?.subscribe).toHaveBeenLastCalledWith(channel);
  });

  it('clears local subscription state when Redis subscribe fails', async () => {
    const { RealtimeAdapter } = await import('./redis-adapter');
    const adapter = new RealtimeAdapter();
    const channel = 'org_1:presence';
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    redisMock.rejectNextSubscribe(new Error('redis subscribe down'));
    await expect(adapter.subscribeToChannel(channel, firstListener)).rejects.toThrow(
      'redis subscribe down',
    );

    const subscriber = redisMock.instances[1];
    await adapter.subscribeToChannel(channel, secondListener);

    expect(subscriber?.subscribe).toHaveBeenCalledTimes(2);
    expect(subscriber?.subscribe).toHaveBeenLastCalledWith(channel);
  });
});
