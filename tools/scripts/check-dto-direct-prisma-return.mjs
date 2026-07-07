#!/usr/bin/env node
// Public API DTO/presenter boundary ratchet (API-DTO-001 / MOD-CI-001).
//
// This is intentionally conservative. It flags route handlers that pass a
// variable assigned from Prisma/transaction delegates directly to success(...),
// or put that variable into a top-level { data: ... } response without a
// presenter/serializer step. Existing debt is tracked in
// tools/dto-direct-prisma-return-allowlist.json; new debt fails CI.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const ALLOWLIST_PATH = 'tools/dto-direct-prisma-return-allowlist.json';
const SCAN_ROOTS = ['src/app/api'];
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIPPED_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

const PRISMA_ASSIGNMENT_PATTERN =
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+(?:prisma|tx|db)\.[A-Za-z_$][\w$]*\.(?:findUnique|findFirst|findMany|create|update|upsert|delete|createMany|updateMany|deleteMany|count|aggregate|groupBy)\b/g;

const DIRECT_AWAIT_SUCCESS_PATTERN =
  /\bsuccess\s*\(\s*(?:\{\s*data\s*:\s*)?await\s+(?:prisma|tx|db)\.[A-Za-z_$][\w$]*\.(?:findUnique|findFirst|findMany|create|update|upsert|delete|createMany|updateMany|deleteMany|count|aggregate|groupBy)\b/g;

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10 /* \n */) line += 1;
  }
  return line;
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
    if (SKIPPED_SUFFIXES.some((suffix) => relativePath.endsWith(suffix))) continue;
    if (TARGET_EXTENSIONS.has(path.extname(relativePath))) files.push(relativePath);
  }
  return files.sort();
}

function readAllowlist() {
  const raw = readFileSync(path.join(REPO_ROOT, ALLOWLIST_PATH), 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`${ALLOWLIST_PATH} must contain an entries array`);
  }

  return parsed.entries.map((entry, index) => {
    const label = `${ALLOWLIST_PATH}:entries[${index}]`;
    if (!entry || typeof entry !== 'object') throw new Error(`${label} must be an object`);
    if (typeof entry.path !== 'string' || !entry.path) throw new Error(`${label}.path is required`);
    if (typeof entry.owner !== 'string' || !entry.owner.trim()) {
      throw new Error(`${label}.owner is required`);
    }
    if (typeof entry.debtId !== 'string' || !entry.debtId.trim()) {
      throw new Error(`${label}.debtId is required`);
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error(`${label}.reason is required`);
    }
    if (typeof entry.plannedAction !== 'string' || !entry.plannedAction.trim()) {
      throw new Error(`${label}.plannedAction is required`);
    }
    if (
      typeof entry.expectedCount !== 'number' ||
      !Number.isSafeInteger(entry.expectedCount) ||
      entry.expectedCount < 1
    ) {
      throw new Error(`${label}.expectedCount must be a positive integer`);
    }
    return { ...entry, actualCount: 0 };
  });
}

function successReferencesVariable(content, variableName) {
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const direct = new RegExp(`\\bsuccess\\s*\\(\\s*${escaped}\\b`);
  const dataWrapped = new RegExp(`\\bsuccess\\s*\\(\\s*\\{\\s*data\\s*:\\s*${escaped}\\b`);
  return direct.test(content) || dataWrapped.test(content);
}

function findViolations() {
  const violations = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkFiles(root)) {
      const content = readFileSync(path.join(REPO_ROOT, file), 'utf8');

      DIRECT_AWAIT_SUCCESS_PATTERN.lastIndex = 0;
      let directMatch;
      while ((directMatch = DIRECT_AWAIT_SUCCESS_PATTERN.exec(content)) !== null) {
        violations.push({
          path: file,
          line: lineOf(content, directMatch.index),
          symbol: 'await prisma delegate',
          reason: 'success() receives a Prisma delegate result directly',
        });
      }

      PRISMA_ASSIGNMENT_PATTERN.lastIndex = 0;
      let assignmentMatch;
      while ((assignmentMatch = PRISMA_ASSIGNMENT_PATTERN.exec(content)) !== null) {
        const variableName = assignmentMatch[1];
        if (!successReferencesVariable(content.slice(assignmentMatch.index), variableName))
          continue;
        violations.push({
          path: file,
          line: lineOf(content, assignmentMatch.index),
          symbol: variableName,
          reason: 'Prisma result variable is passed to success() without a presenter',
        });
      }
    }
  }
  return violations;
}

const allowlist = readAllowlist();
const allowByPath = new Map(allowlist.map((entry) => [entry.path, entry]));
const violations = findViolations();
const newViolations = [];

for (const violation of violations) {
  const entry = allowByPath.get(violation.path);
  if (entry) {
    entry.actualCount += 1;
  } else {
    newViolations.push(violation);
  }
}

const staleEntries = allowlist.filter((entry) => entry.actualCount !== entry.expectedCount);

if (newViolations.length > 0 || staleEntries.length > 0) {
  console.error('DTO direct Prisma return check failed.');
  if (newViolations.length > 0) {
    console.error('\nNew route DTO boundary violations:');
    for (const item of newViolations) {
      console.error(`- ${item.path}:${item.line} ${item.symbol} (${item.reason})`);
    }
  }
  if (staleEntries.length > 0) {
    console.error('\nStale DTO direct Prisma return allowlist entries:');
    for (const entry of staleEntries) {
      console.error(
        `- ${entry.path}: expected ${entry.expectedCount}, found ${entry.actualCount} (${entry.owner})`,
      );
    }
  }
  process.exit(1);
}

console.log(
  `DTO direct Prisma return check passed (${violations.length} allowlisted violations, 0 new violations).`,
);
