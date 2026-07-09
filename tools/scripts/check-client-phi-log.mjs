#!/usr/bin/env node
/**
 * PHI-safe client observability guard.
 *
 * Passing raw Error objects, `.message`, `.stack`, or `.componentStack`
 * directly to the browser console can leak patient names, addresses, insurance
 * numbers, or other PHI through error messages and stacks.
 *
 * This guard detects `console.<level>(...)` calls that directly pass bare error
 * identifiers (error / err / e / cause / exception / ex), raw messages, raw
 * stacks, `String(error)`, or template interpolation. Safe output should use
 * `clientLog` (src/lib/utils/client-log.ts), coded reasons, or generic messages.
 *
 * Known exceptions must be registered in tools/client-phi-log-allowlist.json
 * with a domain rationale.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const ALLOWLIST_PATH = 'tools/client-phi-log-allowlist.json';
const SCAN_ROOTS = ['src'];
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIPPED_PATHS = new Set(['tools/scripts/check-client-phi-log.mjs']);

const BARE_ERROR_ARG_PATTERN = /^(error|err|e|cause|exception|ex)$/;
const RAW_STACK_PATTERN = /\.(stack|componentStack)\b/;
const ERROR_MESSAGE_PATTERN =
  /^(error|err|e|cause|exception|ex)(?:\s+as\s+[A-Za-z0-9_.<>{}\[\]\s]+)?\.(message|stack|componentStack)$/;
const STRING_ERROR_PATTERN = /^String\(\s*(error|err|e|cause|exception|ex)\s*\)$/;
const TEMPLATE_ERROR_PATTERN = /\$\{\s*(?:String\(\s*)?(error|err|e|cause|exception|ex)\b/u;

function isTestFile(relativePath) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath);
}

function readAllowlist() {
  let raw;
  try {
    raw = readFileSync(path.join(REPO_ROOT, ALLOWLIST_PATH), 'utf8');
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`${ALLOWLIST_PATH} must contain an entries array`);
  }
  return parsed.entries.map((entry, index) => {
    const label = `${ALLOWLIST_PATH}:entries[${index}]`;
    if (!entry || typeof entry !== 'object') throw new Error(`${label} must be an object`);
    if (typeof entry.path !== 'string' || !entry.path) throw new Error(`${label}.path is required`);
    if (typeof entry.needle !== 'string' || !entry.needle) {
      throw new Error(`${label}.needle is required`);
    }
    if (typeof entry.reason !== 'string' || !entry.reason) {
      throw new Error(`${label}.reason is required`);
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

function walkFiles(root) {
  const absoluteRoot = path.join(REPO_ROOT, root);
  const files = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let stats;
    try {
      stats = statSync(current);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      for (const child of readdirSync(current)) {
        if (child === 'node_modules' || child === '.next') continue;
        stack.push(path.join(current, child));
      }
      continue;
    }
    if (!stats.isFile()) continue;
    const relativePath = path.relative(REPO_ROOT, current).split(path.sep).join('/');
    if (SKIPPED_PATHS.has(relativePath)) continue;
    if (isTestFile(relativePath)) continue;
    if (TARGET_EXTENSIONS.has(path.extname(relativePath))) files.push(relativePath);
  }
  return files.sort();
}

function findOccurrences() {
  const occurrences = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkFiles(root)) {
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      for (const call of findConsoleCalls(source)) {
        if (consoleCallHasUnsafeErrorArgument(call.argsText)) {
          occurrences.push({ path: file, line: call.line, text: normalizeSnippet(call.text) });
        }
      }
    }
  }
  return occurrences;
}

function findCallEnd(source, parenIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = parenIndex + 1; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      if (depth === 0 && char === ')') return i;
      depth = Math.max(0, depth - 1);
    }
  }
  return source.length - 1;
}

function findConsoleCalls(source) {
  const calls = [];
  const pattern = /console\.(log|warn|error|info|debug)\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const parenIndex = source.indexOf('(', match.index);
    const endIndex = findCallEnd(source, parenIndex);
    const argsText = source.slice(parenIndex + 1, endIndex);
    calls.push({
      argsText,
      line: source.slice(0, match.index).split(/\r?\n/).length,
      text: source.slice(match.index, endIndex + 1),
    });
  }
  return calls;
}

function normalizeSnippet(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function splitTopLevelArgs(argsText) {
  const args = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = 0; i < argsText.length; i += 1) {
    const char = argsText[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === ',' && depth === 0) {
      args.push(argsText.slice(start, i).trim());
      start = i + 1;
    }
  }
  const lastArg = argsText.slice(start).trim();
  if (lastArg) args.push(lastArg);
  return args;
}

function normalizeArgument(arg) {
  return arg
    .trim()
    .replace(/!$/u, '')
    .replace(/\s+as\s+[A-Za-z0-9_.<>{}\[\]\s]+$/u, '');
}

function consoleCallHasUnsafeErrorArgument(argsText) {
  return splitTopLevelArgs(argsText).some((arg) => {
    const normalized = normalizeArgument(arg);
    return (
      BARE_ERROR_ARG_PATTERN.test(normalized) ||
      ERROR_MESSAGE_PATTERN.test(normalized) ||
      STRING_ERROR_PATTERN.test(normalized) ||
      TEMPLATE_ERROR_PATTERN.test(normalized) ||
      RAW_STACK_PATTERN.test(normalized)
    );
  });
}

function classifyOccurrence(occurrence, entries) {
  const matches = entries.filter(
    (entry) => entry.path === occurrence.path && occurrence.text.includes(entry.needle),
  );
  if (matches.length !== 1) {
    return {
      ok: false,
      reason:
        matches.length === 0
          ? 'not listed in allowlist'
          : `matched ${matches.length} allowlist entries`,
    };
  }
  matches[0].actualCount += 1;
  return { ok: true };
}

const entries = readAllowlist();
const occurrences = findOccurrences();
const unclassified = [];
for (const occurrence of occurrences) {
  const result = classifyOccurrence(occurrence, entries);
  if (!result.ok) {
    unclassified.push({ ...occurrence, reason: result.reason });
  }
}

const staleEntries = entries.filter((entry) => entry.actualCount !== entry.expectedCount);

if (unclassified.length > 0 || staleEntries.length > 0) {
  console.error('Client PHI-log check failed.');
  if (unclassified.length > 0) {
    console.error('\nRaw error objects / stacks passed to console:');
    for (const item of unclassified) {
      console.error(`- ${item.path}:${item.line} (${item.reason})`);
      console.error(`  ${item.text}`);
    }
  }
  if (staleEntries.length > 0) {
    console.error('\nStale allowlist entries:');
    for (const entry of staleEntries) {
      console.error(
        `- ${entry.path} needle=${JSON.stringify(entry.needle)} expected=${entry.expectedCount} actual=${entry.actualCount}`,
      );
    }
  }
  console.error(
    '\nUse clientLog (src/lib/utils/client-log.ts) or a coded/generic message, or register the ' +
      'occurrence in tools/client-phi-log-allowlist.json with a domain rationale.',
  );
  process.exit(1);
}

console.log(
  `Client PHI-log check passed: ${occurrences.length} allowlisted raw-error console call(s).`,
);
