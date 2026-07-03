import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DISPLAY_ID_EXCLUDED_MODELS,
  DISPLAY_ID_GLOBAL_ORG_ID,
  DISPLAY_ID_INFRASTRUCTURE_MODELS,
  DISPLAY_ID_PATTERN,
  DISPLAY_ID_REGISTRY,
  RESERVED_DISPLAY_ID_PREFIXES,
  allocateDisplayId,
  allocateDisplayIdRange,
  allocateGlobalDisplayId,
  displayIdSchema,
  formatDisplayId,
  getDisplayIdModelForPrefix,
  getDisplayIdRegistryEntry,
  parseDisplayId,
} from './display-id';

const SCHEMA_DIR = 'prisma/schema';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseUrl = process.env.DISPLAY_ID_DATABASE_URL ?? process.env.DATABASE_URL;
const shouldRunDbTests =
  Boolean(databaseUrl) && /localhost:5433\/ph_os_e2e(?:\?|$)/.test(databaseUrl ?? '');
const describeDb = shouldRunDbTests ? describe : describe.skip;

type SequenceRow = { next_value: bigint };

function readSchemaModels(): string[] {
  const modelNames: string[] = [];
  const modelPattern = /^model\s+(\w+)\s*\{/gm;
  for (const fileName of readdirSync(SCHEMA_DIR).filter((file) => file.endsWith('.prisma'))) {
    const text = readFileSync(join(SCHEMA_DIR, fileName), 'utf8');
    let match: RegExpExecArray | null;
    while ((match = modelPattern.exec(text)) !== null) {
      if (match[1]) modelNames.push(match[1]);
    }
  }
  return modelNames.sort();
}

function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(path).forEach((file) => files.push(file));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function orgId(suffix: string): string {
  return `dispid${RUN_ID}${suffix}`;
}

function parseSequence(id: string): bigint {
  const parsed = parseDisplayId(id);
  if (!parsed) throw new Error(`Expected parseable display_id: ${id}`);
  return parsed.sequence;
}

describe('display_id registry and format contract', () => {
  it('covers every Prisma model through registry, explicit business exclusion, or infrastructure exclusion', () => {
    const schemaModels = readSchemaModels();
    expect(schemaModels).toHaveLength(140);
    expect(Object.keys(DISPLAY_ID_REGISTRY)).toHaveLength(138);
    expect(DISPLAY_ID_EXCLUDED_MODELS).toEqual(['Setting']);
    expect(DISPLAY_ID_INFRASTRUCTURE_MODELS).toEqual(['IdSequence']);

    const covered = new Set([
      ...Object.keys(DISPLAY_ID_REGISTRY),
      ...DISPLAY_ID_EXCLUDED_MODELS,
      ...DISPLAY_ID_INFRASTRUCTURE_MODELS,
    ]);
    expect(schemaModels.filter((model) => !covered.has(model))).toEqual([]);
    expect([...covered].filter((model) => !schemaModels.includes(model))).toEqual([]);
  });

  it('keeps the ratified prefix registry unique, lower-case, and scoped as designed', () => {
    const entries = Object.entries(DISPLAY_ID_REGISTRY);
    const prefixes = entries.map(([, entry]) => entry.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes).toHaveLength(138);
    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^[a-z]{1,6}$/);
    }
    expect(RESERVED_DISPLAY_ID_PREFIXES).toEqual(['cfg']);
    expect(prefixes).not.toContain('cfg');

    const scopeCounts = entries.reduce<Record<string, number>>((counts, [, entry]) => {
      counts[entry.scope] = (counts[entry.scope] ?? 0) + 1;
      return counts;
    }, {});
    expect(scopeCounts).toEqual({ global: 11, org: 126, orgViaParent: 1 });

    expect(
      entries
        .filter(([, entry]) => entry.scope === 'global')
        .map(([model]) => model)
        .sort(),
    ).toEqual([
      'BreakGlassSession',
      'DrugInteraction',
      'DrugMaster',
      'DrugMasterChangeEvent',
      'DrugMasterImportLog',
      'DrugPackage',
      'DrugPackageInsert',
      'GenericDrugMapping',
      'LabelDictionary',
      'Organization',
      'PlatformOperator',
    ]);
    expect(getDisplayIdRegistryEntry('HandoffItem')).toEqual({
      prefix: 'h',
      scope: 'orgViaParent',
      parent: 'HandoffBoard',
    });
  });

  it('formats, validates, and parses display IDs with the canonical regex', () => {
    expect(DISPLAY_ID_PATTERN).toEqual(/^[a-z]{1,6}[0-9]{10,15}$/);
    expect(formatDisplayId('Patient', BigInt(1))).toBe('p0000000001');
    expect(formatDisplayId('DrugMaster', BigInt(1))).toBe('drug0000000001');
    expect(formatDisplayId('Patient', BigInt('10000000000'))).toBe('p10000000000');
    expect(displayIdSchema.safeParse('p0000000001').success).toBe(true);
    expect(displayIdSchema.safeParse('drug0000000001').success).toBe(true);
    expect(displayIdSchema.safeParse('p999999999999999').success).toBe(true);

    expect(parseDisplayId('p0000000042')).toEqual({
      raw: 'p0000000042',
      model: 'Patient',
      prefix: 'p',
      sequence: BigInt(42),
    });
    expect(getDisplayIdModelForPrefix('drug')).toBe('DrugMaster');
  });

  it.each([
    'P0000000001',
    'p000000001',
    'p00000000001x',
    'ppppppp0000000001',
    'p０００００００００１',
    'cfg0000000001',
    'zzzzz0000000001',
    'p0000000000',
  ])('rejects malformed or unassigned display ID %s', (value) => {
    expect(displayIdSchema.safeParse(value).success).toBe(false);
    expect(parseDisplayId(value)).toBeNull();
  });

  it('rejects invalid formatter inputs before they can be allocated or displayed', () => {
    expect(() => formatDisplayId('Patient', BigInt(0))).toThrow(/positive/);
    expect(() => formatDisplayId('Patient', BigInt(-1))).toThrow(/positive/);
    expect(() => formatDisplayId('Patient', BigInt('1000000000000000'))).toThrow(/15 digits/);
    expect(() => formatDisplayId('Setting' as never, BigInt(1))).toThrow(/Unknown/);
  });

  it('forbids direct IdSequence access outside the allocator module', () => {
    const allowedFiles = new Set([
      join('src', 'lib', 'db', 'display-id.ts'),
      join('src', 'lib', 'db', 'display-id.test.ts'),
      join('src', 'lib', 'db', 'display-id-spike.test.ts'),
    ]);
    const offenders = collectSourceFiles('src').flatMap((file) => {
      if (allowedFiles.has(file) || /\.test\.(ts|tsx)$/.test(file)) return [];
      const text = readFileSync(file, 'utf8');
      const directDelegate =
        /\b(?:prisma|tx|client)\s*(?:\.\s*idSequence|\[\s*['"`]idSequence['"`]\s*\])/;
      const rawSql = /\bid_sequence\b/;
      return directDelegate.test(text) || rawSql.test(text) ? [file] : [];
    });
    expect(offenders).toEqual([]);
  });
});

describeDb('display_id allocator integration (local e2e DB)', () => {
  let prisma: PrismaClient;

  async function cleanTestSequences() {
    await prisma.$executeRaw`
      DELETE FROM id_sequence
      WHERE (org_id LIKE ${`dispid${RUN_ID}%`})
         OR (org_id = ${DISPLAY_ID_GLOBAL_ORG_ID} AND prefix IN ('bg', 'drug'))
    `;
  }

  async function readSequence(org: string, prefix: string): Promise<bigint | null> {
    const rows = await prisma.$queryRaw<SequenceRow[]>`
      SELECT next_value
      FROM id_sequence
      WHERE org_id = ${org} AND prefix = ${prefix}
    `;
    return rows[0]?.next_value ?? null;
  }

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('DISPLAY_ID_DATABASE_URL or DATABASE_URL is required');
    const adapter = new PrismaPg({ connectionString: databaseUrl, max: 10 });
    prisma = new PrismaClient({ adapter });
  });

  beforeEach(async () => {
    await cleanTestSequences();
  });

  afterEach(async () => {
    await cleanTestSequences();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('allocates first and range IDs inside the caller transaction', async () => {
    const org = orgId('range');

    const first = await prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', org));
    const nextRange = await prisma.$transaction((tx) =>
      allocateDisplayIdRange(tx, 'Patient', org, 3),
    );

    expect(first).toBe('p0000000001');
    expect(nextRange).toEqual(['p0000000002', 'p0000000003', 'p0000000004']);
    await expect(readSequence(org, 'p')).resolves.toBe(BigInt(5));
  });

  it('rolls back sequence allocation with the caller transaction', async () => {
    const org = orgId('rollback');
    const rollback = new Error('intentional display_id rollback');

    await expect(
      prisma.$transaction(async (tx) => {
        await allocateDisplayId(tx, 'Patient', org);
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    await expect(readSequence(org, 'p')).resolves.toBeNull();
  });

  it('serializes concurrent allocations for one org and prefix without duplicates or gaps', async () => {
    const org = orgId('concurrent');

    const ids = await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', org)),
      ),
    );

    expect(new Set(ids).size).toBe(20);
    expect(ids.map(parseSequence).sort((a, b) => Number(a - b))).toEqual(
      Array.from({ length: 20 }, (_, index) => BigInt(index + 1)),
    );
    await expect(readSequence(org, 'p')).resolves.toBe(BigInt(21));
  });

  it('keeps tenant-scoped counters separated by org', async () => {
    const orgA = orgId('tenanta');
    const orgB = orgId('tenantb');

    const [a1, b1, a2] = await Promise.all([
      prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', orgA)),
      prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', orgB)),
      prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', orgA)),
    ]);

    expect([a1, a2].sort()).toEqual(['p0000000001', 'p0000000002']);
    expect(b1).toBe('p0000000001');
    await expect(readSequence(orgA, 'p')).resolves.toBe(BigInt(3));
    await expect(readSequence(orgB, 'p')).resolves.toBe(BigInt(2));
  });

  it('requires explicit global allocation and rejects sentinel misuse', async () => {
    await expect(
      prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', DISPLAY_ID_GLOBAL_ORG_ID)),
    ).rejects.toThrow(/global sentinel/);
    await expect(
      prisma.$transaction((tx) => allocateDisplayId(tx, 'DrugMaster', orgId('bad'))),
    ).rejects.toThrow(/allocateGlobalDisplayId/);
    await expect(allocateGlobalDisplayId(prisma, 'Patient')).rejects.toThrow(/tenant-scoped/);

    await expect(allocateGlobalDisplayId(prisma, 'DrugMaster')).resolves.toBe('drug0000000001');
    await expect(readSequence(DISPLAY_ID_GLOBAL_ORG_ID, 'drug')).resolves.toBe(BigInt(2));
  });
});
