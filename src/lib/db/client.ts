import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { bootstrapSecretsIntoEnv } from '@/lib/config/secrets';

// HIGH BLAST RADIUS — DB bootstrap. SAFETY (guardrail 2): process.env.DATABASE_URL
// stays the synchronous source of truth. Prisma construction below is unchanged
// when Secrets Manager is not configured (local dev / tests). When it IS
// configured, this fire-and-forget bootstrap hydrates process.env.DATABASE_URL
// (only if the environment did not already provide it) BEFORE the lazy
// getPrismaClient() runs on the first query. It never overwrites an existing
// env value and never throws, so it cannot break import or local dev.
//
// We intentionally do NOT await Secrets Manager inside createPrismaClient():
// the client is built synchronously behind a Proxy and an async module-init
// could throw on import. See followups for the residual cold-start race window.
void bootstrapSecretsIntoEnv();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const DEFAULT_DATABASE_POOL_SIZE = 20;
const MAX_DATABASE_POOL_SIZE = 100;
let prismaClient = globalForPrisma.prisma;

// Pool size: pg default is 10. Workflow dashboard fires 25+ parallel queries,
// so we raise to 20 to reduce connection queuing under concurrent load.
// RDS default max_connections ≈ 80-400 depending on instance class.
function resolveDatabasePoolSize(value: string | undefined) {
  const parsed = Number(value ?? DEFAULT_DATABASE_POOL_SIZE);
  if (!Number.isFinite(parsed)) return DEFAULT_DATABASE_POOL_SIZE;

  const normalized = Math.trunc(parsed);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    return DEFAULT_DATABASE_POOL_SIZE;
  }

  return Math.min(normalized, MAX_DATABASE_POOL_SIZE);
}

function getDatabaseConnectionString() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to initialize Prisma Client');
  }
  return connectionString;
}

function createPrismaClient() {
  const connectionString = getDatabaseConnectionString();
  const poolMax = resolveDatabasePoolSize(process.env.DATABASE_POOL_SIZE);
  const adapter = new PrismaPg({ connectionString, max: poolMax });
  return new PrismaClient({ adapter });
}

export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    prismaClient = createPrismaClient();
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prismaClient;
  }
  return prismaClient;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
  set(_target, property, value, receiver) {
    return Reflect.set(getPrismaClient(), property, value, receiver);
  },
  has(_target, property) {
    return property in getPrismaClient();
  },
  ownKeys() {
    return Reflect.ownKeys(getPrismaClient());
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Reflect.getOwnPropertyDescriptor(getPrismaClient(), property);
    if (!descriptor) return undefined;
    return { ...descriptor, configurable: true };
  },
});
