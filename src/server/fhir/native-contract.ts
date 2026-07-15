import registryJson from './native-contract-registry.json';

export type ArtifactState = 'not_pinned' | 'pinned';
export type BuildState = 'not_built' | 'built';

export const FHIR_NATIVE_REQUIRED_REPOSITORY =
  'https://github.com/yusuketakuma/careviax.git' as const;
export const FHIR_NATIVE_REQUIRED_BASE_COMMIT = '8d1205539c75d3acb9d242365f781c960074d21b' as const;
export const FHIR_NATIVE_REQUIRED_FHIR_SOURCE = 'https://hl7.org/fhir/R4/' as const;
export const FHIR_NATIVE_REQUIRED_JP_CORE_SOURCE = 'https://jpfhir.jp/fhir/core/1.2.0/' as const;

export const FHIR_NATIVE_REQUIRED_SOURCE_PATHS = [
  '.github/workflows/ci.yml',
  'Plans.md',
  'docs/architecture/README.md',
  'docs/architecture/fhir-first-prescription-platform.md',
  'docs/decisions.md',
  'docs/phase5-cutover-strategy.md',
  'package.json',
  'pnpm-lock.yaml',
  'prisma/schema/standard-clinical-integration.prisma',
  'src/server/adapters/fhir/index.ts',
  'src/server/services/standard-clinical-fhir-validation.ts',
  'src/server/fhir/native-contract-registry.json',
  'src/server/fhir/native-contract.ts',
  'src/server/fhir/native-contract.test.ts',
  'tools/scripts/check-fhir-native-contract.mjs',
  'tools/scripts/check-fhir-native-contract.test.ts',
] as const;

export interface ArtifactContract<State extends string> {
  readonly status: State;
  readonly artifactPath: string | null;
  readonly sha256: string | null;
}

export interface FhirNativeResourceContract {
  readonly resourceType: string;
  readonly legacyInventory: string;
  readonly nativeTarget: string;
  readonly authoritativeServer: string;
  readonly nativeInteractions: readonly string[];
  readonly profilePolicy: string;
  readonly searchKey: string;
  readonly retentionKey: string;
  readonly accessKey: string;
}

export interface FhirNativeSearchContract {
  readonly key: string;
  readonly parameters: readonly string[];
  readonly note: string | null;
}

export interface FhirNativeKeyContract {
  readonly key: string;
  readonly contract: string;
}

export interface FhirNativeProfileFamily {
  readonly resourceFamily: string;
  readonly approvedProfileSource: string;
  readonly selectionRule: string;
}

export interface FhirNativeCapabilityScope {
  readonly scope: string;
  readonly requiredInteractions: readonly string[];
  readonly contract: string;
}

export interface FhirNativeChildTask {
  readonly wave: string;
  readonly taskId: string;
  readonly dependsOn: readonly string[];
  readonly deliverable: string;
}

export interface FhirNativeContractRegistry {
  readonly schemaVersion: 1;
  readonly contractId: 'FHIR-NATIVE-P0-FOUNDATION-002-RATCHET';
  readonly confirmedOn: string;
  readonly sourceBaseline: {
    readonly repository: string;
    readonly baseCommit: string;
    readonly trackedPaths: readonly string[];
    readonly build: ArtifactContract<BuildState>;
  };
  readonly standards: {
    readonly fhir: {
      readonly release: 'R4';
      readonly version: '4.0.1';
      readonly source: typeof FHIR_NATIVE_REQUIRED_FHIR_SOURCE;
    };
    readonly jpCore: {
      readonly packageId: 'jpfhir.jp.core';
      readonly version: '1.2.0';
      readonly source: typeof FHIR_NATIVE_REQUIRED_JP_CORE_SOURCE;
      readonly package: ArtifactContract<ArtifactState>;
    };
  };
  readonly customExtensionCount: 0;
  readonly resourceMatrix: readonly FhirNativeResourceContract[];
  readonly searchRegistry: readonly FhirNativeSearchContract[];
  readonly retentionRegistry: readonly FhirNativeKeyContract[];
  readonly accessRegistry: readonly FhirNativeKeyContract[];
  readonly profileFamilies: readonly FhirNativeProfileFamily[];
  readonly capability: {
    readonly external: 'none';
    readonly metadataRoute: '/fhir/r4/metadata';
    readonly scopes: readonly FhirNativeCapabilityScope[];
  };
  readonly childTasks: readonly FhirNativeChildTask[];
  readonly implementationEvidence: {
    readonly schema: {
      readonly path: string;
      readonly enumName: 'ClinicalFhirResourceType';
      readonly values: readonly string[];
      readonly targetGaps: readonly { readonly resourceType: string; readonly enumValue: string }[];
    };
    readonly handwrittenProfileMap: {
      readonly path: string;
      readonly mappings: readonly {
        readonly resourceType: string;
        readonly canonicalUrl: string;
      }[];
    };
    readonly versions: {
      readonly path: string;
      readonly fhirR4: '4.0.1';
      readonly jpCore: '1.2.0';
    };
    readonly fhirRoutes: readonly string[];
  };
}

type JsonObject = Record<string, unknown>;

function contractError(path: string, message: string): never {
  throw new Error(`FHIR native contract ${path}: ${message}`);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return contractError(path, 'expected an object');
  }
  return value as JsonObject;
}

function arrayAt(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return contractError(path, 'expected an array');
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return contractError(path, 'expected a non-empty string');
  }
  return value;
}

function nullableStringAt(value: unknown, path: string): string | null {
  if (value === null) return null;
  return stringAt(value, path);
}

function literalAt<T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) return contractError(path, `expected ${String(expected)}`);
  return expected;
}

function stringArrayAt(value: unknown, path: string): readonly string[] {
  return arrayAt(value, path).map((item, index) => stringAt(item, `${path}[${index}]`));
}

function assertUnique(values: readonly string[], path: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) contractError(path, `duplicate value ${value}`);
    seen.add(value);
  }
}

function isRepositoryRelativePath(value: string) {
  const portable = value.replaceAll('\\', '/');
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable) || portable.includes('\0')) {
    return false;
  }
  const segments = portable.split('/');
  return !segments.includes('..') && !segments.includes('') && portable !== '.';
}

function validateArtifact(
  value: unknown,
  path: string,
  missingState: 'not_pinned' | 'not_built',
  readyState: 'pinned' | 'built',
) {
  const object = objectAt(value, path);
  const status = stringAt(object.status, `${path}.status`);
  if (status !== missingState && status !== readyState) {
    contractError(`${path}.status`, `expected ${missingState} or ${readyState}`);
  }
  const artifactPath = nullableStringAt(object.artifactPath, `${path}.artifactPath`);
  const digest = nullableStringAt(object.sha256, `${path}.sha256`);
  if (status === missingState) {
    if (artifactPath !== null || digest !== null) {
      contractError(path, `${missingState} cannot claim an artifact or digest`);
    }
    return;
  }
  if (artifactPath === null || digest === null || !/^[0-9a-f]{64}$/.test(digest)) {
    contractError(path, `${readyState} requires an artifact path and SHA-256`);
  }
  if (!isRepositoryRelativePath(artifactPath)) {
    contractError(`${path}.artifactPath`, 'expected a safe repository-relative path');
  }
}

function validateResourceMatrix(root: JsonObject) {
  const rows = arrayAt(root.resourceMatrix, 'resourceMatrix');
  if (rows.length !== 28) contractError('resourceMatrix', 'expected 28 rows');
  const searchKeyValues = arrayAt(root.searchRegistry, 'searchRegistry').map((item, index) =>
    stringAt(objectAt(item, `searchRegistry[${index}]`).key, `searchRegistry[${index}].key`),
  );
  const retentionKeyValues = arrayAt(root.retentionRegistry, 'retentionRegistry').map(
    (item, index) =>
      stringAt(
        objectAt(item, `retentionRegistry[${index}]`).key,
        `retentionRegistry[${index}].key`,
      ),
  );
  const accessKeyValues = arrayAt(root.accessRegistry, 'accessRegistry').map((item, index) =>
    stringAt(objectAt(item, `accessRegistry[${index}]`).key, `accessRegistry[${index}].key`),
  );
  assertUnique(searchKeyValues, 'searchRegistry');
  assertUnique(retentionKeyValues, 'retentionRegistry');
  assertUnique(accessKeyValues, 'accessRegistry');
  const searchKeys = new Set(searchKeyValues);
  const retentionKeys = new Set(retentionKeyValues);
  const accessKeys = new Set(accessKeyValues);

  const resourceTypes: string[] = [];
  for (const [index, item] of rows.entries()) {
    const path = `resourceMatrix[${index}]`;
    const row = objectAt(item, path);
    const resourceType = stringAt(row.resourceType, `${path}.resourceType`);
    resourceTypes.push(resourceType);
    stringAt(row.legacyInventory, `${path}.legacyInventory`);
    stringAt(row.nativeTarget, `${path}.nativeTarget`);
    stringAt(row.authoritativeServer, `${path}.authoritativeServer`);
    stringArrayAt(row.nativeInteractions, `${path}.nativeInteractions`);
    stringAt(row.profilePolicy, `${path}.profilePolicy`);
    const searchKey = stringAt(row.searchKey, `${path}.searchKey`);
    const retentionKey = stringAt(row.retentionKey, `${path}.retentionKey`);
    const accessKey = stringAt(row.accessKey, `${path}.accessKey`);
    if (!searchKeys.has(searchKey)) contractError(`${path}.searchKey`, `unknown key ${searchKey}`);
    if (!retentionKeys.has(retentionKey)) {
      contractError(`${path}.retentionKey`, `unknown key ${retentionKey}`);
    }
    if (!accessKeys.has(accessKey)) contractError(`${path}.accessKey`, `unknown key ${accessKey}`);
  }
  assertUnique(resourceTypes, 'resourceMatrix.resourceType');

  const careTeamIndex = resourceTypes.indexOf('CareTeam');
  if (careTeamIndex < 0) contractError('resourceMatrix', 'CareTeam row is missing');
  const careTeam = objectAt(rows[careTeamIndex], `resourceMatrix[${careTeamIndex}]`);
  if (
    careTeam.nativeTarget !== 'UNRESOLVED' ||
    careTeam.searchKey !== 'S-NONE' ||
    careTeam.retentionKey !== 'R-QUARANTINE' ||
    careTeam.accessKey !== 'A-QUARANTINE'
  ) {
    contractError('resourceMatrix.CareTeam', 'must remain unresolved and quarantined');
  }
}

function validateSearchRegistry(value: unknown) {
  const rows = arrayAt(value, 'searchRegistry');
  if (rows.length !== 25) contractError('searchRegistry', 'expected 25 rows');
  const keys = rows.map((item, index) => {
    const row = objectAt(item, `searchRegistry[${index}]`);
    const key = stringAt(row.key, `searchRegistry[${index}].key`);
    stringArrayAt(row.parameters, `searchRegistry[${index}].parameters`);
    nullableStringAt(row.note, `searchRegistry[${index}].note`);
    return key;
  });
  assertUnique(keys, 'searchRegistry.key');
}

function validateKeyRegistry(
  value: unknown,
  path: 'retentionRegistry' | 'accessRegistry',
  expectedRows: number,
) {
  const rows = arrayAt(value, path);
  if (rows.length !== expectedRows) contractError(path, `expected ${expectedRows} rows`);
  const keys = rows.map((item, index) => {
    const row = objectAt(item, `${path}[${index}]`);
    stringAt(row.contract, `${path}[${index}].contract`);
    return stringAt(row.key, `${path}[${index}].key`);
  });
  assertUnique(keys, `${path}.key`);
}

function validateProfileFamilies(value: unknown) {
  const rows = arrayAt(value, 'profileFamilies');
  if (rows.length !== 9) contractError('profileFamilies', 'expected 9 rows');
  rows.forEach((item, index) => {
    const row = objectAt(item, `profileFamilies[${index}]`);
    stringAt(row.resourceFamily, `profileFamilies[${index}].resourceFamily`);
    stringAt(row.approvedProfileSource, `profileFamilies[${index}].approvedProfileSource`);
    stringAt(row.selectionRule, `profileFamilies[${index}].selectionRule`);
  });
}

function validateCapabilityScopes(value: unknown) {
  const rows = arrayAt(value, 'capability.scopes');
  if (rows.length !== 5) contractError('capability.scopes', 'expected 5 rows');
  const scopes = rows.map((item, index) => {
    const row = objectAt(item, `capability.scopes[${index}]`);
    stringArrayAt(row.requiredInteractions, `capability.scopes[${index}].requiredInteractions`);
    stringAt(row.contract, `capability.scopes[${index}].contract`);
    return stringAt(row.scope, `capability.scopes[${index}].scope`);
  });
  assertUnique(scopes, 'capability.scopes.scope');
}

function validateChildTasks(value: unknown) {
  const rows = arrayAt(value, 'childTasks');
  if (rows.length !== 27) contractError('childTasks', 'expected 27 rows');
  const tasks = rows.map((item, index) => {
    const path = `childTasks[${index}]`;
    const row = objectAt(item, path);
    return {
      wave: stringAt(row.wave, `${path}.wave`),
      taskId: stringAt(row.taskId, `${path}.taskId`),
      dependsOn: stringArrayAt(row.dependsOn, `${path}.dependsOn`),
      deliverable: stringAt(row.deliverable, `${path}.deliverable`),
    };
  });
  assertUnique(
    tasks.map((task) => task.wave),
    'childTasks.wave',
  );
  assertUnique(
    tasks.map((task) => task.taskId),
    'childTasks.taskId',
  );
  const byWave = new Map(tasks.map((task) => [task.wave, task]));
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(task: (typeof tasks)[number]) {
    if (visiting.has(task.taskId))
      contractError('childTasks', `dependency cycle at ${task.taskId}`);
    if (visited.has(task.taskId)) return;
    visiting.add(task.taskId);
    for (const dependency of task.dependsOn) {
      const target = dependency.includes('FHIR-NATIVE-')
        ? byId.get(dependency)
        : byWave.get(dependency);
      if (!target) contractError('childTasks', `unknown dependency ${dependency}`);
      visit(target);
    }
    visiting.delete(task.taskId);
    visited.add(task.taskId);
  }
  tasks.forEach(visit);
}

function validateImplementationEvidence(value: unknown) {
  const evidence = objectAt(value, 'implementationEvidence');
  const schema = objectAt(evidence.schema, 'implementationEvidence.schema');
  literalAt(schema.enumName, 'ClinicalFhirResourceType', 'implementationEvidence.schema.enumName');
  stringAt(schema.path, 'implementationEvidence.schema.path');
  assertUnique(
    [...stringArrayAt(schema.values, 'implementationEvidence.schema.values')],
    'implementationEvidence.schema.values',
  );
  const gaps = arrayAt(schema.targetGaps, 'implementationEvidence.schema.targetGaps').map(
    (item, index) => {
      const row = objectAt(item, `implementationEvidence.schema.targetGaps[${index}]`);
      return {
        resourceType: stringAt(
          row.resourceType,
          `implementationEvidence.schema.targetGaps[${index}].resourceType`,
        ),
        enumValue: stringAt(
          row.enumValue,
          `implementationEvidence.schema.targetGaps[${index}].enumValue`,
        ),
      };
    },
  );
  const expectedGaps = ['binary', 'detected_issue', 'location', 'questionnaire_response'];
  const actualGaps = gaps.map((gap) => gap.enumValue).sort();
  if (actualGaps.join('|') !== expectedGaps.join('|')) {
    contractError('implementationEvidence.schema.targetGaps', 'unexpected target gaps');
  }

  const profileMap = objectAt(
    evidence.handwrittenProfileMap,
    'implementationEvidence.handwrittenProfileMap',
  );
  stringAt(profileMap.path, 'implementationEvidence.handwrittenProfileMap.path');
  const mappings = arrayAt(
    profileMap.mappings,
    'implementationEvidence.handwrittenProfileMap.mappings',
  );
  if (mappings.length !== 4) {
    contractError('implementationEvidence.handwrittenProfileMap.mappings', 'expected 4 rows');
  }
  mappings.forEach((item, index) => {
    const row = objectAt(item, `implementationEvidence.handwrittenProfileMap.mappings[${index}]`);
    stringAt(
      row.resourceType,
      `implementationEvidence.handwrittenProfileMap.mappings[${index}].resourceType`,
    );
    stringAt(
      row.canonicalUrl,
      `implementationEvidence.handwrittenProfileMap.mappings[${index}].canonicalUrl`,
    );
  });

  const versions = objectAt(evidence.versions, 'implementationEvidence.versions');
  literalAt(versions.fhirR4, '4.0.1', 'implementationEvidence.versions.fhirR4');
  literalAt(versions.jpCore, '1.2.0', 'implementationEvidence.versions.jpCore');
  stringAt(versions.path, 'implementationEvidence.versions.path');
  const routes = stringArrayAt(evidence.fhirRoutes, 'implementationEvidence.fhirRoutes');
  if (routes.length !== 0)
    contractError('implementationEvidence.fhirRoutes', 'expected no live routes');
}

export function parseFhirNativeContractRegistry(value: unknown): FhirNativeContractRegistry {
  const root = objectAt(value, 'root');
  literalAt(root.schemaVersion, 1, 'schemaVersion');
  literalAt(root.contractId, 'FHIR-NATIVE-P0-FOUNDATION-002-RATCHET', 'contractId');
  const confirmedOn = stringAt(root.confirmedOn, 'confirmedOn');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmedOn)) contractError('confirmedOn', 'expected YYYY-MM-DD');

  const sourceBaseline = objectAt(root.sourceBaseline, 'sourceBaseline');
  literalAt(
    sourceBaseline.repository,
    FHIR_NATIVE_REQUIRED_REPOSITORY,
    'sourceBaseline.repository',
  );
  const baseCommit = stringAt(sourceBaseline.baseCommit, 'sourceBaseline.baseCommit');
  if (baseCommit !== FHIR_NATIVE_REQUIRED_BASE_COMMIT) {
    contractError('sourceBaseline.baseCommit', 'must match the approved exact SHA-1');
  }
  const trackedPaths = stringArrayAt(sourceBaseline.trackedPaths, 'sourceBaseline.trackedPaths');
  assertUnique([...trackedPaths], 'sourceBaseline.trackedPaths');
  if (
    trackedPaths.length !== FHIR_NATIVE_REQUIRED_SOURCE_PATHS.length ||
    trackedPaths.some(
      (trackedPath, index) => trackedPath !== FHIR_NATIVE_REQUIRED_SOURCE_PATHS[index],
    )
  ) {
    contractError('sourceBaseline.trackedPaths', 'must exactly match approved source coverage');
  }
  for (const trackedPath of trackedPaths) {
    if (!isRepositoryRelativePath(trackedPath)) {
      contractError(
        'sourceBaseline.trackedPaths',
        `unsafe repository-relative path ${trackedPath}`,
      );
    }
  }
  validateArtifact(sourceBaseline.build, 'sourceBaseline.build', 'not_built', 'built');

  const standards = objectAt(root.standards, 'standards');
  const fhir = objectAt(standards.fhir, 'standards.fhir');
  literalAt(fhir.release, 'R4', 'standards.fhir.release');
  literalAt(fhir.version, '4.0.1', 'standards.fhir.version');
  literalAt(fhir.source, FHIR_NATIVE_REQUIRED_FHIR_SOURCE, 'standards.fhir.source');
  const jpCore = objectAt(standards.jpCore, 'standards.jpCore');
  literalAt(jpCore.packageId, 'jpfhir.jp.core', 'standards.jpCore.packageId');
  literalAt(jpCore.version, '1.2.0', 'standards.jpCore.version');
  literalAt(jpCore.source, FHIR_NATIVE_REQUIRED_JP_CORE_SOURCE, 'standards.jpCore.source');
  validateArtifact(jpCore.package, 'standards.jpCore.package', 'not_pinned', 'pinned');

  literalAt(root.customExtensionCount, 0, 'customExtensionCount');
  validateSearchRegistry(root.searchRegistry);
  validateKeyRegistry(root.retentionRegistry, 'retentionRegistry', 8);
  validateKeyRegistry(root.accessRegistry, 'accessRegistry', 11);
  validateResourceMatrix(root);
  validateProfileFamilies(root.profileFamilies);

  const capability = objectAt(root.capability, 'capability');
  literalAt(capability.external, 'none', 'capability.external');
  literalAt(capability.metadataRoute, '/fhir/r4/metadata', 'capability.metadataRoute');
  validateCapabilityScopes(capability.scopes);

  validateChildTasks(root.childTasks);
  validateImplementationEvidence(root.implementationEvidence);
  return value as FhirNativeContractRegistry;
}

export const FHIR_NATIVE_CONTRACT_REGISTRY = parseFhirNativeContractRegistry(registryJson);
