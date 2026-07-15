import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, 'tools/scripts/check-fhir-native-legacy-inventory.mjs');
const MANIFEST_PATH = 'tools/fhir-native/legacy-migration-inventory.json';
const SCHEMA_PATH = 'prisma/schema/fixture.prisma';
const SOURCE_PATH = 'src/server/fixture.ts';
const temporaryRoots: string[] = [];

type OwnerReview =
  | {
      status: 'pending';
      reason: string;
    }
  | {
      status: 'approved';
      reason: string;
      reviewer: string;
      decision_id: string;
      decided_at: string;
    };

type FixtureOptions = {
  files?: Record<string, string>;
  schema?: string;
  disposition?: 'remove_at_cutover' | 'replace_at_cutover' | 'owner_review_required';
  ownerReview?: OwnerReview;
  exportScopes?: Array<{ path: string; symbols: string[] }>;
  callSurfaces?: Array<Record<string, unknown>>;
};

type FixtureManifest = Record<string, unknown> & {
  schema_surfaces: Array<Record<string, unknown> & { owner_review?: Record<string, unknown> }>;
  tracked_prisma_delegates: Array<Record<string, unknown>>;
  expected_raw_sql_accesses: string[];
};

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

function writeRepoFile(root: string, relativePath: string, content: string) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function runCheck(root: string, args: string[] = []) {
  return execFileSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readManifest(root: string) {
  return JSON.parse(readFileSync(path.join(root, MANIFEST_PATH), 'utf8')) as FixtureManifest;
}

function writeManifest(root: string, manifest: unknown) {
  writeRepoFile(root, MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function createFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-fhir-legacy-inventory-'));
  temporaryRoots.push(root);
  const disposition = options.disposition ?? 'replace_at_cutover';
  const classification = {
    disposition,
    ...(options.ownerReview ? { owner_review: options.ownerReview } : {}),
  };
  const schema =
    options.schema ??
    `model Patient {
      id   String @id
      name String
    }
    `;
  writeRepoFile(root, SCHEMA_PATH, schema);
  writeRepoFile(
    root,
    SOURCE_PATH,
    options.files?.[SOURCE_PATH] ?? 'export const fixture = true;\n',
  );
  for (const [filePath, content] of Object.entries(options.files ?? {})) {
    writeRepoFile(root, filePath, content);
  }

  writeManifest(root, {
    schema_version: 1,
    task_id: 'FHIR-NATIVE-LEGACY-MIGRATION-001-INVENTORY',
    mode: 'static_source_only',
    description: 'PHI-free fixture inventory.',
    scope: {
      production_source_roots: ['src'],
      excluded_path_patterns: ['\\.(?:test|spec)\\.[cm]?[jt]sx?$'],
    },
    schema_surfaces: [
      {
        id: 'schema:model:Patient',
        path: SCHEMA_PATH,
        kind: 'model',
        name: 'Patient',
        members: [],
        definition_sha256: '0'.repeat(64),
        ...classification,
      },
    ],
    tracked_prisma_delegates: [
      {
        delegate: 'patient',
        model: 'Patient',
        ...classification,
      },
    ],
    expected_prisma_accesses: [],
    expected_raw_sql_accesses: [],
    code_surfaces: [],
    export_scopes: options.exportScopes ?? [],
    call_surfaces: options.callSurfaces ?? [],
    expected_inventory_sha256: '0'.repeat(64),
  });

  const materialized = JSON.parse(runCheck(root, ['--print-manifest']));
  writeManifest(root, materialized);
  return root;
}

describe('check-fhir-native-legacy-inventory', () => {
  it('accepts the checked-in live baseline', () => {
    expect(runCheck(REPO_ROOT)).toMatch(
      /passed: schema=45, prisma_access_groups=\d+, raw_sql_access_groups=\d+/,
    );
  }, 60_000);

  it('materializes the same manifest deterministically', () => {
    const root = createFixture({
      files: {
        [SOURCE_PATH]: 'export async function load() { return db.patient.findMany({}); }\n',
      },
    });

    expect(runCheck(root, ['--print-manifest'])).toBe(runCheck(root, ['--print-manifest']));
  });

  it('fails when a tracked table or column definition drifts', () => {
    const root = createFixture();
    writeRepoFile(
      root,
      SCHEMA_PATH,
      `model Patient {
        id     String @id
        name   String
        status String?
      }
      `,
    );

    expect(() => runCheck(root)).toThrow(/members drift detected|columns drift detected/);
  });

  it('fails on new Prisma readers and unclassified Prisma operations', () => {
    const root = createFixture({
      files: { [SOURCE_PATH]: 'allowed.patient.add("patient_1");\n' },
    });
    expect(runCheck(root)).toContain('check passed');

    writeRepoFile(root, SOURCE_PATH, 'await db.patient.findMany({});\n');
    expect(() => runCheck(root)).toThrow(/Prisma reader\/writer inventory drift detected/);

    writeRepoFile(root, SOURCE_PATH, 'await db.patient.archive({});\n');
    expect(() => runCheck(root)).toThrow(/unclassified Prisma operation/);
  });

  it('detects duplicate schema and delegate classifications', () => {
    const root = createFixture();
    const manifest = readManifest(root);
    manifest.schema_surfaces.push({ ...manifest.schema_surfaces[0] });
    manifest.tracked_prisma_delegates.push({ ...manifest.tracked_prisma_delegates[0] });
    writeManifest(root, manifest);

    expect(() => runCheck(root)).toThrow(/duplicate schema surface id/);
  });

  it('inventories SELECT FOR UPDATE as a raw SQL reader and catches new raw SQL', () => {
    const root = createFixture({
      files: {
        [SOURCE_PATH]: `
          await db.$queryRaw(
            Prisma.sql\`SELECT "id" FROM "Patient" WHERE "id" = \${patientId} FOR UPDATE\`,
          );
        `,
      },
    });
    const manifest = readManifest(root);
    expect(manifest.expected_raw_sql_accesses).toEqual([
      `${SOURCE_PATH}|Patient|Patient|queryRaw|read|1`,
    ]);

    writeRepoFile(
      root,
      SOURCE_PATH,
      `${readFileSync(path.join(root, SOURCE_PATH), 'utf8')}
       await db.$queryRaw\`SELECT "id" FROM "Patient"\`;
      `,
    );
    expect(() => runCheck(root)).toThrow(/raw SQL inventory drift detected/);
  });

  it('fails when exported DTO or contract symbols drift', () => {
    const definitionPath = 'src/server/adapter.ts';
    const root = createFixture({
      files: { [definitionPath]: 'export interface LegacyDto { id: string }\n' },
      exportScopes: [{ path: definitionPath, symbols: [] }],
    });
    writeRepoFile(
      root,
      definitionPath,
      'export interface LegacyDto { id: string }\nexport const legacyFactory = () => null;\n',
    );

    expect(() => runCheck(root)).toThrow(/exported DTO\/contract inventory drift detected/);
  });

  it('fails when a new route, job, or caller appears', () => {
    const definitionPath = 'src/server/adapter.ts';
    const callerPath = 'src/app/api/example/route.ts';
    const root = createFixture({
      files: {
        [definitionPath]: 'export function loadLegacyPatient() { return null; }\n',
        [callerPath]: 'export const GET = () => null;\n',
      },
      callSurfaces: [
        {
          id: 'caller:legacy:load-patient',
          symbol: 'loadLegacyPatient',
          pattern: '\\bloadLegacyPatient\\s*\\(',
          definition_paths: [definitionPath],
          expected_call_sites: [],
          disposition: 'replace_at_cutover',
        },
      ],
    });
    writeRepoFile(
      root,
      callerPath,
      'export async function GET() { return loadLegacyPatient(); }\n',
    );

    expect(() => runCheck(root)).toThrow(/route\/job\/caller inventory drift detected/);
  });

  it('requires owner-review rationale and blocks pending exclusions at the zero gate', () => {
    const ownerReview: OwnerReview = {
      status: 'pending',
      reason: 'Fixture scope requires an accountable owner decision.',
    };
    const root = createFixture({ disposition: 'owner_review_required', ownerReview });
    expect(() => runCheck(root, ['--require-zero'])).toThrow(
      /FHIR Native cutover zero gate is not satisfied/,
    );

    const manifest = readManifest(root);
    const schemaSurface = manifest.schema_surfaces[0];
    if (!schemaSurface?.owner_review) throw new Error('fixture owner review is missing');
    delete schemaSurface.owner_review.reason;
    writeManifest(root, manifest);
    expect(() => runCheck(root)).toThrow(/owner_review is missing reason/);
  });

  it('keeps the fail-closed zero gate red even with no live callers', () => {
    const root = createFixture();

    expect(() => runCheck(root, ['--require-zero'])).toThrow(/schema:Patient/);
  });
});
