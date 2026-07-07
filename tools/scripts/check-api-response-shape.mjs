#!/usr/bin/env node
// Public API response envelope ratchet (API-CONTRACT-001 / MOD-CI-001).
//
// This static check does not claim the API contract is fully migrated. It
// freezes the current debt so new route handlers cannot add non-envelope
// success(...) payloads or route-local legacy error JSON shapes while the
// broader ApiSuccess/ApiError migration burns the allowlist down.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const ALLOWLIST_PATH = 'tools/api-response-shape-allowlist.json';
const SCAN_ROOTS = ['src/app/api'];
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIPPED_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

const DIRECT_LEGACY_ERROR_JSON_PATTERN =
  /\bNextResponse\.json\s*\(\s*\{[^)]*\b(?:error|code|message|fieldErrors)\s*:/gs;

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

function skipQuoted(content, index, quote) {
  let i = index + 1;
  while (i < content.length) {
    const char = content[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === quote) return i + 1;
    i += 1;
  }
  return i;
}

function skipLineComment(content, index) {
  const nextNewline = content.indexOf('\n', index + 2);
  return nextNewline === -1 ? content.length : nextNewline + 1;
}

function skipBlockComment(content, index) {
  const end = content.indexOf('*/', index + 2);
  return end === -1 ? content.length : end + 2;
}

function readFirstArgument(content, openParenIndex) {
  let depth = 0;
  let start = openParenIndex + 1;
  while (start < content.length && /\s/.test(content[start])) start += 1;

  for (let i = start; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];
    if (char === '"' || char === "'" || char === '`') {
      i = skipQuoted(content, i, char) - 1;
      continue;
    }
    if (char === '/' && next === '/') {
      i = skipLineComment(content, i) - 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i = skipBlockComment(content, i) - 1;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === '}' || char === ']') {
      if (depth === 0 && char === ')') {
        return content.slice(start, i).trim();
      }
      depth -= 1;
      continue;
    }
    if (char === ',' && depth === 0) {
      return content.slice(start, i).trim();
    }
  }
  return content.slice(start).trim();
}

function hasTopLevelDataProperty(objectLiteral) {
  let depth = 0;
  for (let i = 0; i < objectLiteral.length; i += 1) {
    const char = objectLiteral[i];
    const next = objectLiteral[i + 1];
    if (char === '"' || char === "'" || char === '`') {
      i = skipQuoted(objectLiteral, i, char) - 1;
      continue;
    }
    if (char === '/' && next === '/') {
      i = skipLineComment(objectLiteral, i) - 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i = skipBlockComment(objectLiteral, i) - 1;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth -= 1;
      continue;
    }
    if (depth === 1 && objectLiteral.slice(i).match(/^data\s*(?:,|:)/)) return true;
  }
  return false;
}

function isEnvelopeSuccessArgument(argument) {
  const trimmed = argument.trim();
  if (!trimmed.startsWith('{')) return false;
  return hasTopLevelDataProperty(trimmed);
}

function findSuccessShapeViolations(content, file) {
  const violations = [];
  const pattern = /\bsuccess\s*\(/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const openParenIndex = content.indexOf('(', match.index);
    const firstArgument = readFirstArgument(content, openParenIndex);
    if (isEnvelopeSuccessArgument(firstArgument)) continue;
    violations.push({
      path: file,
      line: lineOf(content, match.index),
      symbol: 'success',
      reason: 'success() response is not wrapped in { data, meta? }',
    });
  }
  return violations;
}

function findDirectLegacyErrorViolations(content, file) {
  const violations = [];
  DIRECT_LEGACY_ERROR_JSON_PATTERN.lastIndex = 0;
  let match;
  while ((match = DIRECT_LEGACY_ERROR_JSON_PATTERN.exec(content)) !== null) {
    violations.push({
      path: file,
      line: lineOf(content, match.index),
      symbol: 'NextResponse.json',
      reason: 'route-local error response is not wrapped in { error: { ... } }',
    });
  }
  return violations;
}

function findViolations() {
  const violations = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkFiles(root)) {
      const content = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      violations.push(...findSuccessShapeViolations(content, file));
      violations.push(...findDirectLegacyErrorViolations(content, file));
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
  console.error('API response shape check failed.');
  if (newViolations.length > 0) {
    console.error('\nNew API response envelope violations:');
    for (const item of newViolations) {
      console.error(`- ${item.path}:${item.line} ${item.symbol} (${item.reason})`);
    }
  }
  if (staleEntries.length > 0) {
    console.error('\nStale API response shape allowlist entries:');
    for (const entry of staleEntries) {
      console.error(
        `- ${entry.path}: expected ${entry.expectedCount}, found ${entry.actualCount} (${entry.owner})`,
      );
    }
  }
  process.exit(1);
}

console.log(
  `API response shape check passed (${violations.length} allowlisted violations, 0 new violations).`,
);
