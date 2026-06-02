import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
const DEFAULT_DATABASE_POOL_SIZE = 20;
const MAX_DATABASE_POOL_SIZE = 100;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize Prisma Client');
}

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

const poolMax = resolveDatabasePoolSize(process.env.DATABASE_POOL_SIZE);

const adapter = new PrismaPg({ connectionString, max: poolMax });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
