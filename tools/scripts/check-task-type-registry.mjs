#!/usr/bin/env node
// Operational task_type registry ratchet (MOD-CI-001).
//
// Runtime task creation already calls the task registry, but new direct
// task_type literals can still drift into API/server code before a route is
// exercised. This script keeps production task literals registered and makes
// new unprefixed task types explicit legacy entries.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const TASK_REGISTRY_PATH = 'src/lib/tasks/task-registry.ts';
const RISK_REGISTRY_PATH = 'src/lib/tasks/risk-task-registry.ts';
const RISK_REGISTRY_MODULE_PATH = './risk-task-registry';
const REGISTRY_PATHS = new Set([TASK_REGISTRY_PATH, RISK_REGISTRY_PATH]);
const SCAN_ROOTS = ['src/app/api', 'src/server', 'src/lib'];
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIPPED_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx', '.stories.tsx'];
const SKIPPED_PATH_PARTS = ['/__snapshots__/', '/__fixtures__/', '/fixtures/'];

const TASK_LITERAL_PATTERNS = [
  /\btaskType\s*:\s*['"]([^'"]+)['"]/g,
  /\btask_type\s*:\s*['"]([^'"]+)['"]/g,
];

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10 /* \n */) line += 1;
  }
  return line;
}

function stringLiteralsFromArraySource(source) {
  return Array.from(source.matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]);
}

function readRequiredSource(relativePath) {
  try {
    return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? ` (${error.code})`
        : '';
    throw new Error(`${relativePath}: required registry source could not be read${code}`);
  }
}

function extractTypedRecordBody(source, declarationName, sourcePath, { exported = false } = {}) {
  const declarationPattern = new RegExp(
    `\\b${exported ? 'export\\s+const' : 'const'}\\s+${declarationName}\\s*=\\s*\\{`,
  );
  const declarationMatch = declarationPattern.exec(source);
  if (!declarationMatch) {
    throw new Error(`${sourcePath}: ${declarationName} block was not found`);
  }

  const bodyStart = source.indexOf('{', declarationMatch.index) + 1;
  const terminatorMatch = /\}\s+as const satisfies Record<RiskDomain\b/.exec(
    source.slice(bodyStart),
  );
  if (!terminatorMatch) {
    throw new Error(`${sourcePath}: ${declarationName} must satisfy Record<RiskDomain, ...>`);
  }

  return source.slice(bodyStart, bodyStart + terminatorMatch.index);
}

function hasExactNamedModuleBinding(source, statementKind, bindingName, modulePath) {
  for (const match of source.matchAll(
    /\b(import|export)\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    if (match[1] !== statementKind || match[3] !== modulePath) continue;
    const bindings = match[2].split(',').map((binding) => binding.trim());
    if (bindings.includes(bindingName)) return true;
  }
  return false;
}

function assertRiskRegistryWiring(taskRegistrySource) {
  if (
    !hasExactNamedModuleBinding(
      taskRegistrySource,
      'import',
      'RISK_TASK_REGISTRY',
      RISK_REGISTRY_MODULE_PATH,
    )
  ) {
    throw new Error(
      `${TASK_REGISTRY_PATH}: must import RISK_TASK_REGISTRY from '${RISK_REGISTRY_MODULE_PATH}'`,
    );
  }
  if (
    !hasExactNamedModuleBinding(
      taskRegistrySource,
      'export',
      'RISK_TASK_REGISTRY',
      RISK_REGISTRY_MODULE_PATH,
    )
  ) {
    throw new Error(
      `${TASK_REGISTRY_PATH}: must re-export RISK_TASK_REGISTRY from '${RISK_REGISTRY_MODULE_PATH}'`,
    );
  }
}

function parseRiskRegistryTaskTypes(riskRegistrySource) {
  const registryBody = extractTypedRecordBody(
    riskRegistrySource,
    'RISK_TASK_REGISTRY',
    RISK_REGISTRY_PATH,
    { exported: true },
  );
  const taskTypeByDomain = new Map();
  const domainByTaskType = new Map();
  const seenDomains = new Set();
  let currentEntry = null;

  function finishCurrentEntry() {
    if (!currentEntry) return;
    const { domain, ownerDomain, taskType } = currentEntry;
    if (!ownerDomain) {
      throw new Error(`${RISK_REGISTRY_PATH}: missing owner_domain for risk domain ${domain}`);
    }
    if (ownerDomain !== domain) {
      throw new Error(
        `${RISK_REGISTRY_PATH}: owner_domain ${ownerDomain} does not match risk domain ${domain}`,
      );
    }
    if (!taskType) {
      throw new Error(`${RISK_REGISTRY_PATH}: missing task_type for risk domain ${domain}`);
    }
    const existingDomain = domainByTaskType.get(taskType);
    if (existingDomain) {
      throw new Error(
        `${RISK_REGISTRY_PATH}: duplicate risk task_type ${taskType} for ${existingDomain} and ${domain}`,
      );
    }
    taskTypeByDomain.set(domain, taskType);
    domainByTaskType.set(taskType, domain);
  }

  for (const line of registryBody.split('\n')) {
    const domainMatch = line.match(/^\s{2}([a-z][a-z0-9_]*):\s*\{/);
    if (domainMatch) {
      finishCurrentEntry();
      const domain = domainMatch[1];
      if (seenDomains.has(domain)) {
        throw new Error(`${RISK_REGISTRY_PATH}: duplicate risk domain ${domain}`);
      }
      seenDomains.add(domain);
      currentEntry = { domain, ownerDomain: null, taskType: null };
      continue;
    }

    if (!currentEntry) continue;
    const ownerDomainMatch = line.match(/^\s{4}owner_domain:\s*['"]([^'"]+)['"]/);
    if (ownerDomainMatch) {
      if (currentEntry.ownerDomain) {
        throw new Error(
          `${RISK_REGISTRY_PATH}: duplicate owner_domain for risk domain ${currentEntry.domain}`,
        );
      }
      currentEntry.ownerDomain = ownerDomainMatch[1];
    }
    const taskTypeMatch = line.match(/^\s{4}task_type:\s*['"]([^'"]+)['"]/);
    if (taskTypeMatch) {
      if (currentEntry.taskType) {
        throw new Error(
          `${RISK_REGISTRY_PATH}: duplicate task_type for risk domain ${currentEntry.domain}`,
        );
      }
      currentEntry.taskType = taskTypeMatch[1];
    }
  }
  finishCurrentEntry();

  if (taskTypeByDomain.size === 0) {
    throw new Error(`${RISK_REGISTRY_PATH}: RISK_TASK_REGISTRY has no domain entries`);
  }
  return taskTypeByDomain;
}

function parseRiskTaskModuleMap(taskRegistrySource) {
  const mapBody = extractTypedRecordBody(
    taskRegistrySource,
    'RISK_TASK_MODULE_BY_DOMAIN',
    TASK_REGISTRY_PATH,
  );
  const moduleByDomain = new Map();
  for (const line of mapBody.split('\n')) {
    const match = line.match(/^\s{2}([a-z][a-z0-9_]*):\s*['"]([^'"]+)['"]/);
    if (!match) continue;
    if (moduleByDomain.has(match[1])) {
      throw new Error(`${TASK_REGISTRY_PATH}: duplicate risk task module mapping for ${match[1]}`);
    }
    moduleByDomain.set(match[1], match[2]);
  }
  if (moduleByDomain.size === 0) {
    throw new Error(`${TASK_REGISTRY_PATH}: RISK_TASK_MODULE_BY_DOMAIN has no domain entries`);
  }
  return moduleByDomain;
}

function readRegisteredTaskTypes() {
  const taskRegistrySource = readRequiredSource(TASK_REGISTRY_PATH);
  const riskRegistrySource = readRequiredSource(RISK_REGISTRY_PATH);
  assertRiskRegistryWiring(taskRegistrySource);

  const registered = new Set();
  const legacy = new Set();
  const originByTaskType = new Map();

  function registerTaskType(taskType, origin, { isLegacy = false } = {}) {
    const existingOrigin = originByTaskType.get(taskType);
    if (existingOrigin) {
      throw new Error(`duplicate registered task_type ${taskType} (${existingOrigin}; ${origin})`);
    }
    originByTaskType.set(taskType, origin);
    registered.add(taskType);
    if (isLegacy) legacy.add(taskType);
  }

  for (const match of taskRegistrySource.matchAll(
    /\b(coreTask|pharmacyTask)\(\s*['"]([^'"]+)['"]/g,
  )) {
    registerTaskType(match[2], `${TASK_REGISTRY_PATH}:${match[1]}`);
  }

  for (const match of taskRegistrySource.matchAll(/\blegacyTaskTypes\s*:\s*\[([\s\S]*?)\]/g)) {
    for (const taskType of stringLiteralsFromArraySource(match[1])) {
      registerTaskType(taskType, `${TASK_REGISTRY_PATH}:legacyTaskTypes`, {
        isLegacy: true,
      });
    }
  }

  const riskTaskTypes = parseRiskRegistryTaskTypes(riskRegistrySource);
  const riskTaskModuleByDomain = parseRiskTaskModuleMap(taskRegistrySource);
  for (const [domain, taskType] of riskTaskTypes.entries()) {
    const moduleId = riskTaskModuleByDomain.get(domain);
    if (!moduleId) {
      throw new Error(`${TASK_REGISTRY_PATH}: missing risk task module mapping for ${domain}`);
    }
    registerTaskType(taskType, `${RISK_REGISTRY_PATH}:${domain}`, { isLegacy: true });
    registerTaskType(`${moduleId}.${taskType}`, `${TASK_REGISTRY_PATH}:${domain}`);
  }
  for (const domain of riskTaskModuleByDomain.keys()) {
    if (!riskTaskTypes.has(domain)) {
      throw new Error(`${RISK_REGISTRY_PATH}: missing risk registry entry for domain ${domain}`);
    }
  }

  return { registered, legacy };
}

function walkFiles(root) {
  const absoluteRoot = path.join(REPO_ROOT, root);
  const files = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const child of readdirSync(current)) {
        if (child === 'node_modules' || child === '.next') continue;
        stack.push(path.join(current, child));
      }
      continue;
    }
    if (!stats.isFile()) continue;

    const relativePath = path.relative(REPO_ROOT, current).split(path.sep).join('/');
    if (REGISTRY_PATHS.has(relativePath)) continue;
    if (SKIPPED_SUFFIXES.some((suffix) => relativePath.endsWith(suffix))) continue;
    if (SKIPPED_PATH_PARTS.some((part) => relativePath.includes(part))) continue;
    if (TARGET_EXTENSIONS.has(path.extname(relativePath))) files.push(relativePath);
  }
  return files.sort();
}

function findTaskLiterals() {
  const literals = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkFiles(root)) {
      const content = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      for (const pattern of TASK_LITERAL_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          literals.push({
            file,
            line: lineOf(content, match.index),
            taskType: match[1],
          });
        }
      }
    }
  }
  return literals;
}

function isModulePrefixedTaskType(taskType) {
  return /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(taskType);
}

const { registered, legacy } = readRegisteredTaskTypes();
const taskLiterals = findTaskLiterals();
const violations = [];

for (const literal of taskLiterals) {
  if (!registered.has(literal.taskType)) {
    violations.push({
      ...literal,
      reason: 'task_type is not registered in the canonical task registry sources',
    });
    continue;
  }

  if (!isModulePrefixedTaskType(literal.taskType) && !legacy.has(literal.taskType)) {
    violations.push({
      ...literal,
      reason: 'unprefixed task_type must be declared as legacyTaskTypes',
    });
  }
}

if (violations.length > 0) {
  console.error('Task type registry check failed.');
  console.error(
    '\nOperational task literals must be registered and new canonical types must be module-prefixed:',
  );
  for (const item of violations) {
    console.error(`- ${item.file}:${item.line} task_type=${item.taskType} (${item.reason})`);
  }
  process.exit(1);
}

console.log(
  `Task type registry check passed (${taskLiterals.length} task literals, ${registered.size} registered task types).`,
);
