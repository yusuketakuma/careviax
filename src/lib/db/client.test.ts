import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

const prismaMocks = vi.hoisted(() => ({
  PrismaPg: vi.fn(function PrismaPg(args: unknown, options?: unknown) {
    return { adapterArgs: args, adapterOptions: options };
  }),
  PrismaClient: vi.fn(function PrismaClient(args: unknown) {
    return { clientArgs: args };
  }),
}));

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: prismaMocks.PrismaPg,
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: prismaMocks.PrismaClient,
}));

type PrismaGlobal = typeof globalThis & { prisma?: unknown };

async function loadClientWithPool(poolSize: string | undefined) {
  vi.resetModules();
  prismaMocks.PrismaPg.mockClear();
  prismaMocks.PrismaClient.mockClear();
  delete (globalThis as PrismaGlobal).prisma;
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/careviax';
  if (poolSize === undefined) {
    delete process.env.DATABASE_POOL_SIZE;
  } else {
    process.env.DATABASE_POOL_SIZE = poolSize;
  }

  const { prisma } = await import('./client');
  void (prisma as unknown as { clientArgs: unknown }).clientArgs;

  const call = prismaMocks.PrismaPg.mock.calls.at(-1);
  return {
    pool: call?.[0] as Pool,
    adapterOptions: call?.[1] as { disposeExternalPool?: boolean } | undefined,
  };
}

describe('db client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    prismaMocks.PrismaPg.mockClear();
    prismaMocks.PrismaClient.mockClear();
    delete (globalThis as PrismaGlobal).prisma;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_POOL_SIZE;
  });

  it('defers DATABASE_URL validation until the Prisma Client is used', async () => {
    const { prisma } = await import('./client');

    expect(prismaMocks.PrismaPg).not.toHaveBeenCalled();
    expect(prismaMocks.PrismaClient).not.toHaveBeenCalled();
    expect(() => (prisma as unknown as { user: unknown }).user).toThrow(
      'DATABASE_URL is required to initialize Prisma Client',
    );
    expect(prismaMocks.PrismaPg).not.toHaveBeenCalled();
    expect(prismaMocks.PrismaClient).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 20],
    ['', 20],
    ['NaN', 20],
    ['Infinity', 20],
    ['0', 20],
    ['-4', 20],
    ['12.8', 12],
    ['1000', 100],
  ])('normalizes DATABASE_POOL_SIZE=%p to %p', async (value, expected) => {
    await expect(loadClientWithPool(value)).resolves.toMatchObject({
      pool: {
        options: {
          connectionString: 'postgresql://user:pass@localhost:5432/careviax',
          max: expected,
        },
      },
      adapterOptions: { disposeExternalPool: true },
    });
    expect(prismaMocks.PrismaClient).toHaveBeenCalledOnce();
  });
});
