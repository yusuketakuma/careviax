#!/usr/bin/env node
// Fail-closed FHIR native contract ratchet (FHIR-NATIVE-P0-FOUNDATION-002-RATCHET).
//
// The committed registry pins the approved A0 contract and the current legacy
// implementation evidence. Source/build manifests are generated dynamically so
// their digest never includes itself and remains reproducible for the same tree.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTRACT_PATH = 'src/server/fhir/native-contract-registry.json';
const ARCHITECTURE_PATH = 'docs/architecture/fhir-first-prescription-platform.md';
const PLANS_PATH = 'Plans.md';
const SCHEMA_PATH = 'prisma/schema/standard-clinical-integration.prisma';
const ADAPTER_PATH = 'src/server/adapters/fhir/index.ts';
const PROFILE_MAP_PATH = 'src/server/services/standard-clinical-fhir-validation.ts';
const PACKAGE_PATH = 'package.json';
const CI_PATH = '.github/workflows/ci.yml';
const REQUIRED_REPOSITORY = 'https://github.com/yusuketakuma/careviax.git';
const REQUIRED_BASE_COMMIT = '8d1205539c75d3acb9d242365f781c960074d21b';
const REQUIRED_FHIR_SOURCE = 'https://hl7.org/fhir/R4/';
const REQUIRED_JP_CORE_SOURCE = 'https://jpfhir.jp/fhir/core/1.2.0/';

const EXPECTED_COUNTS = Object.freeze({
  resources: 28,
  searchKeys: 25,
  retentionKeys: 8,
  accessKeys: 11,
  profileFamilies: 9,
  capabilityScopes: 5,
  childTasks: 27,
});

const REQUIRED_TRACKED_PATHS = Object.freeze([
  '.github/workflows/ci.yml',
  'Plans.md',
  'docs/architecture/README.md',
  ARCHITECTURE_PATH,
  'docs/decisions.md',
  'docs/phase5-cutover-strategy.md',
  PACKAGE_PATH,
  'pnpm-lock.yaml',
  SCHEMA_PATH,
  ADAPTER_PATH,
  PROFILE_MAP_PATH,
  CONTRACT_PATH,
  'src/server/fhir/native-contract.ts',
  'src/server/fhir/native-contract.test.ts',
  'tools/scripts/check-fhir-native-contract.mjs',
  'tools/scripts/check-fhir-native-contract.test.ts',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function canonicalGitHubRepositoryIdentity(value) {
  invariant(typeof value === 'string' && value.length > 0, 'source manifest: empty origin URL');
  const scpMatch = value.match(/^git@github\.com:([^/]+)\/([^/]+?)\/?$/i);
  let owner;
  let repository;
  if (scpMatch) {
    owner = scpMatch[1];
    repository = scpMatch[2];
  } else {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('source manifest: origin must be a GitHub HTTPS or SSH repository URL');
    }
    invariant(
      parsed.protocol === 'https:' &&
        parsed.hostname.toLowerCase() === 'github.com' &&
        parsed.port === '' &&
        parsed.username === '' &&
        parsed.password === '' &&
        parsed.search === '' &&
        parsed.hash === '',
      'source manifest: origin must be a GitHub HTTPS or SSH repository URL',
    );
    const segments = parsed.pathname.split('/').filter(Boolean);
    invariant(
      segments.length === 2,
      'source manifest: origin must pin one GitHub owner/repository',
    );
    [owner, repository] = segments;
  }
  repository = repository.replace(/\.git$/i, '');
  invariant(
    /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(repository),
    'source manifest: invalid GitHub owner/repository',
  );
  return `github.com/${owner.toLowerCase()}/${repository.toLowerCase()}`;
}

function readUtf8(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  invariant(existsSync(absolutePath), `${relativePath}: required file is missing`);
  return readFileSync(absolutePath, 'utf8');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function assertDeepEqual(actual, expected, label) {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(`${label}: registry drift detected`);
  }
}

function verifyOfficialStandardLinks(markdown) {
  invariant(
    markdown.includes(`[FHIR R4 4.0.1](${REQUIRED_FHIR_SOURCE})`),
    `${ARCHITECTURE_PATH}: exact FHIR R4 official source link missing`,
  );
  invariant(
    markdown.includes(`[\`jpfhir.jp.core#1.2.0\`](${REQUIRED_JP_CORE_SOURCE})`),
    `${ARCHITECTURE_PATH}: exact JP Core official source link missing`,
  );
}

function stripInlineMarkdown(value) {
  return value
    .trim()
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function tableAfterHeading(markdown, heading, sourcePath = ARCHITECTURE_PATH) {
  const headingOffset = markdown.indexOf(`${heading}\n`);
  invariant(headingOffset >= 0, `${sourcePath}: heading not found: ${heading}`);
  const lines = markdown.slice(headingOffset + heading.length + 1).split('\n');
  const firstRow = lines.findIndex((line) => line.trim().startsWith('|'));
  invariant(firstRow >= 0, `${sourcePath}: table not found after ${heading}`);

  const tableLines = [];
  for (const line of lines.slice(firstRow)) {
    if (!line.trim().startsWith('|')) break;
    tableLines.push(line);
  }
  invariant(tableLines.length >= 3, `${sourcePath}: malformed table after ${heading}`);

  const headers = splitMarkdownRow(tableLines[0]);
  const separator = splitMarkdownRow(tableLines[1]);
  invariant(
    separator.length === headers.length && separator.every((cell) => /^:?-{3,}:?$/.test(cell)),
    `${sourcePath}: malformed table separator after ${heading}`,
  );

  return tableLines.slice(2).map((line, index) => {
    const cells = splitMarkdownRow(line);
    invariant(
      cells.length === headers.length,
      `${sourcePath}: row ${index + 1} after ${heading} has ${cells.length} cells; expected ${headers.length}`,
    );
    return Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]]));
  });
}

function splitList(value) {
  const normalized = stripInlineMarkdown(value);
  if (normalized === '' || normalized === 'none') return [];
  return normalized
    .split(/\s*[,;]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function deriveDocumentContract(markdown) {
  const resourceMatrix = tableAfterHeading(markdown, '## 5. Resource Inventory').map((row) => ({
    resourceType: stripInlineMarkdown(row.Resource),
    legacyInventory: stripInlineMarkdown(row['Legacy inventory']),
    nativeTarget: stripInlineMarkdown(row['Native target']),
    authoritativeServer: stripInlineMarkdown(row['Authoritative server']),
    nativeInteractions: splitList(row['Native interaction']),
    profilePolicy: stripInlineMarkdown(row['Profile policy / note']),
    searchKey: stripInlineMarkdown(row.Search),
    retentionKey: stripInlineMarkdown(row.Retention),
    accessKey: stripInlineMarkdown(row['Consent / purpose']),
  }));

  const searchRegistry = tableAfterHeading(markdown, '### 5.1 Search key registry').map((row) => {
    const key = stripInlineMarkdown(row.Key);
    const contract = stripInlineMarkdown(row['Approved indexed parameters']);
    if (key === 'S-NONE') return { key, parameters: [], note: contract };
    const [parameterText, ...noteParts] = contract.split(';');
    return {
      key,
      parameters: splitList(parameterText),
      note: noteParts.length > 0 ? noteParts.join(';').trim() : null,
    };
  });

  const retentionRegistry = tableAfterHeading(markdown, '### 5.2 Retention key registry').map(
    (row) => ({
      key: stripInlineMarkdown(row.Key),
      contract: stripInlineMarkdown(row['Retention contract']),
    }),
  );

  const accessRegistry = tableAfterHeading(markdown, '### 5.3 Consent / purpose key registry').map(
    (row) => ({
      key: stripInlineMarkdown(row.Key),
      contract: stripInlineMarkdown(row['Consent / purpose contract']),
    }),
  );

  const profileFamilies = tableAfterHeading(markdown, '### 6.1 Profile families').map((row) => ({
    resourceFamily: stripInlineMarkdown(row['Resource family']),
    approvedProfileSource: stripInlineMarkdown(row['Approved profile source']),
    selectionRule: stripInlineMarkdown(row['Selection rule']),
  }));

  const capabilityScopes = tableAfterHeading(markdown, '### 11.2 CapabilityStatement draft').map(
    (row) => ({
      scope: stripInlineMarkdown(row.Scope),
      requiredInteractions: splitList(row['Required interaction']),
      contract: stripInlineMarkdown(row.Contract),
    }),
  );

  const childTasks = tableAfterHeading(markdown, '## 18. Execution Child Task Graph').map(
    (row) => ({
      wave: stripInlineMarkdown(row.Wave),
      taskId: stripInlineMarkdown(row['Child task']),
      dependsOn: splitList(row['Depends on']).map((dependency) =>
        dependency.replace(/^approved\s+/, ''),
      ),
      deliverable: stripInlineMarkdown(row['Deliverable / exit gate']),
    }),
  );

  return {
    resourceMatrix,
    searchRegistry,
    retentionRegistry,
    accessRegistry,
    profileFamilies,
    capabilityScopes,
    childTasks,
  };
}

function extractEnumValues(source, enumName) {
  const match = source.match(new RegExp(`enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\}`));
  invariant(match, `${SCHEMA_PATH}: enum ${enumName} was not found`);
  return match[1]
    .split('\n')
    .map(
      (line) =>
        line
          .replace(/\/\/.*$/, '')
          .trim()
          .split(/\s+/)[0],
    )
    .filter(Boolean);
}

function extractProfileMap(source) {
  const mappings = [];
  for (const match of source.matchAll(
    /\[ClinicalFhirResourceType\.([a-z_]+)\]\s*:\s*['"]([^'"]+)['"]/g,
  )) {
    mappings.push({ resourceType: match[1], canonicalUrl: match[2] });
  }
  return mappings.sort((left, right) => left.resourceType.localeCompare(right.resourceType));
}

function extractVersion(source, name, relativePath) {
  const match = source.match(new RegExp(`export const ${name} = ['"]([^'"]+)['"]`));
  invariant(match, `${relativePath}: ${name} was not found`);
  return match[1];
}

function walkFiles(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];
  const stack = [absoluteRoot];
  const files = [];
  while (stack.length > 0) {
    const current = stack.pop();
    const stats = lstatSync(current);
    if (stats.isDirectory()) {
      for (const child of readdirSync(current)) stack.push(path.join(current, child));
      continue;
    }
    if (stats.isFile()) files.push(path.relative(root, current).split(path.sep).join('/'));
  }
  return files.sort();
}

function isFhirR4Path(relativePath) {
  const segments = relativePath
    .split('/')
    .map((segment) => segment.replace(/\.(?:ts|tsx|js|jsx|mjs)$/, ''))
    .filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith('@'));
  return segments.some((segment, index) => segment === 'fhir' && segments[index + 1] === 'r4');
}

function walkRouteFiles(root) {
  const appRoutes = walkFiles(root, 'src/app').filter(
    (relativePath) =>
      /^route\.(?:ts|tsx|js|mjs)$/.test(path.basename(relativePath)) && isFhirR4Path(relativePath),
  );
  const pagesRoutes = walkFiles(root, 'src/pages').filter(
    (relativePath) =>
      /\.(?:ts|tsx|js|jsx|mjs)$/.test(relativePath) &&
      !/\.(?:test|spec)\.[^.]+$/.test(relativePath) &&
      isFhirR4Path(relativePath),
  );
  return [...appRoutes, ...pagesRoutes].sort();
}

function resourceTypeToEnum(resourceType) {
  return resourceType.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function deriveImplementationEvidence(root, documentContract) {
  const enumValues = extractEnumValues(readUtf8(root, SCHEMA_PATH), 'ClinicalFhirResourceType');
  const resourceEnumCandidates = documentContract.resourceMatrix.map((row) => ({
    resourceType: row.resourceType,
    enumValue: resourceTypeToEnum(row.resourceType),
  }));
  const enumSet = new Set(enumValues);
  const targetGaps = resourceEnumCandidates.filter(
    (candidate) => !enumSet.has(candidate.enumValue),
  );

  return {
    schema: {
      path: SCHEMA_PATH,
      enumName: 'ClinicalFhirResourceType',
      values: enumValues,
      targetGaps,
    },
    handwrittenProfileMap: {
      path: PROFILE_MAP_PATH,
      mappings: extractProfileMap(readUtf8(root, PROFILE_MAP_PATH)),
    },
    versions: {
      path: ADAPTER_PATH,
      fhirR4: extractVersion(readUtf8(root, ADAPTER_PATH), 'FHIR_R4_VERSION', ADAPTER_PATH),
      jpCore: extractVersion(readUtf8(root, ADAPTER_PATH), 'JP_CORE_VERSION', ADAPTER_PATH),
    },
    fhirRoutes: walkRouteFiles(root),
  };
}

function assertUnique(items, keyOf, label) {
  const seen = new Set();
  for (const item of items) {
    const key = keyOf(item);
    invariant(typeof key === 'string' && key.length > 0, `${label}: empty key`);
    invariant(!seen.has(key), `${label}: duplicate key ${key}`);
    seen.add(key);
  }
}

function isRepositoryRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  const portable = value.replaceAll('\\', '/');
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable)) return false;
  const segments = portable.split('/');
  return !segments.includes('..') && !segments.includes('') && portable !== '.';
}

function assertChildGraph(childTasks) {
  const ids = new Set(childTasks.map((task) => task.taskId));
  const byId = new Map(childTasks.map((task) => [task.taskId, task]));
  for (const task of childTasks) {
    for (const dependency of task.dependsOn) {
      const dependencyId = dependency.includes('FHIR-NATIVE-')
        ? dependency
        : childTasks.find((candidate) => candidate.wave === dependency)?.taskId;
      invariant(
        dependencyId && ids.has(dependencyId),
        `childTasks: unknown dependency ${dependency}`,
      );
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(task) {
    invariant(!visiting.has(task.taskId), `childTasks: dependency cycle at ${task.taskId}`);
    if (visited.has(task.taskId)) return;
    visiting.add(task.taskId);
    for (const dependency of task.dependsOn) {
      const dependencyTask = dependency.includes('FHIR-NATIVE-')
        ? byId.get(dependency)
        : childTasks.find((candidate) => candidate.wave === dependency);
      invariant(dependencyTask, `childTasks: unknown dependency ${dependency}`);
      visit(dependencyTask);
    }
    visiting.delete(task.taskId);
    visited.add(task.taskId);
  }
  for (const task of childTasks) visit(task);
}

function validateRegistry(registry) {
  invariant(registry && typeof registry === 'object', `${CONTRACT_PATH}: expected an object`);
  invariant(registry.schemaVersion === 1, `${CONTRACT_PATH}: unsupported schemaVersion`);
  invariant(
    registry.contractId === 'FHIR-NATIVE-P0-FOUNDATION-002-RATCHET',
    `${CONTRACT_PATH}: unexpected contractId`,
  );
  invariant(
    registry.standards?.fhir?.release === 'R4',
    `${CONTRACT_PATH}: FHIR release must be R4`,
  );
  invariant(registry.standards.fhir.version === '4.0.1', `${CONTRACT_PATH}: FHIR version drift`);
  invariant(
    registry.standards.fhir.source === REQUIRED_FHIR_SOURCE,
    `${CONTRACT_PATH}: FHIR source drift`,
  );
  invariant(
    registry.standards?.jpCore?.packageId === 'jpfhir.jp.core' &&
      registry.standards.jpCore.version === '1.2.0',
    `${CONTRACT_PATH}: JP Core package/version drift`,
  );
  invariant(
    registry.standards.jpCore.source === REQUIRED_JP_CORE_SOURCE,
    `${CONTRACT_PATH}: JP Core source drift`,
  );

  const countEntries = [
    ['resourceMatrix', registry.resourceMatrix, EXPECTED_COUNTS.resources],
    ['searchRegistry', registry.searchRegistry, EXPECTED_COUNTS.searchKeys],
    ['retentionRegistry', registry.retentionRegistry, EXPECTED_COUNTS.retentionKeys],
    ['accessRegistry', registry.accessRegistry, EXPECTED_COUNTS.accessKeys],
    ['profileFamilies', registry.profileFamilies, EXPECTED_COUNTS.profileFamilies],
    ['capability.scopes', registry.capability?.scopes, EXPECTED_COUNTS.capabilityScopes],
    ['childTasks', registry.childTasks, EXPECTED_COUNTS.childTasks],
  ];
  for (const [label, items, expected] of countEntries) {
    invariant(Array.isArray(items), `${CONTRACT_PATH}: ${label} must be an array`);
    invariant(items.length === expected, `${CONTRACT_PATH}: ${label} expected ${expected} rows`);
  }

  assertUnique(registry.resourceMatrix, (item) => item.resourceType, 'resourceMatrix');
  assertUnique(registry.searchRegistry, (item) => item.key, 'searchRegistry');
  assertUnique(registry.retentionRegistry, (item) => item.key, 'retentionRegistry');
  assertUnique(registry.accessRegistry, (item) => item.key, 'accessRegistry');
  assertUnique(registry.childTasks, (item) => item.taskId, 'childTasks');
  assertUnique(registry.childTasks, (item) => item.wave, 'childTasks.wave');

  const searchKeys = new Set(registry.searchRegistry.map((item) => item.key));
  const retentionKeys = new Set(registry.retentionRegistry.map((item) => item.key));
  const accessKeys = new Set(registry.accessRegistry.map((item) => item.key));
  for (const resource of registry.resourceMatrix) {
    invariant(
      searchKeys.has(resource.searchKey),
      `resourceMatrix: unknown searchKey ${resource.searchKey}`,
    );
    invariant(
      retentionKeys.has(resource.retentionKey),
      `resourceMatrix: unknown retentionKey ${resource.retentionKey}`,
    );
    invariant(
      accessKeys.has(resource.accessKey),
      `resourceMatrix: unknown accessKey ${resource.accessKey}`,
    );
  }

  const careTeam = registry.resourceMatrix.find((item) => item.resourceType === 'CareTeam');
  invariant(
    careTeam?.nativeTarget === 'UNRESOLVED',
    'resourceMatrix: CareTeam must remain UNRESOLVED',
  );
  invariant(
    careTeam?.searchKey === 'S-NONE',
    'resourceMatrix: CareTeam search must remain disabled',
  );
  invariant(
    careTeam?.retentionKey === 'R-QUARANTINE' && careTeam?.accessKey === 'A-QUARANTINE',
    'resourceMatrix: CareTeam must remain quarantined',
  );

  invariant(
    registry.capability.external === 'none',
    'capability: external must remain none before routes exist',
  );
  invariant(
    registry.capability.metadataRoute === '/fhir/r4/metadata',
    'capability: unexpected metadata route',
  );
  invariant(
    registry.customExtensionCount === 0,
    'customExtensionCount: unapproved custom extension',
  );
  assertChildGraph(registry.childTasks);

  invariant(
    Array.isArray(registry.sourceBaseline?.trackedPaths),
    'sourceBaseline.trackedPaths missing',
  );
  assertUnique(registry.sourceBaseline.trackedPaths, (item) => item, 'sourceBaseline.trackedPaths');
  assertDeepEqual(
    registry.sourceBaseline.trackedPaths,
    REQUIRED_TRACKED_PATHS,
    'sourceBaseline.trackedPaths',
  );
  for (const trackedPath of registry.sourceBaseline.trackedPaths) {
    invariant(
      isRepositoryRelativePath(trackedPath),
      `sourceBaseline.trackedPaths: unsafe repository-relative path ${trackedPath}`,
    );
  }
  invariant(
    registry.sourceBaseline.baseCommit === REQUIRED_BASE_COMMIT,
    'sourceBaseline.baseCommit must match the approved exact SHA-1',
  );
  invariant(
    registry.sourceBaseline.repository === REQUIRED_REPOSITORY,
    'sourceBaseline.repository drift',
  );

  const packageLock = registry.standards.jpCore.package;
  invariant(
    packageLock?.status === 'not_pinned' || packageLock?.status === 'pinned',
    'standards.jpCore.package: invalid status',
  );
  if (packageLock.status === 'not_pinned') {
    invariant(
      packageLock.artifactPath === null && packageLock.sha256 === null,
      'standards.jpCore.package: not_pinned must not claim an artifact or digest',
    );
  } else {
    invariant(
      isRepositoryRelativePath(packageLock.artifactPath) &&
        /^[0-9a-f]{64}$/.test(packageLock.sha256),
      'standards.jpCore.package: pinned requires path and SHA-256',
    );
  }

  const build = registry.sourceBaseline.build;
  invariant(
    build?.status === 'not_built' || build?.status === 'built',
    'sourceBaseline.build: invalid status',
  );
  if (build.status === 'not_built') {
    invariant(
      build.artifactPath === null && build.sha256 === null,
      'sourceBaseline.build: not_built must not claim an artifact or digest',
    );
  } else {
    invariant(
      isRepositoryRelativePath(build.artifactPath) && /^[0-9a-f]{64}$/.test(build.sha256),
      'sourceBaseline.build: built requires path and SHA-256',
    );
  }

  return registry;
}

function verifyArtifact(root, record, label) {
  if (record.status === 'not_pinned' || record.status === 'not_built') return;
  const absolutePath = path.join(root, record.artifactPath);
  invariant(existsSync(absolutePath), `${label}: artifact is missing: ${record.artifactPath}`);
  const actualDigest = sha256(readFileSync(absolutePath));
  invariant(
    actualDigest === record.sha256,
    `${label}: SHA-256 mismatch for ${record.artifactPath}`,
  );
}

function verifyPlans(plans, childTasks) {
  const planGraph = tableAfterHeading(
    plans,
    '**FHIR Native child execution registry — PR-sized active tasks（2026-07-15）**:',
    PLANS_PATH,
  ).map((row) => ({
    wave: stripInlineMarkdown(row.Wave),
    taskId: stripInlineMarkdown(row.ID),
    dependsOn: splitList(row['Depends on']).map((dependency) =>
      dependency.replace(/^approved\s+/, ''),
    ),
  }));
  const registryGraph = childTasks.map(({ wave, taskId, dependsOn }) => ({
    wave,
    taskId,
    dependsOn,
  }));
  assertDeepEqual(planGraph, registryGraph, `${PLANS_PATH} child graph`);
}

function verifyWiring(root) {
  const packageJson = JSON.parse(readUtf8(root, PACKAGE_PATH));
  invariant(
    packageJson.scripts?.['fhir-native-contract:check'] ===
      'node tools/scripts/check-fhir-native-contract.mjs',
    `${PACKAGE_PATH}: fhir-native-contract:check script missing or changed`,
  );
  const ci = readUtf8(root, CI_PATH);
  invariant(
    ci.includes('- name: FHIR native contract check') &&
      ci.includes('run: pnpm fhir-native-contract:check'),
    `${CI_PATH}: FHIR native contract CI step missing or changed`,
  );
}

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fileMode(absolutePath) {
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink()) return '120000';
  return stats.mode & 0o111 ? '100755' : '100644';
}

function baseFile(root, baseCommit, relativePath) {
  const modeLine = git(root, ['ls-tree', baseCommit, '--', relativePath]).trim();
  if (modeLine === '') return { mode: null, sha256: null };
  const content = git(root, ['show', `${baseCommit}:${relativePath}`], { encoding: 'buffer' });
  return {
    mode: modeLine.split(/\s+/)[0],
    sha256: sha256(content),
  };
}

function dirtyEntries(root) {
  const records = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    .split('\0')
    .filter(Boolean);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    const entry = { status, path: record.slice(3) };
    if (status.includes('R') || status.includes('C')) {
      invariant(index + 1 < records.length, 'source manifest: malformed rename/copy status');
      entry.originalPath = records[index + 1];
      index += 1;
    }
    entries.push(entry);
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function buildSourceManifest(root, registry, registrySource) {
  const baseCommit = registry.sourceBaseline.baseCommit;
  try {
    git(root, ['cat-file', '-e', `${baseCommit}^{commit}`]);
    git(root, ['merge-base', '--is-ancestor', baseCommit, 'HEAD']);
  } catch {
    throw new Error(
      `sourceBaseline.baseCommit is missing or is not an ancestor of HEAD: ${baseCommit}`,
    );
  }

  const observedOrigin = git(root, ['remote', 'get-url', 'origin']).trim();
  const repositoryIdentity = canonicalGitHubRepositoryIdentity(observedOrigin);
  invariant(
    repositoryIdentity === canonicalGitHubRepositoryIdentity(registry.sourceBaseline.repository),
    'source manifest: origin repository identity drift',
  );
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const branch = git(root, ['branch', '--show-current']).trim();
  const dirty = dirtyEntries(root);
  const trackedPathSet = new Set(registry.sourceBaseline.trackedPaths);

  const files = registry.sourceBaseline.trackedPaths.map((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    const base = baseFile(root, baseCommit, relativePath);
    if (!existsSync(absolutePath)) {
      return { path: relativePath, base, target: { mode: null, sha256: null } };
    }
    return {
      path: relativePath,
      base,
      target: {
        mode: fileMode(absolutePath),
        sha256: sha256(readFileSync(absolutePath)),
      },
    };
  });

  const manifest = {
    schemaVersion: 1,
    repository: registry.sourceBaseline.repository,
    repositoryIdentity,
    baseCommit,
    head,
    branch,
    dirty,
    dirtyPaths: dirty.map((entry) => entry.path),
    includedDirtyPaths: dirty
      .map((entry) => entry.path)
      .filter((relativePath) => trackedPathSet.has(relativePath)),
    excludedDirtyPaths: dirty
      .map((entry) => entry.path)
      .filter((relativePath) => !trackedPathSet.has(relativePath)),
    files,
    registry: { path: CONTRACT_PATH, sha256: sha256(registrySource) },
    package: registry.standards.jpCore.package,
    build: registry.sourceBaseline.build,
  };
  return { ...manifest, manifestSha256: sha256(stableJson(manifest)) };
}

export function buildRegistryTemplate(root = process.cwd()) {
  const markdown = readUtf8(root, ARCHITECTURE_PATH);
  const documentContract = deriveDocumentContract(markdown);
  const implementationEvidence = deriveImplementationEvidence(root, documentContract);
  const confirmedOn = markdown.match(/\*\*(\d{4}-\d{2}-\d{2})\*\* に一次資料で確認した/)?.[1];
  invariant(confirmedOn, `${ARCHITECTURE_PATH}: official source confirmation date missing`);
  verifyOfficialStandardLinks(markdown);

  return {
    schemaVersion: 1,
    contractId: 'FHIR-NATIVE-P0-FOUNDATION-002-RATCHET',
    confirmedOn,
    sourceBaseline: {
      repository: REQUIRED_REPOSITORY,
      baseCommit: REQUIRED_BASE_COMMIT,
      trackedPaths: [...REQUIRED_TRACKED_PATHS],
      build: { status: 'not_built', artifactPath: null, sha256: null },
    },
    standards: {
      fhir: {
        release: 'R4',
        version: '4.0.1',
        source: REQUIRED_FHIR_SOURCE,
      },
      jpCore: {
        packageId: 'jpfhir.jp.core',
        version: '1.2.0',
        source: REQUIRED_JP_CORE_SOURCE,
        package: { status: 'not_pinned', artifactPath: null, sha256: null },
      },
    },
    customExtensionCount: 0,
    resourceMatrix: documentContract.resourceMatrix,
    searchRegistry: documentContract.searchRegistry,
    retentionRegistry: documentContract.retentionRegistry,
    accessRegistry: documentContract.accessRegistry,
    profileFamilies: documentContract.profileFamilies,
    capability: {
      external: 'none',
      metadataRoute: '/fhir/r4/metadata',
      scopes: documentContract.capabilityScopes,
    },
    childTasks: documentContract.childTasks,
    implementationEvidence,
  };
}

export function checkFhirNativeContract({
  root = process.cwd(),
  verifySourceManifest = true,
} = {}) {
  const registrySource = readUtf8(root, CONTRACT_PATH);
  let registry;
  try {
    registry = JSON.parse(registrySource);
  } catch (error) {
    throw new Error(
      `${CONTRACT_PATH}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  validateRegistry(registry);

  const markdown = readUtf8(root, ARCHITECTURE_PATH);
  const documentContract = deriveDocumentContract(markdown);
  assertDeepEqual(documentContract.resourceMatrix, registry.resourceMatrix, 'resourceMatrix');
  assertDeepEqual(documentContract.searchRegistry, registry.searchRegistry, 'searchRegistry');
  assertDeepEqual(
    documentContract.retentionRegistry,
    registry.retentionRegistry,
    'retentionRegistry',
  );
  assertDeepEqual(documentContract.accessRegistry, registry.accessRegistry, 'accessRegistry');
  assertDeepEqual(documentContract.profileFamilies, registry.profileFamilies, 'profileFamilies');
  assertDeepEqual(
    documentContract.capabilityScopes,
    registry.capability.scopes,
    'capability.scopes',
  );
  assertDeepEqual(documentContract.childTasks, registry.childTasks, 'childTasks');

  const confirmedOn = markdown.match(/\*\*(\d{4}-\d{2}-\d{2})\*\* に一次資料で確認した/)?.[1];
  invariant(confirmedOn === registry.confirmedOn, `${ARCHITECTURE_PATH}: confirmation date drift`);
  verifyOfficialStandardLinks(markdown);
  verifyPlans(readUtf8(root, PLANS_PATH), registry.childTasks);

  const evidence = deriveImplementationEvidence(root, documentContract);
  assertDeepEqual(evidence, registry.implementationEvidence, 'implementationEvidence');
  invariant(
    evidence.versions.fhirR4 === registry.standards.fhir.version &&
      evidence.versions.jpCore === registry.standards.jpCore.version,
    'implementationEvidence: adapter version literals drifted from standards',
  );
  invariant(
    registry.capability.external === (evidence.fhirRoutes.length === 0 ? 'none' : 'live'),
    'capability: external claim does not match live FHIR routes',
  );

  verifyArtifact(root, registry.standards.jpCore.package, 'standards.jpCore.package');
  verifyArtifact(root, registry.sourceBaseline.build, 'sourceBaseline.build');
  verifyWiring(root);

  const manifest = verifySourceManifest
    ? buildSourceManifest(root, registry, registrySource)
    : null;
  return {
    counts: {
      resources: registry.resourceMatrix.length,
      searchKeys: registry.searchRegistry.length,
      childTasks: registry.childTasks.length,
      liveRoutes: evidence.fhirRoutes.length,
    },
    manifest,
  };
}

function runCli() {
  const args = new Set(process.argv.slice(2));
  const supported = new Set(['--emit-registry-template', '--manifest-json']);
  for (const arg of args) invariant(supported.has(arg), `unknown argument: ${arg}`);

  if (args.has('--emit-registry-template')) {
    invariant(args.size === 1, '--emit-registry-template cannot be combined with other arguments');
    process.stdout.write(`${JSON.stringify(buildRegistryTemplate(), null, 2)}\n`);
    return;
  }

  const result = checkFhirNativeContract();
  if (args.has('--manifest-json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log(
    `FHIR native contract check passed (${result.counts.resources} resources, ${result.counts.searchKeys} search keys, ${result.counts.childTasks} child tasks, ${result.counts.liveRoutes} live routes; manifest ${result.manifest.manifestSha256}).`,
  );
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    runCli();
  } catch (error) {
    console.error('FHIR native contract check failed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
