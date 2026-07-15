#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY_PATH = 'tools/fhir-native/foundation-registry.json';
const PACKAGE_LOCK_PATH = 'tools/fhir-native/package-lock.json';
const SOURCE_BASELINE_PATH = 'tools/fhir-native/source-baseline.json';
const PLANS_PATH = 'Plans.md';
const PACKAGE_JSON_PATH = 'package.json';
const CI_PATH = '.github/workflows/ci.yml';
const EXPECTED_FHIR_VERSION = '4.0.1';
const EXPECTED_JP_CORE_VERSION = '1.2.0';
const EXPECTED_TASK_COUNT = 27;
const EXPECTED_RESOURCE_COUNT = 28;
const EXPECTED_REPOSITORY_URL = 'https://github.com/yusuketakuma/careviax.git';
const EXPECTED_BASE_COMMIT = '8d1205539c75d3acb9d242365f781c960074d21b';
const EXPECTED_CAPTURE_BRANCH = 'agent/continuous-improvement-20260712';
const EXPECTED_CAPTURED_AT = '2026-07-15T18:04:00+09:00';
const EXPECTED_SOURCE_ARTIFACT_PATHS = [
  'docs/architecture/fhir-first-prescription-platform.md',
  'tools/fhir-native/foundation-registry.json',
  'tools/fhir-native/package-lock.json',
  'tools/scripts/check-fhir-native-foundation.mjs',
  'tools/scripts/check-fhir-native-foundation.test.ts',
];
const EXPECTED_OWNED_NON_ARTIFACT_PATHS = [
  '.github/workflows/ci.yml',
  'Plans.md',
  'ops/refactor/RUN_LOCK.md',
  'ops/refactor/STATE.md',
  'package.json',
];
const EXPECTED_EXCLUDED_DIRTY_PATHS = [
  '.agents/skills/oracle-consult/SKILL.md',
  '.harness-mem/state/continuity.json',
  '.harness-mem/state/whisper-budget.json',
  '.oracle/config.json',
  'AGENTS.md',
  'docs/architecture/README.md',
  'docs/decisions.md',
  'docs/phase5-cutover-strategy.md',
  'src/app/api/dispense-audits/route.test.ts',
  'src/app/api/dispense-audits/route.ts',
  'src/app/api/dispense-workbench/patients/route.test.ts',
  'src/app/api/dispense-workbench/patients/route.ts',
  'src/app/api/set-audits/route.test.ts',
  'src/app/api/set-audits/route.ts',
  'src/app/api/set-plans/[id]/calendar/route.test.ts',
  'src/app/api/set-plans/[id]/calendar/route.ts',
  'src/lib/api/route-catalog.test.ts',
  'src/lib/api/route-catalog.ts',
  'tools/route-auth-wrapper-allowlist.json',
];
const EXPECTED_PACKAGES = [
  {
    packageId: 'jpfhir.jp.core',
    version: '1.2.0',
    fhirVersions: ['4.0.1'],
    sourceUrl: 'https://jpfhir.jp/fhir/core/1.2.0/package.tgz',
    sha256: '6094c8b9ebd975cb738c66cc999774c06a0aacf4480c068a8465e597117e52a3',
    role: 'jp-core-root',
  },
  {
    packageId: 'hl7.fhir.r4.core',
    version: '4.0.1',
    fhirVersions: ['4.0.1'],
    sourceUrl: 'https://packages2.fhir.org/packages/hl7.fhir.r4.core/4.0.1',
    sha256: 'b090bf929e1f665cf2c91583720849695bc38d2892a7c5037c56cb00817fb091',
    role: 'dependency',
  },
  {
    packageId: 'hl7.terminology.r4',
    version: '7.0.0',
    fhirVersions: ['4.0.1'],
    sourceUrl: 'https://packages2.fhir.org/packages/hl7.terminology.r4/7.0.0',
    sha256: '7f93189014349fa2640c970fadd1a266af217188b42e421ae5b7978e5fdcef63',
    role: 'dependency',
  },
  {
    packageId: 'hl7.fhir.uv.extensions.r4',
    version: '5.2.0',
    fhirVersions: ['4.0.1'],
    sourceUrl: 'https://packages2.fhir.org/packages/hl7.fhir.uv.extensions.r4/5.2.0',
    sha256: 'b406e75575f05676559d0759770c5939d023ee72fb2ef38e0b3259328487720a',
    role: 'dependency',
  },
  {
    packageId: 'jpfhir-terminology',
    declaredAs: 'jpfhir-terminology.r4',
    version: '1.4.0',
    fhirVersions: ['4.0.1'],
    sourceUrl: 'https://jpfhir.jp/fhir/core/terminology/jpfhir-terminology.r4-1.4.0.tgz',
    sha256: 'cfeb76457774d5a4bf1eb907cb60d083b0dedf04cb92405effa6b4aeaf68d21f',
    role: 'dependency',
  },
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function readText(root, relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(root, relativePath) {
  try {
    return JSON.parse(readText(root, relativePath));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${relativePath} is missing or invalid JSON: ${detail}`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueValues(values, label) {
  const unique = new Set(values);
  invariant(unique.size === values.length, `${label} must not contain duplicates`);
  return unique;
}

function stripMarkdownCode(value) {
  return value.replace(/`/g, '').trim();
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function extractTableAfterMarker(content, marker) {
  const lines = content.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => line.includes(marker));
  invariant(markerIndex !== -1, `documentation marker is missing: ${marker}`);

  const start = lines.findIndex(
    (line, index) => index > markerIndex && line.trim().startsWith('|'),
  );
  invariant(start !== -1, `markdown table is missing after: ${marker}`);

  const table = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('|')) break;
    table.push(line);
  }
  invariant(table.length >= 3, `markdown table has no rows after: ${marker}`);
  return table.slice(2).map(splitTableRow);
}

function normalizeDependencyCell(value) {
  const normalized = stripMarkdownCode(value);
  if (normalized === 'none') return [];
  return normalized.split(',').map((dependency) => dependency.trim());
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function isRepositoryRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  const portable = value.replaceAll('\\', '/');
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable)) return false;
  const segments = portable.split('/');
  return portable !== '.' && !segments.includes('') && !segments.includes('..');
}

export function canonicalGitHubRepositoryIdentity(value) {
  invariant(typeof value === 'string' && value.length > 0, 'source baseline origin is empty');
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
      throw new Error('source baseline origin must be a GitHub HTTPS or SSH repository URL');
    }
    invariant(
      parsed.protocol === 'https:' &&
        parsed.hostname.toLowerCase() === 'github.com' &&
        parsed.port === '' &&
        parsed.username === '' &&
        parsed.password === '' &&
        parsed.search === '' &&
        parsed.hash === '',
      'source baseline origin must be a GitHub HTTPS or SSH repository URL',
    );
    const segments = parsed.pathname.split('/').filter(Boolean);
    invariant(segments.length === 2, 'source baseline origin must identify one repository');
    [owner, repository] = segments;
  }
  repository = repository.replace(/\.git$/i, '');
  invariant(
    /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(repository),
    'source baseline origin contains an invalid owner or repository',
  );
  return `github.com/${owner.toLowerCase()}/${repository.toLowerCase()}`;
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function assertSameArray(actual, expected, label) {
  invariant(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} drift: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`,
  );
}

export function validatePackageLock(packageLock) {
  invariant(packageLock.lockVersion === 1, 'FHIR package lockVersion must be 1');
  invariant(packageLock.contractVersion === '0.5', 'FHIR package contractVersion must be 0.5');
  invariant(packageLock.confirmedAt === '2026-07-15', 'FHIR package confirmation date drifted');
  invariant(
    packageLock.runtimeResolutionPolicy?.networkFallback === false,
    'FHIR package runtime network fallback must remain disabled',
  );
  invariant(
    packageLock.runtimeResolutionPolicy?.floatingVersions === false,
    'FHIR package floating versions must remain disabled',
  );
  invariant(
    packageLock.runtimeResolutionPolicy?.digestAlgorithm === 'sha256',
    'FHIR package digest algorithm must remain sha256',
  );
  invariant(
    packageLock.runtimeResolutionPolicy?.runtimeValidationEligible === false,
    'foundation lock must not claim runtime validation eligibility before A5',
  );
  invariant(
    packageLock.runtimeResolutionPolicy?.blockedBy === 'FHIR-NATIVE-P0-FOUNDATION-004-CONFORMANCE',
    'runtime package eligibility must remain blocked by A5',
  );

  invariant(Array.isArray(packageLock.packages), 'FHIR package lock packages must be an array');
  assertSameArray(packageLock.packages, EXPECTED_PACKAGES, 'FHIR package lock entries');

  const warnings = packageLock.upstreamMetadataWarnings ?? [];
  uniqueValues(
    warnings.map((warning) => warning.code),
    'FHIR package warning codes',
  );
  const warningCodes = new Set(warnings.map((warning) => warning.code));
  invariant(warnings.length === 2, 'FHIR package lock must contain two exact upstream warnings');
  invariant(
    warningCodes.has('UPSTREAM_PACKAGE_MARKED_NOT_FOR_PUBLICATION'),
    'JP Core upstream package metadata warning must remain explicit until A5 resolves it',
  );
  invariant(
    warningCodes.has('DECLARED_PACKAGE_ID_DIFFERS_FROM_ARTIFACT_NAME'),
    'JP terminology package ID mismatch warning must remain explicit until A5 resolves it',
  );
  invariant(
    warnings.every(
      (warning) =>
        typeof warning.packageId === 'string' &&
        warning.packageId.length > 0 &&
        typeof warning.detail === 'string' &&
        warning.detail.length > 0,
    ),
    'FHIR package warnings must identify the package and evidence',
  );
}

export function validateRegistry(registry, packageLock) {
  invariant(registry.registryVersion === 1, 'FHIR foundation registryVersion must be 1');
  invariant(registry.contractVersion === '0.5', 'FHIR foundation contractVersion must be 0.5');
  invariant(registry.status === 'foundation-only', 'FHIR registry must remain foundation-only');
  invariant(
    registry.documentation === 'docs/architecture/fhir-first-prescription-platform.md',
    'FHIR foundation documentation path drifted',
  );
  invariant(
    registry.baselines?.fhir?.version === EXPECTED_FHIR_VERSION,
    `FHIR baseline must remain ${EXPECTED_FHIR_VERSION}`,
  );
  invariant(
    registry.baselines?.jpCore?.version === EXPECTED_JP_CORE_VERSION,
    `JP Core baseline must remain ${EXPECTED_JP_CORE_VERSION}`,
  );
  invariant(
    registry.baselines?.jpCore?.packageId === 'jpfhir.jp.core',
    'JP Core package ID drifted',
  );
  invariant(
    registry.baselines?.fhir?.officialUrl === 'https://hl7.org/fhir/R4/' &&
      registry.baselines?.jpCore?.officialUrl === 'https://jpfhir.jp/fhir/core/1.2.0/' &&
      registry.baselines?.jpCore?.historyUrl === 'https://jpfhir.jp/fhir/core/history.html',
    'FHIR foundation official source URLs drifted',
  );
  invariant(registry.packageLock === PACKAGE_LOCK_PATH, 'FHIR package lock path drifted');
  invariant(
    registry.sourceBaselineManifest === SOURCE_BASELINE_PATH,
    'FHIR source baseline path drifted',
  );

  assertSameArray(
    registry.planes.map((plane) => plane.id),
    ['fhir-clinical-data', 'technical-control', 'legacy-official-adapter'],
    'FHIR plane registry',
  );
  const technicalPlane = registry.planes.find((plane) => plane.id === 'technical-control');
  invariant(
    technicalPlane?.clinicalPayloadAllowed === false,
    'Technical Control Plane must not accept clinical payloads',
  );

  invariant(
    registry.capability?.status === 'not-implemented' &&
      registry.capability?.published === false &&
      registry.capability?.metadataRoute === null,
    'CapabilityStatement must remain explicitly unimplemented',
  );
  assertSameArray(registry.capability.declaredResources, [], 'declared FHIR resources');
  assertSameArray(registry.capability.declaredInteractions, [], 'declared FHIR interactions');
  assertSameArray(registry.capability.routeFiles, [], 'FHIR route files');
  invariant(
    registry.customExtensions?.status === 'none-approved' &&
      registry.customExtensions?.entries?.length === 0,
    'custom extension registry must remain explicitly empty',
  );
  invariant(
    registry.canonicalNamespaces?.every(
      (namespace) => namespace.status === 'unresolved' && namespace.useBeforeApproval === false,
    ),
    'unapproved canonical namespaces must remain unresolved and unusable',
  );

  invariant(Array.isArray(registry.resources), 'FHIR resources must be an array');
  invariant(
    registry.resources.length === EXPECTED_RESOURCE_COUNT,
    `FHIR resource registry must contain ${EXPECTED_RESOURCE_COUNT} rows`,
  );
  uniqueValues(
    registry.resources.map((entry) => entry.resource),
    'FHIR resource names',
  );
  const searchKeys = new Set(Object.keys(registry.searchRegistry ?? {}));
  const retentionKeys = uniqueValues(registry.retentionRegistry ?? [], 'retention keys');
  const accessKeys = uniqueValues(registry.accessRegistry ?? [], 'access keys');
  for (const resource of registry.resources) {
    invariant(searchKeys.has(resource.searchKey), `${resource.resource} has unknown searchKey`);
    invariant(
      retentionKeys.has(resource.retentionKey),
      `${resource.resource} has unknown retentionKey`,
    );
    invariant(accessKeys.has(resource.accessKey), `${resource.resource} has unknown accessKey`);
  }

  const careTeam = registry.resources.find((entry) => entry.resource === 'CareTeam');
  invariant(careTeam?.nativeTarget === 'UNRESOLVED', 'CareTeam target must remain UNRESOLVED');
  invariant(
    careTeam?.nativeInteraction === 'none until owner/profile approval' &&
      careTeam?.searchKey === 'S-NONE',
    'CareTeam must not gain interaction or search before owner/profile approval',
  );
  const binary = registry.resources.find((entry) => entry.resource === 'Binary');
  invariant(
    binary?.nativeTarget === 'L2 conditional owner-scoped' && binary?.searchKey === 'S-NONE',
    'Binary must remain conditional owner-scoped and non-searchable',
  );

  invariant(Array.isArray(registry.taskGraph), 'FHIR taskGraph must be an array');
  invariant(
    registry.taskGraph.length === EXPECTED_TASK_COUNT,
    `FHIR taskGraph must contain ${EXPECTED_TASK_COUNT} tasks`,
  );
  uniqueValues(
    registry.taskGraph.map((task) => task.wave),
    'FHIR task waves',
  );
  uniqueValues(
    registry.taskGraph.map((task) => task.id),
    'FHIR task IDs',
  );
  for (const wave of ['A0', 'A1']) {
    invariant(
      registry.taskGraph.find((task) => task.wave === wave)?.status === 'completed',
      `${wave} must be recorded as completed in the foundation registry`,
    );
  }
  invariant(
    registry.taskGraph
      .filter((task) => !['A0', 'A1'].includes(task.wave))
      .every((task) => task.status === 'active' && typeof task.planStatus === 'string'),
    'remaining FHIR tasks must be active and carry a Plans status',
  );

  validatePackageLock(packageLock);
}

function resourceRowsFromDocumentation(documentation) {
  return extractTableAfterMarker(documentation, '## 5. Resource Inventory').map((cells) => ({
    resource: stripMarkdownCode(cells[0]),
    legacyInventory: stripMarkdownCode(cells[1]),
    nativeTarget: stripMarkdownCode(cells[2]),
    authoritativeServer: stripMarkdownCode(cells[3]),
    nativeInteraction: stripMarkdownCode(cells[4]),
    profilePolicy: stripMarkdownCode(cells[5]),
    searchKey: stripMarkdownCode(cells[6]),
    retentionKey: stripMarkdownCode(cells[7]),
    accessKey: stripMarkdownCode(cells[8]),
  }));
}

function taskRowsFromDocumentation(documentation) {
  return extractTableAfterMarker(documentation, '## 18. Execution Child Task Graph').map(
    (cells) => ({
      wave: stripMarkdownCode(cells[0]),
      id: stripMarkdownCode(cells[1]),
      dependsOn: normalizeDependencyCell(cells[2]),
    }),
  );
}

export function validateDocumentation(documentation, registry) {
  invariant(
    documentation.includes('FHIR R4 4.0.1') && documentation.includes('jpfhir.jp.core#1.2.0'),
    'FHIR documentation baseline versions drifted',
  );
  invariant(
    documentation.includes(REGISTRY_PATH) &&
      documentation.includes(PACKAGE_LOCK_PATH) &&
      documentation.includes(SOURCE_BASELINE_PATH),
    'FHIR documentation must link every machine-readable foundation artifact',
  );

  assertSameArray(
    resourceRowsFromDocumentation(documentation),
    registry.resources,
    'FHIR documentation resource matrix',
  );

  const searchRows = extractTableAfterMarker(documentation, '### 5.1 Search key registry');
  const documentedSearch = Object.fromEntries(
    searchRows.map(([keyCell, parametersCell]) => {
      const key = stripMarkdownCode(keyCell);
      const parameterText = stripMarkdownCode(parametersCell).split(';')[0].trim();
      const parameters = parameterText.includes('Resource search なし')
        ? []
        : parameterText
            .split(',')
            .map((parameter) => stripMarkdownCode(parameter))
            .filter(Boolean);
      return [key, parameters];
    }),
  );
  invariant(
    JSON.stringify(documentedSearch) === JSON.stringify(registry.searchRegistry),
    'FHIR documentation search registry drifted',
  );

  const documentedRetention = extractTableAfterMarker(
    documentation,
    '### 5.2 Retention key registry',
  ).map(([key]) => stripMarkdownCode(key));
  assertSameArray(documentedRetention, registry.retentionRegistry, 'retention registry');

  const documentedAccess = extractTableAfterMarker(
    documentation,
    '### 5.3 Consent / purpose key registry',
  ).map(([key]) => stripMarkdownCode(key));
  assertSameArray(documentedAccess, registry.accessRegistry, 'access registry');

  const documentedIdentifiers = extractTableAfterMarker(
    documentation,
    '## 8. Identifier Namespace Registry',
  ).map(([key]) => stripMarkdownCode(key));
  assertSameArray(documentedIdentifiers, registry.identifierRegistry, 'identifier registry');

  const documentedTaskGraph = taskRowsFromDocumentation(documentation);
  const registeredTaskGraph = registry.taskGraph.map(({ wave, id, dependsOn }) => ({
    wave,
    id,
    dependsOn,
  }));
  assertSameArray(documentedTaskGraph, registeredTaskGraph, 'FHIR documentation task graph');
}

function activeDependencies(task, completedWaves) {
  return task.dependsOn.filter((dependency) => {
    const normalized = dependency.replace(/^approved\s+/, '');
    return !completedWaves.has(normalized);
  });
}

export function validatePlans(plans, registry) {
  const completedTasks = registry.taskGraph.filter((task) => task.status === 'completed');
  const activeTasks = registry.taskGraph.filter((task) => task.status === 'active');
  const completedWaves = new Set(completedTasks.map((task) => task.wave));
  const planRows = extractTableAfterMarker(
    plans,
    '**FHIR Native child execution registry — PR-sized active tasks',
  ).map((cells) => ({
    wave: stripMarkdownCode(cells[0]),
    id: stripMarkdownCode(cells[1]),
    status: stripMarkdownCode(cells[2]),
    dependsOn: normalizeDependencyCell(cells[5]),
  }));

  invariant(
    planRows.length === activeTasks.length,
    `Plans FHIR child queue count drift: expected ${activeTasks.length}, actual ${planRows.length}`,
  );
  for (const completed of completedTasks) {
    invariant(
      !planRows.some((row) => row.id === completed.id),
      `completed FHIR task must not remain active in Plans.md: ${completed.id}`,
    );
  }

  const expectedRows = activeTasks.map((task) => ({
    wave: task.wave,
    id: task.id,
    status: task.planStatus,
    dependsOn: activeDependencies(task, completedWaves),
  }));
  assertSameArray(planRows, expectedRows, 'Plans FHIR child registry');

  const summaryRows = extractTableAfterMarker(plans, '**現在の分類サマリー**');
  const childCountRow = summaryRows.find(([bucket]) => bucket.includes('FHIR child queue'));
  invariant(childCountRow, 'Plans classification summary is missing FHIR child queue');
  const documentedCount = Number.parseInt(childCountRow[1].replace(/[^0-9]/g, ''), 10);
  invariant(
    documentedCount === activeTasks.length,
    `Plans FHIR child summary must be ${activeTasks.length}, actual ${documentedCount}`,
  );
}

function parsePrismaEnum(content, enumName) {
  const match = content.match(new RegExp(`enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\}`));
  invariant(match, `Prisma enum is missing: ${enumName}`);
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0]);
}

function findFiles(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!existsSync(absoluteDirectory)) return [];
  const files = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...findFiles(root, relativePath));
    if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

function isFhirR4Path(relativePath) {
  const segments = relativePath
    .split('/')
    .map((segment) => segment.replace(/\.(?:ts|tsx|js|jsx|mjs)$/, ''))
    .filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith('@'));
  return segments.some((segment, index) => segment === 'fhir' && segments[index + 1] === 'r4');
}

export function validateLiveDrift(root, registry) {
  const versionSource = readText(root, registry.legacyEvidence.versionLiteralPath);
  invariant(
    versionSource.includes(`export const FHIR_R4_VERSION = '${EXPECTED_FHIR_VERSION}'`),
    'live FHIR_R4_VERSION drifted from the foundation registry',
  );
  invariant(
    versionSource.includes(`export const JP_CORE_VERSION = '${EXPECTED_JP_CORE_VERSION}'`),
    'live JP_CORE_VERSION drifted from the foundation registry',
  );

  const schema = readText(root, registry.legacyEvidence.schemaPath);
  assertSameArray(
    parsePrismaEnum(schema, 'ClinicalFhirResourceType'),
    registry.legacyEvidence.clinicalFhirResourceType,
    'legacy ClinicalFhirResourceType inventory',
  );

  const appRoutes = findFiles(root, 'src/app').filter(
    (filePath) => /\/route\.(?:ts|tsx|js|mjs)$/.test(filePath) && isFhirR4Path(filePath),
  );
  const pagesRoutes = findFiles(root, 'src/pages').filter(
    (filePath) =>
      /\.(?:ts|tsx|js|jsx|mjs)$/.test(filePath) &&
      !/\.(?:test|spec)\.[^.]+$/.test(filePath) &&
      isFhirR4Path(filePath),
  );
  const liveFhirRoutes = sorted([...appRoutes, ...pagesRoutes]);
  assertSameArray(liveFhirRoutes, sorted(registry.capability.routeFiles), 'live FHIR routes');
  if (registry.capability.status === 'not-implemented') {
    invariant(liveFhirRoutes.length === 0, 'FHIR routes exist while Capability is not implemented');
  }

  const packageJson = readJson(root, PACKAGE_JSON_PATH);
  invariant(
    packageJson.scripts?.['fhir-native:foundation:check'] ===
      'node tools/scripts/check-fhir-native-foundation.mjs',
    'package.json FHIR foundation check script is missing or drifted',
  );
  const ci = readText(root, CI_PATH);
  invariant(
    ci.includes('run: pnpm fhir-native:foundation:check'),
    'CI does not run the FHIR foundation drift gate',
  );
}

export function validateSourceBaseline(root, baseline) {
  invariant(baseline.manifestVersion === 1, 'FHIR source baseline manifestVersion must be 1');
  invariant(
    baseline.repositoryUrl === EXPECTED_REPOSITORY_URL,
    'FHIR source baseline repository URL drifted',
  );
  invariant(
    baseline.baseCommit === EXPECTED_BASE_COMMIT,
    'FHIR source baseline must match the approved exact base commit',
  );
  invariant(
    baseline.branch === EXPECTED_CAPTURE_BRANCH,
    'FHIR source baseline capture branch drifted',
  );
  invariant(
    baseline.capturedAt === EXPECTED_CAPTURED_AT,
    'FHIR source baseline capture timestamp drifted',
  );
  invariant(baseline.worktree?.dirty === true, 'FHIR source baseline must disclose dirty capture');
  assertSameArray(
    baseline.worktree?.ownedNonArtifactPaths,
    EXPECTED_OWNED_NON_ARTIFACT_PATHS,
    'FHIR source baseline owned non-artifact paths',
  );
  invariant(
    Array.isArray(baseline.worktree?.excludedDirtyPaths),
    'FHIR source baseline excluded dirty paths must be an array',
  );
  uniqueValues(baseline.worktree.excludedDirtyPaths, 'FHIR source baseline excluded dirty paths');
  assertSameArray(
    baseline.worktree.excludedDirtyPaths,
    EXPECTED_EXCLUDED_DIRTY_PATHS,
    'FHIR source baseline excluded dirty paths',
  );
  invariant(
    baseline.worktree.excludedDirtyPaths.every(isRepositoryRelativePath),
    'FHIR source baseline excluded dirty path is unsafe',
  );
  invariant(
    baseline.build?.kind === 'documentation-static-ratchet' &&
      baseline.build?.runtimeBuildStatus === 'not-built' &&
      baseline.build?.schemaStatus === 'unchanged' &&
      baseline.build?.capabilityStatus === 'not-implemented' &&
      baseline.build?.externalSendStatus === 'disabled',
    'FHIR foundation build manifest must not claim runtime/schema/capability completion',
  );
  invariant(Array.isArray(baseline.artifacts), 'FHIR source baseline artifacts must be an array');
  uniqueValues(
    baseline.artifacts.map((artifact) => artifact.path),
    'FHIR source baseline artifact paths',
  );
  assertSameArray(
    baseline.artifacts.map((artifact) => artifact.path),
    EXPECTED_SOURCE_ARTIFACT_PATHS,
    'FHIR source baseline artifact coverage',
  );
  const artifacts = baseline.artifacts.map((artifact) => {
    invariant(
      artifact.path !== SOURCE_BASELINE_PATH,
      'FHIR source baseline must not recursively hash itself',
    );
    invariant(
      /^[a-f0-9]{64}$/.test(artifact.sha256),
      `invalid source artifact hash: ${artifact.path}`,
    );
    invariant(
      isRepositoryRelativePath(artifact.path),
      `unsafe source artifact path: ${artifact.path}`,
    );
    const actual = sha256(readText(root, artifact.path));
    invariant(actual === artifact.sha256, `FHIR source artifact drifted: ${artifact.path}`);
    return { path: artifact.path, sha256: artifact.sha256 };
  });
  const artifactSet = sorted(
    artifacts.map((artifact) => `${artifact.path}\0${artifact.sha256}`),
  ).join('\n');
  invariant(
    sha256(artifactSet) === baseline.artifactSetSha256,
    'FHIR source baseline artifact-set digest drifted',
  );

  try {
    git(root, ['cat-file', '-e', `${EXPECTED_BASE_COMMIT}^{commit}`]);
    git(root, ['merge-base', '--is-ancestor', EXPECTED_BASE_COMMIT, 'HEAD']);
  } catch {
    throw new Error(
      `FHIR source baseline commit is missing or is not an ancestor of HEAD: ${EXPECTED_BASE_COMMIT}`,
    );
  }
  const observedOrigin = git(root, ['remote', 'get-url', 'origin']);
  invariant(
    canonicalGitHubRepositoryIdentity(observedOrigin) ===
      canonicalGitHubRepositoryIdentity(EXPECTED_REPOSITORY_URL),
    'FHIR source baseline origin repository identity drifted',
  );
}

export function checkFoundation(root = process.cwd()) {
  const registry = readJson(root, REGISTRY_PATH);
  const packageLock = readJson(root, PACKAGE_LOCK_PATH);
  const sourceBaseline = readJson(root, SOURCE_BASELINE_PATH);
  const documentation = readText(root, registry.documentation);
  const plans = readText(root, PLANS_PATH);

  validateRegistry(registry, packageLock);
  validateDocumentation(documentation, registry);
  validatePlans(plans, registry);
  validateLiveDrift(root, registry);
  validateSourceBaseline(root, sourceBaseline);
}

const isCli = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isCli) {
  try {
    checkFoundation();
    console.log('FHIR native foundation check passed.');
  } catch (error) {
    console.error('FHIR native foundation check failed.');
    console.error(`- ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
