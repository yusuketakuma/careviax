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
  type DisplayIdModel,
} from './display-id';

const SCHEMA_DIR = 'prisma/schema';
const PATIENT_DISPLAY_ID_W1_MIGRATION =
  'prisma/migrations/20260703150000_add_patient_display_ids/migration.sql';
const PRESCRIPTION_DISPLAY_ID_W2_MIGRATION =
  'prisma/migrations/20260703152000_add_prescription_display_ids/migration.sql';
const PATIENT_DISPLAY_ID_W1_MODELS = [
  'Patient',
  'Residence',
  'CareCase',
  'ContactParty',
  'CareTeamLink',
  'PatientCondition',
  'ConsentRecord',
  'ManagementPlan',
  'PatientSchedulePreference',
  'PatientPackagingProfile',
  'PatientMcsLink',
  'PatientMcsSummary',
  'PatientInsurance',
  'PatientLabObservation',
  'PatientMcsMessage',
  'PatientFieldRevision',
  'PatientMedicalProcedure',
  'PatientNarcoticUse',
] as const satisfies readonly DisplayIdModel[];
const PRESCRIPTION_DISPLAY_ID_W2_MODELS = [
  'MedicationCycle',
  'CycleTransitionLog',
  'PrescriptionIntake',
  'PrescriptionLine',
  'InquiryRecord',
  'DispenseTask',
  'DispenseResult',
  'DispenseAudit',
  'DispensingDecision',
  'SetPlan',
  'SetBatch',
  'SetAudit',
  'SetBatchChangeLog',
  'PackagingGroup',
  'CycleHold',
  'WorkflowException',
  'QrScanDraft',
  'JahisSupplementalRecord',
] as const satisfies readonly DisplayIdModel[];
const DISPLAY_ID_SCHEMA_WAVES = [
  {
    label: 'W1 patient-domain',
    schemaFile: 'patient.prisma',
    migrationPath: PATIENT_DISPLAY_ID_W1_MIGRATION,
    models: PATIENT_DISPLAY_ID_W1_MODELS,
  },
  {
    label: 'W2 prescription-domain',
    schemaFile: 'prescription.prisma',
    migrationPath: PRESCRIPTION_DISPLAY_ID_W2_MIGRATION,
    models: PRESCRIPTION_DISPLAY_ID_W2_MODELS,
  },
] as const;
const DISPLAY_ID_WAVE_MODELS = DISPLAY_ID_SCHEMA_WAVES.flatMap((wave) => wave.models);
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseUrl = process.env.DISPLAY_ID_DATABASE_URL ?? process.env.DATABASE_URL;
const shouldRunDbTests =
  Boolean(databaseUrl) && /localhost:5433\/ph_os_e2e(?:\?|$)/.test(databaseUrl ?? '');
const describeDb = shouldRunDbTests ? describe : describe.skip;

type SequenceRow = { next_value: bigint };
type DisplayIdIndexRow = {
  indexName: string;
  tableName: string;
  isUnique: boolean;
  predicate: string | null;
  indexDef: string;
};

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

function readModelBlock(schema: string, model: string): string {
  const match = new RegExp(`^model ${model} \\{[\\s\\S]*?^\\}`, 'm').exec(schema);
  if (!match) throw new Error(`Missing Prisma model block: ${model}`);
  return match[0];
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

  it('declares display ID migration waves as nullable tenant-local identifiers', () => {
    for (const wave of DISPLAY_ID_SCHEMA_WAVES) {
      const schema = readFileSync(join(SCHEMA_DIR, wave.schemaFile), 'utf8');
      const migration = readFileSync(wave.migrationPath, 'utf8');

      for (const model of wave.models) {
        expect(getDisplayIdRegistryEntry(model).scope, `${wave.label}:${model}`).toBe('org');

        const block = readModelBlock(schema, model);
        expect(block, `${wave.label}:${model}`).toMatch(/\n\s+org_id\s+String(?:\s|$)/);
        expect(block, `${wave.label}:${model}`).toMatch(/\n\s+created_at\s+DateTime(?:\s|$)/);
        expect(block, `${wave.label}:${model}`).toMatch(/\n\s+display_id\s+String\?(?:\s|$)/);
        expect(block, `${wave.label}:${model}`).not.toMatch(/\n\s+display_id\s+String\b(?!\?)/);
        expect(block, `${wave.label}:${model}`).toContain('@@unique([org_id, display_id])');

        expect(migration, `${wave.label}:${model}`).toContain(
          `ALTER TABLE "${model}" ADD COLUMN "display_id" TEXT;`,
        );
        expect(migration, `${wave.label}:${model}`).toContain(
          `CREATE UNIQUE INDEX "${model}_org_id_display_id_key" ON "${model}"("org_id", "display_id") WHERE "display_id" IS NOT NULL;`,
        );
        expect(migration, `${wave.label}:${model}`).not.toContain(
          `ALTER TABLE "${model}" ALTER COLUMN "display_id" SET NOT NULL`,
        );
        expect(migration, `${wave.label}:${model}`).not.toContain(
          `ON "${model}"("display_id") WHERE "display_id" IS NOT NULL`,
        );
      }

      expect(migration, wave.label).not.toMatch(/\bDROP\b/i);
      expect(migration, wave.label).not.toMatch(/\bALTER COLUMN\b/i);
    }
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

  it('keeps migration-wave uniqueness backed by partial DB indexes', async () => {
    const rows = await prisma.$queryRaw<DisplayIdIndexRow[]>`
      SELECT
        index_class.relname AS "indexName",
        table_class.relname AS "tableName",
        pg_index.indisunique AS "isUnique",
        pg_get_expr(pg_index.indpred, pg_index.indrelid) AS "predicate",
        pg_get_indexdef(pg_index.indexrelid) AS "indexDef"
      FROM pg_index
      INNER JOIN pg_class index_class
        ON index_class.oid = pg_index.indexrelid
      INNER JOIN pg_class table_class
        ON table_class.oid = pg_index.indrelid
      INNER JOIN pg_namespace namespace
        ON namespace.oid = table_class.relnamespace
      WHERE namespace.nspname = 'public'
        AND index_class.relname LIKE '%_org_id_display_id_key'
    `;
    const byIndexName = new Map(rows.map((row) => [row.indexName, row]));

    for (const model of DISPLAY_ID_WAVE_MODELS) {
      const row = byIndexName.get(`${model}_org_id_display_id_key`);
      expect(row, model).toMatchObject({
        tableName: model,
        isUnique: true,
        predicate: '(display_id IS NOT NULL)',
      });
      expect(row?.indexDef, model).toContain('CREATE UNIQUE INDEX');
      expect(row?.indexDef, model).toContain(`ON public."${model}"`);
      expect(row?.indexDef, model).toContain('(org_id, display_id)');
    }
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
