import { RealtimeAdapter as InMemoryAdapter } from './in-memory-adapter';

export { RealtimeAdapter } from './in-memory-adapter';

let cached: InstanceType<typeof InMemoryAdapter> | null = null;

export function getRealtimeAdapter(): InstanceType<typeof InMemoryAdapter> {
  if (cached) return cached;

  if (process.env.REDIS_URL) {
    // Dynamic import avoided — redis-adapter uses the same class shape.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RealtimeAdapter: RedisAdapter } = require('./redis-adapter') as {
      RealtimeAdapter: typeof InMemoryAdapter;
    };
    cached = new RedisAdapter();
  } else {
    cached = new InMemoryAdapter();
  }
  return cached;
}
