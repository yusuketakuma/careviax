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
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function flushRedisUnsubscribeWork() {
  await Promise.resolve();
  await Promise.resolve();
}

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

  it('logs Redis unsubscribe failures without leaking raw error messages', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { RealtimeAdapter } = await import('./redis-adapter');
    const adapter = new RealtimeAdapter();
    const channel = 'org_1:presence';
    const listener = vi.fn();

    await adapter.subscribeToChannel(channel, listener);
    const subscriber = redisMock.instances[1];
    const unsubscribe = redisMock.deferUnsubscribe();
    adapter.unsubscribeFromChannel(channel, listener);

    unsubscribe.reject(new Error('patient=田中太郎 realtime secret'));
    await expect(unsubscribe.promise).rejects.toThrow('patient=田中太郎 realtime secret');
    await flushRedisUnsubscribeWork();

    expect(subscriber?.unsubscribe).toHaveBeenCalledWith(channel);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'warn',
      message: 'realtime.unsubscribe_failed',
      event: 'realtime.unsubscribe_failed',
      operation: 'unsubscribe',
      entityType: 'realtime_channel',
      entityId: channel,
      code: 'UNSUBSCRIBE_FAILED',
      error_name: 'Error',
    });
    expect(JSON.stringify(entry)).not.toContain('田中太郎');
    expect(JSON.stringify(entry)).not.toContain('realtime secret');
    expect(entry).not.toHaveProperty('error');
    expect(entry).not.toHaveProperty('error_message');
    expect(entry).not.toHaveProperty('stack');
  });

  it('logs resubscribe race failures safely and allows the waiting subscriber to recover', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { RealtimeAdapter } = await import('./redis-adapter');
    const adapter = new RealtimeAdapter();
    const channel = 'org_1:presence';
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    await adapter.subscribeToChannel(channel, firstListener);
    const subscriber = redisMock.instances[1];
    const unsubscribe = redisMock.deferUnsubscribe();
    adapter.unsubscribeFromChannel(channel, firstListener);

    const resubscribeError = new Error('patient=青葉花子 resubscribe secret');
    redisMock.rejectNextSubscribe(resubscribeError);
    const subscribeDuringUnsubscribe = adapter.subscribeToChannel(channel, secondListener);
    unsubscribe.resolve(1);

    await subscribeDuringUnsubscribe;

    expect(subscriber?.subscribe).toHaveBeenCalledTimes(3);
    expect(subscriber?.subscribe).toHaveBeenLastCalledWith(channel);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'warn',
      message: 'realtime.resubscribe_race_failed',
      event: 'realtime.resubscribe_race_failed',
      operation: 'resubscribe_after_unsubscribe_race',
      entityType: 'realtime_channel',
      entityId: channel,
      code: 'RESUBSCRIBE_RACE_FAILED',
      error_name: 'Error',
    });
    expect(JSON.stringify(entry)).not.toContain('青葉花子');
    expect(JSON.stringify(entry)).not.toContain('resubscribe secret');
    expect(entry).not.toHaveProperty('error');
    expect(entry).not.toHaveProperty('error_message');
    expect(entry).not.toHaveProperty('stack');
  });
});
