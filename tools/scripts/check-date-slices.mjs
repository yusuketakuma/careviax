#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const ALLOWLIST_PATH = 'tools/date-slice-allowlist.json';
const SCAN_ROOTS = ['src', 'tools/scripts'];
const TARGET_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);
const SKIPPED_PATHS = new Set(['tools/scripts/check-date-slices.mjs']);
const CLASSIFICATIONS = new Set([
  'legacy_jst_helper',
  'local_calendar_todo',
  'utc_audit_log_date',
  'utc_canonical_contract_date',
  'utc_canonical_month_key',
  'utc_job_dedupe_key',
]);
const ISO_DATE_SLICE_PATTERN = /\.toISOString\(\)\.slice\(0,\s*10\)/;

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
    if (typeof entry.needle !== 'string' || !entry.needle) {
      throw new Error(`${label}.needle is required`);
    }
    if (!CLASSIFICATIONS.has(entry.classification)) {
      throw new Error(`${label}.classification is invalid: ${entry.classification}`);
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
    return {
      ...entry,
      actualCount: 0,
    };
  });
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
    if (SKIPPED_PATHS.has(relativePath)) continue;
    if (TARGET_EXTENSIONS.has(path.extname(relativePath))) files.push(relativePath);
  }
  return files.sort();
}

function findOccurrences() {
  const occurrences = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkFiles(root)) {
      const lines = readFileSync(path.join(REPO_ROOT, file), 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (ISO_DATE_SLICE_PATTERN.test(line)) {
          occurrences.push({
            path: file,
            line: index + 1,
            text: line.trim(),
          });
        }
      });
    }
  }
  return occurrences;
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
  console.error('Date-slice check failed.');
  if (unclassified.length > 0) {
    console.error('\nUnclassified direct ISO date slices:');
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
    '\nUse formatDateKey/formatUtcDateKey, or update tools/date-slice-allowlist.json with a domain rationale.',
  );
  process.exit(1);
}

const byClassification = new Map();
for (const entry of entries) {
  byClassification.set(
    entry.classification,
    (byClassification.get(entry.classification) ?? 0) + entry.actualCount,
  );
}

console.log(`Date-slice check passed: ${occurrences.length} classified direct ISO date slices.`);
for (const [classification, count] of [...byClassification.entries()].sort()) {
  console.log(`- ${classification}: ${count}`);
}
