#!/usr/bin/env node
// Read-path SLO guardrail (PERF-DB-READ-SLO-001).
//
// This validates the machine-readable SLO table for critical read paths. It
// intentionally checks the contract, not live latency: runtime proof still
// belongs to perf smoke / APM evidence.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const SLO_PATH = 'tools/read-path-slo.json';
const PAYLOAD_BUDGETS_PATH = 'src/lib/utils/route-payload-budgets.ts';
const APP_API_ROOT = 'src/app/api';

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
    entries.set(routeMetricsKey(method, route), {
      family,
      method,
      route,
      budget_bytes: budgetBytes,
    });
  }
  if (entries.size === 0) fail(`no payload budgets parsed from ${PAYLOAD_BUDGETS_PATH}`);
  return entries;
}

function validateEntry(entry, index, payloadBudgetByRoute) {
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

  const payloadBudget = payloadBudgetByRoute.get(routeMetricsKey(entry.method, entry.route));
  if (!payloadBudget) {
    fail(`${label}.route is not configured in ${PAYLOAD_BUDGETS_PATH}`);
  }
  if (payloadBudget.budget_bytes == null) {
    fail(`${label}.family points to an unconfigured payload budget`);
  }
  if (entry.family !== payloadBudget.family) {
    fail(`${label}.family does not match route payload budget`, [
      `expected ${payloadBudget.family}`,
      `actual ${entry.family}`,
    ]);
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

// --- Declared-vs-implemented take/bound drift check -------------------------
//
// The registry check above proves the SLO table is internally consistent. This
// second phase reconciles each declared read-path bound against the actual
// Prisma query shape in the route handler: an SLO that declares max_rows but
// whose list query has no take/cursor/id-in bound (or a take that exceeds the
// declared max) is a silent drift that can regress into a full-table load.
//
// It is a ratchet, not a whole-repo linter: only routes whose query lives
// inline in the mapped route.ts are analyzed (delegated service queries are out
// of scope here), and pre-existing bounded-by-window reads are recorded as
// known_take_drift so the gate stays green while new drift fails.

const DRIFT_REQUIRED_FIELDS = [
  'route',
  'method',
  'model',
  'rule',
  'expectedCount',
  'owner',
  'reason',
];

// Mirrors check-query-shape.mjs: `<receiver>.<model>.findMany(` for delegate
// list reads. Nested relation `take`s are not delegate calls, so they are
// naturally excluded and only top-level list queries are inspected.
const FIND_MANY_CALL_PATTERN =
  /(?:[A-Za-z_$][\w$]*|\))\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*(findMany)\s*\(/g;

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
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
      if (depth === 0 && char === ')') return content.slice(start, i).trim();
      depth -= 1;
      continue;
    }
    if (char === ',' && depth === 0) return content.slice(start, i).trim();
  }

  return content.slice(start).trim();
}

function readPropertyValue(objectLiteral, propertyName) {
  if (!objectLiteral.trim().startsWith('{')) return null;
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
    if (depth !== 1) continue;

    const rest = objectLiteral.slice(i);
    const propertyMatch = rest.match(
      new RegExp(`^(?:${propertyName}|['"]${propertyName}['"])\\s*:`),
    );
    if (!propertyMatch) continue;

    let valueStart = i + propertyMatch[0].length;
    while (valueStart < objectLiteral.length && /\s/.test(objectLiteral[valueStart])) {
      valueStart += 1;
    }

    let valueDepth = 0;
    for (let j = valueStart; j < objectLiteral.length; j += 1) {
      const valueChar = objectLiteral[j];
      const valueNext = objectLiteral[j + 1];
      if (valueChar === '"' || valueChar === "'" || valueChar === '`') {
        j = skipQuoted(objectLiteral, j, valueChar) - 1;
        continue;
      }
      if (valueChar === '/' && valueNext === '/') {
        j = skipLineComment(objectLiteral, j) - 1;
        continue;
      }
      if (valueChar === '/' && valueNext === '*') {
        j = skipBlockComment(objectLiteral, j) - 1;
        continue;
      }
      if (valueChar === '{' || valueChar === '[' || valueChar === '(') {
        valueDepth += 1;
        continue;
      }
      if (valueChar === '}' || valueChar === ']' || valueChar === ')') {
        if (valueDepth === 0 && valueChar === '}') {
          return objectLiteral.slice(valueStart, j).trim();
        }
        valueDepth -= 1;
        continue;
      }
      if (valueChar === ',' && valueDepth === 0) {
        return objectLiteral.slice(valueStart, j).trim();
      }
    }
    return objectLiteral.slice(valueStart).trim();
  }

  return null;
}

// A where clause bounded by an explicit id-in list caps row count without a take.
function hasBoundedWhere(whereValue) {
  if (!whereValue) return false;
  return /\b(?:id|[A-Za-z_$][\w$]*_id)\s*:\s*\{[^}]*\bin\s*:/.test(whereValue);
}

// Resolve `const NAME = <int>` (optionally typed) declared in the same file so a
// take expressed as a named constant can still be compared to max_rows.
function resolveIntConstant(content, name) {
  const identifier = name.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(identifier)) return null;
  const match = content.match(new RegExp(`const\\s+${identifier}\\s*(?::[^=\\n]+)?=\\s*(\\d+)\\b`));
  return match ? Number.parseInt(match[1], 10) : null;
}

// Map an SLO route (`/api/patients/:id/overview`) to its App Router handler file
// (`src/app/api/patients/[id]/overview/route.ts`).
export function routeToRouteFile(route) {
  const withParams = route.replace(/:([A-Za-z_$][\w$]*)/g, '[$1]');
  const withoutApiPrefix = withParams.replace(/^\/api(?=\/|$)/, '');
  return path.posix.join(APP_API_ROOT, `.${withoutApiPrefix}`, 'route.ts');
}

// Inspect one route file and return the take/bound drift findings for one SLO
// entry. numericMax is the declared max_rows.
export function findTakeDriftInSource(content, entry) {
  const findings = [];
  FIND_MANY_CALL_PATTERN.lastIndex = 0;
  let match;
  while ((match = FIND_MANY_CALL_PATTERN.exec(content)) !== null) {
    const model = match[1];
    const openParenIndex = content.indexOf('(', match.index);
    const firstArgument = readFirstArgument(content, openParenIndex);
    if (!firstArgument.trim().startsWith('{')) continue;

    const line = lineOf(content, match.index);
    const takeValue = readPropertyValue(firstArgument, 'take');
    const cursorValue = readPropertyValue(firstArgument, 'cursor');
    const whereValue = readPropertyValue(firstArgument, 'where');

    if (!takeValue) {
      if (!cursorValue && !hasBoundedWhere(whereValue)) {
        findings.push({
          route: entry.route,
          method: entry.method,
          model,
          rule: 'slo_take_missing',
          line,
          detail: `${model}.findMany() has no take/cursor/id-in bound but SLO declares max_rows ${entry.max_rows}`,
        });
      }
      continue;
    }

    let numericTake = null;
    const trimmedTake = takeValue.trim();
    if (/^\d+$/.test(trimmedTake)) {
      numericTake = Number.parseInt(trimmedTake, 10);
    } else {
      numericTake = resolveIntConstant(content, trimmedTake);
    }
    if (numericTake != null && numericTake > entry.max_rows) {
      findings.push({
        route: entry.route,
        method: entry.method,
        model,
        rule: 'slo_take_exceeds_max_rows',
        line,
        detail: `${model}.findMany() take ${numericTake} exceeds SLO max_rows ${entry.max_rows}`,
      });
    }
  }
  return findings;
}

function driftKey(item) {
  return `${item.method.toUpperCase()} ${item.route} :: ${item.model} :: ${item.rule}`;
}

function validateKnownDriftEntry(entry, index) {
  const label = `${SLO_PATH}:known_take_drift[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    fail(`${label} must be an object`);
  }
  for (const field of DRIFT_REQUIRED_FIELDS) {
    if (!(field in entry)) fail(`${label}.${field} is required`);
  }
  assertString(entry.route, `${label}.route`);
  assertString(entry.method, `${label}.method`);
  assertString(entry.model, `${label}.model`);
  assertString(entry.rule, `${label}.rule`);
  assertString(entry.owner, `${label}.owner`);
  assertString(entry.reason, `${label}.reason`);
  assertPositiveInteger(entry.expectedCount, `${label}.expectedCount`);
}

// Analyzes SLO route sources for declared-vs-implemented drift, reconciling
// against the known_take_drift ratchet. `readSource` is injectable for tests;
// it returns the file contents or null when the route has no inline handler.
export function checkReadPathDrift(slo, readSource = defaultReadSource) {
  const known = Array.isArray(slo.known_take_drift) ? slo.known_take_drift : [];
  for (const [index, entry] of known.entries()) {
    validateKnownDriftEntry(entry, index);
  }
  const knownByKey = new Map();
  for (const entry of known) {
    const key = driftKey(entry);
    if (knownByKey.has(key)) fail(`duplicate known_take_drift entry: ${key}`);
    knownByKey.set(key, { ...entry, actualCount: 0 });
  }

  const newDrift = [];
  for (const entry of slo.entries) {
    const source = readSource(entry.route);
    if (source == null) continue; // Query delegated to a service module: out of scope for this ratchet.
    for (const finding of findTakeDriftInSource(source, entry)) {
      const record = knownByKey.get(driftKey(finding));
      if (record) {
        record.actualCount += 1;
      } else {
        newDrift.push(finding);
      }
    }
  }

  const staleKnown = [...knownByKey.values()].filter(
    (entry) => entry.actualCount !== entry.expectedCount,
  );

  if (newDrift.length > 0 || staleKnown.length > 0) {
    console.error('Read path SLO drift check failed.');
    if (newDrift.length > 0) {
      console.error('\nNew declared-vs-implemented take/bound drift:');
      for (const item of newDrift) {
        console.error(`- ${item.method} ${item.route}:${item.line} ${item.rule} (${item.detail})`);
      }
      console.error(
        '\nBound the query with take/cursor (or an id-in where), align the SLO max_rows, ' +
          'or register a reasoned known_take_drift entry in tools/read-path-slo.json.',
      );
    }
    if (staleKnown.length > 0) {
      console.error('\nStale known_take_drift entries:');
      for (const entry of staleKnown) {
        console.error(
          `- ${entry.method} ${entry.route} ${entry.model} ${entry.rule}: ` +
            `expected ${entry.expectedCount}, found ${entry.actualCount} (${entry.owner})`,
        );
      }
    }
    process.exit(1);
  }

  const totalKnown = [...knownByKey.values()].reduce((sum, entry) => sum + entry.actualCount, 0);
  return { knownCount: totalKnown };
}

function defaultReadSource(route) {
  const file = routeToRouteFile(route);
  const absolute = path.join(REPO_ROOT, file);
  if (!existsSync(absolute)) return null;
  return readFileSync(absolute, 'utf8');
}

export function checkReadPathSlo(slo, payloadBudgetByRoute) {
  if (!slo || !Array.isArray(slo.entries)) {
    fail(`${SLO_PATH} must contain an entries array`);
  }

  const seenRoutes = new Set();
  for (const [index, entry] of slo.entries.entries()) {
    validateEntry(entry, index, payloadBudgetByRoute);

    const routeKey = routeMetricsKey(entry.method, entry.route);
    if (seenRoutes.has(routeKey)) fail(`duplicate read SLO route: ${routeKey}`);
    seenRoutes.add(routeKey);
  }

  const missingFamilies = [];
  for (const definition of payloadBudgetByRoute.values()) {
    if (definition.method !== 'GET' || definition.budget_bytes == null) continue;
    const routeKey = routeMetricsKey(definition.method, definition.route);
    if (!seenRoutes.has(routeKey))
      missingFamilies.push(`${definition.family} (${definition.route})`);
  }
  if (missingFamilies.length > 0) {
    fail(
      'all configured GET payload budget families must have read SLO entries',
      missingFamilies.map((family) => `- ${family}`),
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const slo = readJson(SLO_PATH);
  checkReadPathSlo(slo, readPayloadBudgets());
  console.log('Read path SLO check passed.');
  const { knownCount } = checkReadPathDrift(slo);
  console.log(
    `Read path SLO drift check passed (${knownCount} known take-drift occurrences, 0 new drift).`,
  );
}
