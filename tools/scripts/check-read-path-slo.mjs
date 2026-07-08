#!/usr/bin/env node
// Read-path SLO guardrail (PERF-DB-READ-SLO-001).
//
// This validates the machine-readable SLO table for critical read paths. It
// intentionally checks the contract, not live latency: runtime proof still
// belongs to perf smoke / APM evidence.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const SLO_PATH = 'tools/read-path-slo.json';
const PAYLOAD_BUDGETS_PATH = 'src/lib/utils/route-payload-budgets.ts';

const REQUIRED_FIELDS = [
  'family',
  'method',
  'route',
  'p95_target_ms',
  'p99_target_ms',
  'payload_budget_bytes',
  'max_rows',
  'max_include_depth',
  'max_query_count',
  'count_basis',
  'expected_indexes',
  'owner',
  'notes',
];

function fail(message, details = []) {
  console.error('Read path SLO check failed.');
  console.error(`- ${message}`);
  for (const detail of details) console.error(`  ${detail}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, filePath), 'utf8'));
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${label} must be a non-empty string`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive integer`);
  }
}

function routeMetricsKey(method, route) {
  return `${method.toUpperCase()} ${route}`;
}

function isSafeRoute(route) {
  return (
    typeof route === 'string' &&
    route.startsWith('/') &&
    !route.startsWith('//') &&
    !/[?#]/.test(route)
  );
}

function parseBudgetExpression(value) {
  const trimmed = value.trim();
  if (trimmed === 'null') return null;
  const kibMatch = trimmed.match(/^(\d+)\s*\*\s*KIB$/);
  if (kibMatch) return Number.parseInt(kibMatch[1], 10) * 1024;
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  return undefined;
}

function readPayloadBudgets() {
  const content = readFileSync(path.join(REPO_ROOT, PAYLOAD_BUDGETS_PATH), 'utf8');
  const entries = new Map();
  const blockPattern =
    /\{\s*method:\s*'([^']+)'\s*,\s*route:\s*'([^']+)'\s*,\s*family:\s*'([^']+)'\s*,\s*budget_bytes:\s*([^,\n}]+)\s*,?\s*\}/gs;
  let match;
  while ((match = blockPattern.exec(content)) !== null) {
    const [, method, route, family, budgetExpression] = match;
    const budgetBytes = parseBudgetExpression(budgetExpression);
    if (budgetBytes === undefined) {
      fail(`could not parse payload budget for ${family}: ${budgetExpression}`);
    }
    entries.set(family, {
      family,
      method,
      route,
      budget_bytes: budgetBytes,
    });
  }
  if (entries.size === 0) fail(`no payload budgets parsed from ${PAYLOAD_BUDGETS_PATH}`);
  return entries;
}

function validateEntry(entry, index, payloadBudgetByFamily) {
  const label = `${SLO_PATH}:entries[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    fail(`${label} must be an object`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in entry)) fail(`${label}.${field} is required`);
  }

  assertString(entry.family, `${label}.family`);
  assertString(entry.method, `${label}.method`);
  assertString(entry.route, `${label}.route`);
  assertString(entry.count_basis, `${label}.count_basis`);
  assertString(entry.owner, `${label}.owner`);
  assertString(entry.notes, `${label}.notes`);

  if (entry.method !== entry.method.toUpperCase()) {
    fail(`${label}.method must be uppercase`);
  }
  if (!isSafeRoute(entry.route)) {
    fail(`${label}.route must be an app-relative pathname without query or hash`);
  }
  for (const field of [
    'p95_target_ms',
    'p99_target_ms',
    'payload_budget_bytes',
    'max_rows',
    'max_include_depth',
    'max_query_count',
  ]) {
    assertPositiveInteger(entry[field], `${label}.${field}`);
  }
  if (entry.p99_target_ms < entry.p95_target_ms) {
    fail(`${label}.p99_target_ms must be greater than or equal to p95_target_ms`);
  }
  if (!Array.isArray(entry.expected_indexes) || entry.expected_indexes.length === 0) {
    fail(`${label}.expected_indexes must be a non-empty array`);
  }
  for (const [expectedIndex, value] of entry.expected_indexes.entries()) {
    assertString(value, `${label}.expected_indexes[${expectedIndex}]`);
  }

  const payloadBudget = payloadBudgetByFamily.get(entry.family);
  if (!payloadBudget) {
    fail(`${label}.family is not configured in ${PAYLOAD_BUDGETS_PATH}`);
  }
  if (payloadBudget.budget_bytes == null) {
    fail(`${label}.family points to an unconfigured payload budget`);
  }
  if (entry.method !== payloadBudget.method) {
    fail(`${label}.method does not match route payload budget`, [
      `expected ${payloadBudget.method}`,
      `actual ${entry.method}`,
    ]);
  }
  if (entry.route !== payloadBudget.route) {
    fail(`${label}.route does not match route payload budget`, [
      `expected ${payloadBudget.route}`,
      `actual ${entry.route}`,
    ]);
  }
  if (entry.payload_budget_bytes !== payloadBudget.budget_bytes) {
    fail(`${label}.payload_budget_bytes does not match route payload budget`, [
      `expected ${payloadBudget.budget_bytes}`,
      `actual ${entry.payload_budget_bytes}`,
    ]);
  }
}

export function checkReadPathSlo(slo, payloadBudgetByFamily) {
  if (!slo || !Array.isArray(slo.entries)) {
    fail(`${SLO_PATH} must contain an entries array`);
  }

  const seenFamilies = new Set();
  const seenRoutes = new Set();
  for (const [index, entry] of slo.entries.entries()) {
    validateEntry(entry, index, payloadBudgetByFamily);
    if (seenFamilies.has(entry.family)) fail(`duplicate read SLO family: ${entry.family}`);
    seenFamilies.add(entry.family);

    const routeKey = routeMetricsKey(entry.method, entry.route);
    if (seenRoutes.has(routeKey)) fail(`duplicate read SLO route: ${routeKey}`);
    seenRoutes.add(routeKey);
  }

  const missingFamilies = [];
  for (const [family, definition] of payloadBudgetByFamily.entries()) {
    if (definition.method !== 'GET' || definition.budget_bytes == null) continue;
    if (!seenFamilies.has(family)) missingFamilies.push(family);
  }
  if (missingFamilies.length > 0) {
    fail(
      'all configured GET payload budget families must have read SLO entries',
      missingFamilies.map((family) => `- ${family}`),
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkReadPathSlo(readJson(SLO_PATH), readPayloadBudgets());
  console.log('Read path SLO check passed.');
}
