import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canonicalGitHubRepositoryIdentity,
  checkFhirNativeContract,
} from './check-fhir-native-contract.mjs';

const REPO_ROOT = process.cwd();
const FIXTURE_PATHS = [
  '.github/workflows/ci.yml',
  'Plans.md',
  'docs/architecture/fhir-first-prescription-platform.md',
  'package.json',
  'prisma/schema/standard-clinical-integration.prisma',
  'src/server/adapters/fhir/index.ts',
  'src/server/fhir/native-contract-registry.json',
  'src/server/services/standard-clinical-fhir-validation.ts',
] as const;

interface FixtureRegistry {
  capability: { external: string };
  sourceBaseline: { baseCommit: string; trackedPaths: string[] };
  standards: {
    fhir: { source: string };
    jpCore: {
      package: {
        status: string;
        artifactPath: string | null;
        sha256: string | null;
      };
    };
  };
}

function createFixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-fhir-native-contract-'));
  for (const relativePath of FIXTURE_PATHS) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(REPO_ROOT, relativePath)));
  }
  mkdirSync(path.join(root, 'src/app/api'), { recursive: true });
  return root;
}

function writeText(root: string, relativePath: string, content: string) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function mutateRegistry(root: string, mutate: (registry: FixtureRegistry) => void) {
  const relativePath = 'src/server/fhir/native-contract-registry.json';
  const registry = JSON.parse(
    readFileSync(path.join(root, relativePath), 'utf8'),
  ) as FixtureRegistry;
  mutate(registry);
  writeText(root, relativePath, `${JSON.stringify(registry, null, 2)}\n`);
}

function runCheck(root: string) {
  return checkFhirNativeContract({ root, verifySourceManifest: false });
}

describe('check-fhir-native-contract', () => {
  it('normalizes the actions/checkout HTTPS origin without weakening owner/repository pinning', () => {
    expect(canonicalGitHubRepositoryIdentity('https://github.com/yusuketakuma/careviax')).toBe(
      canonicalGitHubRepositoryIdentity('https://github.com/yusuketakuma/careviax.git'),
    );
    expect(() =>
      canonicalGitHubRepositoryIdentity('https://github.com/another-owner/careviax'),
    ).not.toThrow();
    expect(canonicalGitHubRepositoryIdentity('https://github.com/another-owner/careviax')).not.toBe(
      canonicalGitHubRepositoryIdentity('https://github.com/yusuketakuma/careviax.git'),
    );
    expect(() =>
      canonicalGitHubRepositoryIdentity('https://github.com.evil.example/yusuketakuma/careviax'),
    ).toThrow(/GitHub HTTPS or SSH/);
  });

  it('accepts the closed A0 registry and current implementation evidence', () => {
    const result = runCheck(createFixtureRepo());

    expect(result.counts).toEqual({ resources: 28, searchKeys: 25, childTasks: 27, liveRoutes: 0 });
    expect(result.manifest).toBeNull();
  });

  it('rejects documentation drift from the machine-readable resource matrix', () => {
    const root = createFixtureRepo();
    const relativePath = 'docs/architecture/fhir-first-prescription-platform.md';
    const source = readFileSync(path.join(root, relativePath), 'utf8');
    writeText(root, relativePath, source.replace('`S-PATIENT`', '`S-NONE`'));

    expect(() => runCheck(root)).toThrow(/resourceMatrix: registry drift detected/);
  });

  it('rejects documentation drift from the approved official standard links', () => {
    const root = createFixtureRepo();
    const relativePath = 'docs/architecture/fhir-first-prescription-platform.md';
    const source = readFileSync(path.join(root, relativePath), 'utf8');
    writeText(
      root,
      relativePath,
      source.replace(
        '[FHIR R4 4.0.1](https://hl7.org/fhir/R4/)',
        '[FHIR R4 4.0.1](https://example.invalid/fhir/R4/)',
      ),
    );

    expect(() => runCheck(root)).toThrow(/exact FHIR R4 official source link missing/);
  });

  it('rejects Prisma enum drift and recomputed target-gap drift', () => {
    const root = createFixtureRepo();
    const relativePath = 'prisma/schema/standard-clinical-integration.prisma';
    const source = readFileSync(path.join(root, relativePath), 'utf8');
    writeText(
      root,
      relativePath,
      source.replace(
        'enum ClinicalFhirResourceType {\n  patient',
        'enum ClinicalFhirResourceType {\n  location\n  patient',
      ),
    );

    expect(() => runCheck(root)).toThrow(/implementationEvidence: registry drift detected/);
  });

  it('rejects a live FHIR route while external capability remains none', () => {
    const root = createFixtureRepo();
    writeText(
      root,
      'src/app/(clinical)/fhir/r4/metadata/route.ts',
      "export function GET() { return new Response('{}'); }\n",
    );

    expect(() => runCheck(root)).toThrow(/implementationEvidence: registry drift detected/);
  });

  it('rejects Plans dependency drift from the approved child graph', () => {
    const root = createFixtureRepo();
    const relativePath = 'Plans.md';
    const source = readFileSync(path.join(root, relativePath), 'utf8');
    writeText(root, relativePath, source.replace('| approved B4    |', '| B3             |'));

    expect(() => runCheck(root)).toThrow(/Plans\.md child graph: registry drift detected/);
  });

  it('rejects a false live capability claim without live routes', () => {
    const root = createFixtureRepo();
    mutateRegistry(root, (registry) => {
      registry.capability.external = 'live';
    });

    expect(() => runCheck(root)).toThrow(/external must remain none/);
  });

  it('rejects a pinned JP Core package when its SHA-256 does not match', () => {
    const root = createFixtureRepo();
    writeText(root, 'packages/jpfhir.jp.core-1.2.0.tgz', 'not-the-approved-package');
    mutateRegistry(root, (registry) => {
      registry.standards.jpCore.package = {
        status: 'pinned',
        artifactPath: 'packages/jpfhir.jp.core-1.2.0.tgz',
        sha256: '0'.repeat(64),
      };
    });

    expect(() => runCheck(root)).toThrow(/SHA-256 mismatch/);
  });

  it('rejects package artifacts outside the repository', () => {
    const root = createFixtureRepo();
    mutateRegistry(root, (registry) => {
      registry.standards.jpCore.package = {
        status: 'pinned',
        artifactPath: '../../untrusted-package.tgz',
        sha256: '0'.repeat(64),
      };
    });

    expect(() => runCheck(root)).toThrow(/pinned requires path and SHA-256/);
  });

  it('rejects adapter version drift', () => {
    const root = createFixtureRepo();
    const relativePath = 'src/server/adapters/fhir/index.ts';
    const source = readFileSync(path.join(root, relativePath), 'utf8');
    writeText(
      root,
      relativePath,
      source.replace("FHIR_R4_VERSION = '4.0.1'", "FHIR_R4_VERSION = '5.0.0'"),
    );

    expect(() => runCheck(root)).toThrow(/implementationEvidence: registry drift detected/);
  });

  it('rejects removal of the CI wiring', () => {
    const root = createFixtureRepo();
    const relativePath = '.github/workflows/ci.yml';
    const source = readFileSync(path.join(root, relativePath), 'utf8');
    writeText(
      root,
      relativePath,
      source.replace('run: pnpm fhir-native-contract:check', 'run: pnpm lint'),
    );

    expect(() => runCheck(root)).toThrow(/FHIR native contract CI step missing or changed/);
  });

  it('rejects removal of a mandatory source-manifest path', () => {
    const root = createFixtureRepo();
    mutateRegistry(root, (registry) => {
      registry.sourceBaseline.trackedPaths = registry.sourceBaseline.trackedPaths.filter(
        (trackedPath) => trackedPath !== 'pnpm-lock.yaml',
      );
    });

    expect(() => runCheck(root)).toThrow(/sourceBaseline\.trackedPaths: registry drift detected/);
  });

  it('rejects a self-declared replacement for the approved baseline commit', () => {
    const root = createFixtureRepo();
    mutateRegistry(root, (registry) => {
      registry.sourceBaseline.baseCommit = '0'.repeat(40);
    });

    expect(() => runCheck(root)).toThrow(/must match the approved exact SHA-1/);
  });

  it('rejects drift from the approved official standard sources', () => {
    const root = createFixtureRepo();
    mutateRegistry(root, (registry) => {
      registry.standards.fhir.source = 'https://example.invalid/fhir/R4/';
    });

    expect(() => runCheck(root)).toThrow(/FHIR source drift/);
  });
});
