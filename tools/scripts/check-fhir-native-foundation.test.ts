import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

type FoundationModule = {
  checkFoundation(root?: string): void;
  validateDocumentation(documentation: string, registry: Record<string, unknown>): void;
  validatePackageLock(packageLock: Record<string, unknown>): void;
  validatePlans(plans: string, registry: Record<string, unknown>): void;
  validateRegistry(registry: Record<string, unknown>, packageLock: Record<string, unknown>): void;
  validateSourceBaseline(root: string, baseline: Record<string, unknown>): void;
};

let foundation: FoundationModule;

beforeAll(async () => {
  // @ts-expect-error The static-gate CLI is plain ESM and intentionally has no .d.ts file.
  foundation = (await import('./check-fhir-native-foundation.mjs')) as FoundationModule;
});

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), 'utf8')) as Record<
    string,
    unknown
  >;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe('check-fhir-native-foundation', () => {
  it('accepts the checked-in foundation registry, package lock, docs, Plans, and live inventory', () => {
    expect(() => foundation.checkFoundation(process.cwd())).not.toThrow();
  });

  it('rejects a false CapabilityStatement claim before a live FHIR route exists', () => {
    const registry = clone(readJson('tools/fhir-native/foundation-registry.json'));
    const packageLock = readJson('tools/fhir-native/package-lock.json');
    const capability = registry.capability as Record<string, unknown>;
    capability.status = 'implemented';
    capability.published = true;

    expect(() => foundation.validateRegistry(registry, packageLock)).toThrow(
      /CapabilityStatement must remain explicitly unimplemented/,
    );
  });

  it('rejects resolving CareTeam by an unapproved default', () => {
    const registry = clone(readJson('tools/fhir-native/foundation-registry.json'));
    const packageLock = readJson('tools/fhir-native/package-lock.json');
    const resources = registry.resources as Array<Record<string, unknown>>;
    const careTeam = resources.find((resource) => resource.resource === 'CareTeam');
    if (!careTeam) throw new Error('CareTeam fixture missing');
    careTeam.nativeTarget = 'L3';

    expect(() => foundation.validateRegistry(registry, packageLock)).toThrow(
      /CareTeam target must remain UNRESOLVED/,
    );
  });

  it('rejects floating or unhashed conformance packages', () => {
    const packageLock = clone(readJson('tools/fhir-native/package-lock.json'));
    const packages = packageLock.packages as Array<Record<string, unknown>>;
    packages[0].sha256 = 'latest';

    expect(() => foundation.validatePackageLock(packageLock)).toThrow(
      /FHIR package lock entries drift/,
    );
  });

  it('rejects a well-formed but unapproved package digest', () => {
    const packageLock = clone(readJson('tools/fhir-native/package-lock.json'));
    const packages = packageLock.packages as Array<Record<string, unknown>>;
    packages[0].sha256 = '0'.repeat(64);

    expect(() => foundation.validatePackageLock(packageLock)).toThrow(
      /FHIR package lock entries drift/,
    );
  });

  it('rejects a package source URL that no longer identifies the approved artifact', () => {
    const packageLock = clone(readJson('tools/fhir-native/package-lock.json'));
    const packages = packageLock.packages as Array<Record<string, unknown>>;
    packages[0].sourceUrl = 'https://example.invalid/package.tgz';

    expect(() => foundation.validatePackageLock(packageLock)).toThrow(
      /FHIR package lock entries drift/,
    );
  });

  it('rejects documentation resource-matrix drift', () => {
    const registry = readJson('tools/fhir-native/foundation-registry.json');
    const documentation = readFileSync(
      path.join(process.cwd(), 'docs/architecture/fhir-first-prescription-platform.md'),
      'utf8',
    ).replace('| Patient               | L1', '| Patient               | L0');

    expect(() => foundation.validateDocumentation(documentation, registry)).toThrow(
      /resource matrix.*drift/,
    );
  });

  it('rejects reintroducing a completed foundation task into the active Plans queue', () => {
    const registry = readJson('tools/fhir-native/foundation-registry.json');
    const plans = readFileSync(path.join(process.cwd(), 'Plans.md'), 'utf8').replace(
      '| A3   | `FHIR-NATIVE-P0-FOUNDATION-003-RAW-INGRESS`',
      '| A2   | `FHIR-NATIVE-LEGACY-MIGRATION-001-INVENTORY`',
    );

    expect(() => foundation.validatePlans(plans, registry)).toThrow(
      /completed FHIR task must not remain active/,
    );
  });

  it('rejects completing a task before every dependency is complete', () => {
    const registry = clone(readJson('tools/fhir-native/foundation-registry.json'));
    const packageLock = readJson('tools/fhir-native/package-lock.json');
    const taskGraph = registry.taskGraph as Array<Record<string, unknown>>;
    const task = taskGraph.find((candidate) => candidate.wave === 'A4');
    if (!task) throw new Error('A4 fixture missing');
    task.status = 'completed';
    delete task.planStatus;

    expect(() => foundation.validateRegistry(registry, packageLock)).toThrow(
      /A4 completed before dependencies/,
    );
  });

  it('rejects source artifact drift after the baseline is captured', () => {
    const baseline = clone(readJson('tools/fhir-native/source-baseline.json'));
    const artifacts = baseline.artifacts as Array<Record<string, unknown>>;
    artifacts[0].sha256 = '0'.repeat(64);

    expect(() => foundation.validateSourceBaseline(process.cwd(), baseline)).toThrow(
      /source artifact drifted/,
    );
  });

  it('rejects a self-declared replacement for the approved base commit', () => {
    const baseline = clone(readJson('tools/fhir-native/source-baseline.json'));
    baseline.baseCommit = '0'.repeat(40);

    expect(() => foundation.validateSourceBaseline(process.cwd(), baseline)).toThrow(
      /approved exact base commit/,
    );
  });

  it('rejects incomplete source artifact coverage', () => {
    const baseline = clone(readJson('tools/fhir-native/source-baseline.json'));
    const artifacts = baseline.artifacts as Array<Record<string, unknown>>;
    artifacts.pop();

    expect(() => foundation.validateSourceBaseline(process.cwd(), baseline)).toThrow(
      /artifact coverage.*drift/,
    );
  });
});
