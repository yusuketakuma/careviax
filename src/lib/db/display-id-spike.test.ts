import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const databaseUrl = process.env.DISPLAY_ID_SPIKE_DATABASE_URL ?? process.env.DATABASE_URL;
const shouldRunSpike =
  Boolean(databaseUrl) && /localhost:5433\/ph_os_e2e(?:\?|$)/.test(databaseUrl ?? '');
const describeSpike = shouldRunSpike ? describe : describe.skip;
const SPIKE_TABLE = 'display_id_spike_sequence';
const PREFIX = 'spk';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 12);

type SpikePrismaClient = PrismaClient;
type OperationEvent = {
  model: string;
  operation: 'create' | 'createMany';
  argKeys: string[];
};
type SequenceRow = { next_value: bigint };
type AllocationRow = { allocated: bigint };
type RangeAllocationRow = { first_value: bigint };
type MutableArgs = { data?: unknown };

function createPrismaClient(): SpikePrismaClient {
  if (!databaseUrl) throw new Error('DISPLAY_ID_SPIKE_DATABASE_URL or DATABASE_URL is required');
  const adapter = new PrismaPg({ connectionString: databaseUrl, max: 5 });
  return new PrismaClient({ adapter });
}

function orgId(suffix: string): string {
  return `spikeorg${RUN_ID}${suffix}`;
}

function rowName(suffix: string): string {
  return `display-id-spike-${RUN_ID}-${suffix}`;
}

function formatDisplayId(value: bigint): string {
  return `${PREFIX}${value.toString().padStart(10, '0')}`;
}

function getOrgId(data: Record<string, unknown>): string {
  const orgIdValue = data.org_id;
  if (typeof orgIdValue !== 'string' || orgIdValue.length === 0) {
    throw new Error('display-id spike requires org_id in create data');
  }
  return orgIdValue;
}

function toMutableRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('display-id spike expected object create data');
  }
  return data as Record<string, unknown>;
}

function toMutableRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.map(toMutableRecord);
  return [toMutableRecord(data)];
}

async function allocateOne(client: SpikePrismaClient, orgIdValue: string): Promise<bigint> {
  const rows = await client.$queryRaw<AllocationRow[]>`
    INSERT INTO display_id_spike_sequence (org_id, prefix, next_value)
    VALUES (${orgIdValue}, ${PREFIX}, ${BigInt(2)})
    ON CONFLICT (org_id, prefix)
    DO UPDATE SET next_value = display_id_spike_sequence.next_value + 1
    RETURNING next_value - 1 AS allocated
  `;
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'bigint') {
    throw new Error('display-id spike allocation did not return a bigint');
  }
  return allocated;
}

async function allocateRange(
  client: SpikePrismaClient,
  orgIdValue: string,
  amount: number,
): Promise<bigint[]> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('display-id spike range amount must be a positive safe integer');
  }

  const amountBigInt = BigInt(amount);
  const rows = await client.$queryRaw<RangeAllocationRow[]>`
    INSERT INTO display_id_spike_sequence (org_id, prefix, next_value)
    VALUES (${orgIdValue}, ${PREFIX}, ${amountBigInt + BigInt(1)})
    ON CONFLICT (org_id, prefix)
    DO UPDATE SET next_value = display_id_spike_sequence.next_value + ${amountBigInt}
    RETURNING next_value - ${amountBigInt} AS first_value
  `;
  const firstValue = rows[0]?.first_value;
  if (typeof firstValue !== 'bigint') {
    throw new Error('display-id spike range allocation did not return a bigint');
  }
  return Array.from({ length: amount }, (_, index) => firstValue + BigInt(index));
}

function extendWithRootAllocator(root: SpikePrismaClient, events: OperationEvent[]) {
  return root.$extends({
    name: 'display-id-spike-root-allocator',
    query: {
      $allModels: {
        async create(params) {
          const { args, model, operation, query } = params;
          events.push({ model, operation, argKeys: Object.keys(params).sort() });
          if (model !== 'PackagingMethodMaster') return query(args);

          const mutableArgs = args as MutableArgs;
          const data = toMutableRecord(mutableArgs.data);
          if (typeof data.description === 'string' && data.description.length > 0) {
            return query(args);
          }

          const allocated = await allocateOne(root, getOrgId(data));
          mutableArgs.data = { ...data, description: formatDisplayId(allocated) };
          return query(mutableArgs as typeof args);
        },
        async createMany(params) {
          const { args, model, operation, query } = params;
          events.push({ model, operation, argKeys: Object.keys(params).sort() });
          if (model !== 'PackagingMethodMaster') return query(args);

          const mutableArgs = args as MutableArgs;
          const rows = toMutableRecords(mutableArgs.data);
          if (rows.length === 0) return query(args);

          const orgIds = new Set(rows.map(getOrgId));
          if (orgIds.size !== 1) {
            throw new Error('display-id spike createMany expects a single org_id');
          }

          const orgIdValue = rows[0] ? getOrgId(rows[0]) : undefined;
          if (!orgIdValue) {
            throw new Error('display-id spike createMany expected at least one org_id');
          }
          const allocated = await allocateRange(root, orgIdValue, rows.length);
          mutableArgs.data = rows.map((row, index) => ({
            ...row,
            description: formatDisplayId(allocated[index]),
          }));
          return query(mutableArgs as typeof args);
        },
      },
    },
  });
}

async function readSequence(client: SpikePrismaClient, orgIdValue: string): Promise<bigint | null> {
  const rows = await client.$queryRaw<SequenceRow[]>`
    SELECT next_value
    FROM display_id_spike_sequence
    WHERE org_id = ${orgIdValue} AND prefix = ${PREFIX}
  `;
  return rows[0]?.next_value ?? null;
}

async function cleanSpikeData(client: SpikePrismaClient) {
  await client.packagingMethodMaster.deleteMany({
    where: { name: { startsWith: rowName('') } },
  });
  await client.$executeRaw`
    DELETE FROM display_id_spike_sequence
    WHERE org_id LIKE ${`spikeorg${RUN_ID}%`}
  `;
}

async function loadWithOrgContextUsing(client: unknown) {
  vi.resetModules();
  vi.doMock('@/lib/db/client', () => ({ prisma: client }));
  vi.doMock('@/lib/auth/request-context', () => ({
    getRequestAuthContext: () => undefined,
  }));
  vi.doMock('@/lib/auth/security-events', () => ({
    logSecurityEvent: vi.fn(),
  }));
  const rlsModule = await import('./rls');
  return rlsModule.withOrgContext;
}

describeSpike('display_id Prisma extension feasibility spike (ID-1a)', () => {
  let prisma: SpikePrismaClient;
  let events: OperationEvent[];
  let extendedPrisma: ReturnType<typeof extendWithRootAllocator>;

  beforeAll(async () => {
    prisma = createPrismaClient();
    // Deliberately a regular disposable table, not a TEMP table: the spike must
    // observe whether extension-side allocation escapes the interactive tx.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${SPIKE_TABLE} (
        org_id text NOT NULL,
        prefix text NOT NULL,
        next_value bigint NOT NULL,
        PRIMARY KEY (org_id, prefix)
      )
    `);
  });

  beforeEach(async () => {
    events = [];
    extendedPrisma = extendWithRootAllocator(prisma, events);
    await cleanSpikeData(prisma);
  });

  afterEach(async () => {
    vi.doUnmock('@/lib/db/client');
    vi.doUnmock('@/lib/auth/request-context');
    vi.doUnmock('@/lib/auth/security-events');
    vi.resetModules();
    await cleanSpikeData(prisma);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${SPIKE_TABLE}`);
    await prisma.$disconnect();
  });

  it('FAILS E1 criterion 1: extension-side root allocation leaks outside interactive tx rollback', async () => {
    const org = orgId('txleak');
    const rollback = new Error('intentional rollback');

    await expect(
      extendedPrisma.$transaction(async (tx) => {
        await tx.packagingMethodMaster.create({
          data: { org_id: org, name: rowName('tx-leak') },
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    await expect(
      prisma.packagingMethodMaster.count({ where: { org_id: org, name: rowName('tx-leak') } }),
    ).resolves.toBe(0);
    await expect(readSequence(prisma, org)).resolves.toBe(BigInt(2));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ model: 'PackagingMethodMaster', operation: 'create' });
    expect(events[0]?.argKeys).toEqual(expect.arrayContaining(['args', 'model', 'query']));
    expect(events[0]?.argKeys).not.toContain('client');
    expect(events[0]?.argKeys).not.toContain('tx');
  });

  it('PASSES criterion 2: non-transactional create can allocate and inject a display_id surrogate', async () => {
    const org = orgId('create');

    const created = await extendedPrisma.packagingMethodMaster.create({
      data: { org_id: org, name: rowName('create') },
      select: { org_id: true, name: true, description: true },
    });

    expect(created).toEqual({
      org_id: org,
      name: rowName('create'),
      description: 'spk0000000001',
    });
    await expect(readSequence(prisma, org)).resolves.toBe(BigInt(2));
    expect(events.map((event) => `${event.model}.${event.operation}`)).toEqual([
      'PackagingMethodMaster.create',
    ]);
  });

  it('PASSES criterion 3: createMany hook can inject per-row display_id surrogates in input order', async () => {
    const org = orgId('many');

    await expect(
      extendedPrisma.packagingMethodMaster.createMany({
        data: [0, 1, 2].map((index) => ({
          org_id: org,
          name: rowName(`many-${index}`),
        })),
      }),
    ).resolves.toEqual({ count: 3 });

    const rows = await prisma.packagingMethodMaster.findMany({
      where: { org_id: org, name: { startsWith: rowName('many-') } },
      orderBy: { name: 'asc' },
      select: { name: true, description: true },
    });
    expect(rows).toEqual([
      { name: rowName('many-0'), description: 'spk0000000001' },
      { name: rowName('many-1'), description: 'spk0000000002' },
      { name: rowName('many-2'), description: 'spk0000000003' },
    ]);
    await expect(readSequence(prisma, org)).resolves.toBe(BigInt(4));
    expect(events.map((event) => `${event.model}.${event.operation}`)).toEqual([
      'PackagingMethodMaster.createMany',
    ]);
  });

  it('PASSES criterion 4: withOrgContext session variables survive extension allocation side effects', async () => {
    const org = orgId('rls');
    const withOrgContext = await loadWithOrgContextUsing(extendedPrisma);

    const settings = await withOrgContext(
      org,
      async (tx) => {
        await tx.packagingMethodMaster.create({
          data: { org_id: org, name: rowName('rls') },
        });

        const rows = await tx.$queryRaw<{ current_org_id: string; rls_context_applied: string }[]>`
          SELECT
            current_setting('app.current_org_id', true) AS current_org_id,
            current_setting('app.rls_context_applied', true) AS rls_context_applied
        `;
        return rows[0];
      },
      {
        requestContext: {
          userId: 'display-id-spike-user',
          orgId: org,
          role: 'pharmacist',
        },
      },
    );

    expect(settings).toEqual({
      current_org_id: org,
      rls_context_applied: 'true',
    });
    await expect(readSequence(prisma, org)).resolves.toBe(BigInt(2));
    expect(events.map((event) => `${event.model}.${event.operation}`)).toEqual([
      'PackagingMethodMaster.create',
    ]);
  });
});
