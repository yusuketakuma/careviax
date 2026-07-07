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
const REGISTRY_PATH = 'src/lib/tasks/task-registry.ts';
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

function parseRiskRegistryTaskTypes(registrySource) {
  const legacyRiskTaskTypes = new Map();
  const registryStart = registrySource.indexOf('export const RISK_TASK_REGISTRY = {');
  const registryEnd = registrySource.indexOf(
    '} as const satisfies Record<RiskDomain',
    registryStart,
  );
  if (registryStart === -1 || registryEnd === -1) {
    throw new Error(`${REGISTRY_PATH}: RISK_TASK_REGISTRY block was not found`);
  }

  let currentDomain = null;
  const registryLines = registrySource.slice(registryStart, registryEnd).split('\n');
  for (const line of registryLines) {
    const domainMatch = line.match(/^\s{2}([a-z][a-z0-9_]*):\s*\{/);
    if (domainMatch) {
      currentDomain = domainMatch[1];
      continue;
    }

    const taskTypeMatch = line.match(/\btask_type:\s*['"]([^'"]+)['"]/);
    if (currentDomain && taskTypeMatch) {
      legacyRiskTaskTypes.set(currentDomain, taskTypeMatch[1]);
    }
  }

  return legacyRiskTaskTypes;
}

function parseRiskTaskModuleMap(registrySource) {
  const moduleByDomain = new Map();
  const mapStart = registrySource.indexOf('const RISK_TASK_MODULE_BY_DOMAIN = {');
  const mapEnd = registrySource.indexOf('} as const satisfies Record<RiskDomain', mapStart);
  if (mapStart === -1 || mapEnd === -1) {
    throw new Error(`${REGISTRY_PATH}: RISK_TASK_MODULE_BY_DOMAIN block was not found`);
  }

  const mapLines = registrySource.slice(mapStart, mapEnd).split('\n');
  for (const line of mapLines) {
    const match = line.match(/^\s{2}([a-z][a-z0-9_]*):\s*['"]([^'"]+)['"]/);
    if (match) moduleByDomain.set(match[1], match[2]);
  }
  return moduleByDomain;
}

function readRegisteredTaskTypes() {
  const registrySource = readFileSync(path.join(REPO_ROOT, REGISTRY_PATH), 'utf8');
  const registered = new Set();
  const legacy = new Set();

  for (const match of registrySource.matchAll(
    /\b(?:coreTask|pharmacyTask)\(\s*['"]([^'"]+)['"]/g,
  )) {
    registered.add(match[1]);
  }

  for (const match of registrySource.matchAll(/\blegacyTaskTypes\s*:\s*\[([\s\S]*?)\]/g)) {
    for (const taskType of stringLiteralsFromArraySource(match[1])) {
      registered.add(taskType);
      legacy.add(taskType);
    }
  }

  const riskTaskTypes = parseRiskRegistryTaskTypes(registrySource);
  const riskTaskModuleByDomain = parseRiskTaskModuleMap(registrySource);
  for (const [domain, taskType] of riskTaskTypes.entries()) {
    const moduleId = riskTaskModuleByDomain.get(domain);
    if (!moduleId) {
      throw new Error(`${REGISTRY_PATH}: missing risk task module mapping for ${domain}`);
    }
    registered.add(taskType);
    legacy.add(taskType);
    registered.add(`${moduleId}.${taskType}`);
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
    if (relativePath === REGISTRY_PATH) continue;
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
      reason: 'task_type is not registered in src/lib/tasks/task-registry.ts',
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
