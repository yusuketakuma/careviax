#!/usr/bin/env node
// Query-shape guardrail for critical read paths (QUERY-SHAPE-TEST-002).
//
// This static check intentionally scans only tools/query-shape-watchlist.json.
// It is a ratchet for performance-sensitive read paths, not a whole-repo
// Prisma linter. Add files gradually once their query shapes are bounded.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const WATCHLIST_PATH = 'tools/query-shape-watchlist.json';
const ALLOWLIST_PATH = 'tools/query-shape-allowlist.json';

const PRISMA_CALL_PATTERN =
  /(?:[A-Za-z_$][\w$]*|\))\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*(findMany|count|groupBy)\s*\(/g;

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

function isObjectLiteral(value) {
  return value.trim().startsWith('{');
}

function hasBoundedWhere(whereValue) {
  if (!whereValue) return false;
  return /\b(?:id|[A-Za-z_$][\w$]*_id)\s*:\s*\{[^}]*\bin\s*:/.test(whereValue);
}

function hasStableOrderBy(orderByValue) {
  if (!orderByValue) return false;
  const trimmed = orderByValue.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return true;
  return /(?:^|[,{]\s*)id\s*:/.test(orderByValue);
}

function readJsonEntries(filePath, requiredFields) {
  const raw = readFileSync(path.join(REPO_ROOT, filePath), 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`${filePath} must contain an entries array`);
  }
  return parsed.entries.map((entry, index) => {
    const label = `${filePath}:entries[${index}]`;
    if (!entry || typeof entry !== 'object') throw new Error(`${label} must be an object`);
    for (const field of requiredFields) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`${label}.${field} is required`);
      }
    }
    if (
      'expectedCount' in entry &&
      (typeof entry.expectedCount !== 'number' ||
        !Number.isSafeInteger(entry.expectedCount) ||
        entry.expectedCount < 1)
    ) {
      throw new Error(`${label}.expectedCount must be a positive integer`);
    }
    return { ...entry, actualCount: 0 };
  });
}

function readWatchlist() {
  return readJsonEntries(WATCHLIST_PATH, ['path', 'owner', 'reason']);
}

function readAllowlist() {
  return readJsonEntries(ALLOWLIST_PATH, [
    'path',
    'rule',
    'owner',
    'debtId',
    'reason',
    'plannedAction',
  ]);
}

function findQueryShapeViolationsInFile(file) {
  const content = readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const violations = [];
  const aggregateCallsByDelegate = new Map();
  PRISMA_CALL_PATTERN.lastIndex = 0;
  let match;
  while ((match = PRISMA_CALL_PATTERN.exec(content)) !== null) {
    const delegate = match[1];
    const method = match[2];
    const openParenIndex = content.indexOf('(', match.index);
    const firstArgument = readFirstArgument(content, openParenIndex);
    if (!isObjectLiteral(firstArgument)) continue;

    const line = lineOf(content, match.index);
    const includeValue = readPropertyValue(firstArgument, 'include');
    if (includeValue) {
      violations.push({
        path: file,
        line,
        rule: 'broad_include',
        symbol: method,
        reason: 'Prisma read uses include; use explicit select with bounded nested relations',
      });
    }

    if (method === 'findMany') {
      const takeValue = readPropertyValue(firstArgument, 'take');
      const cursorValue = readPropertyValue(firstArgument, 'cursor');
      const whereValue = readPropertyValue(firstArgument, 'where');
      const orderByValue = readPropertyValue(firstArgument, 'orderBy');

      if (!takeValue && !cursorValue && !hasBoundedWhere(whereValue)) {
        violations.push({
          path: file,
          line,
          rule: 'unbounded_find_many',
          symbol: method,
          reason: 'findMany() must use take/cursor or a bounded id-in where clause',
        });
      }

      if (takeValue && !orderByValue) {
        violations.push({
          path: file,
          line,
          rule: 'missing_stable_order_by',
          symbol: method,
          reason: 'bounded findMany() must specify stable orderBy including id tie-breaker',
        });
      } else if (takeValue && orderByValue && !hasStableOrderBy(orderByValue)) {
        violations.push({
          path: file,
          line,
          rule: 'missing_stable_order_by',
          symbol: method,
          reason: 'orderBy for bounded findMany() must include id tie-breaker',
        });
      }
    }

    if (method === 'count' || method === 'groupBy') {
      const aggregateCalls = aggregateCallsByDelegate.get(delegate) ?? [];
      aggregateCalls.push({ line, method });
      aggregateCallsByDelegate.set(delegate, aggregateCalls);

      const whereValue = readPropertyValue(firstArgument, 'where');
      if (!whereValue) {
        violations.push({
          path: file,
          line,
          rule: 'aggregate_fanout',
          symbol: method,
          reason: `${method}() must have an explicit where clause on critical read paths`,
        });
      }
    }
  }

  for (const [delegate, aggregateCalls] of aggregateCallsByDelegate.entries()) {
    if (aggregateCalls.length < 2) continue;
    violations.push({
      path: file,
      line: aggregateCalls[1].line,
      rule: 'aggregate_fanout',
      symbol: delegate,
      reason:
        `multiple ${delegate}.count/groupBy calls in a watched read path; ` +
        'prefer one grouped/window aggregate or page-derived metadata',
    });
  }

  return violations;
}

function findViolations() {
  const watchlist = readWatchlist();
  return watchlist.flatMap((entry) => findQueryShapeViolationsInFile(entry.path));
}

function allowlistKey(item) {
  return `${item.path}:${item.rule}`;
}

const allowlist = readAllowlist();
const allowByPathAndRule = new Map(allowlist.map((entry) => [allowlistKey(entry), entry]));
const violations = findViolations();
const newViolations = [];

for (const violation of violations) {
  const entry = allowByPathAndRule.get(allowlistKey(violation));
  if (entry) {
    entry.actualCount += 1;
  } else {
    newViolations.push(violation);
  }
}

const staleEntries = allowlist.filter((entry) => entry.actualCount !== entry.expectedCount);

if (newViolations.length > 0 || staleEntries.length > 0) {
  console.error('Query shape check failed.');
  if (newViolations.length > 0) {
    console.error('\nNew query-shape violations:');
    for (const item of newViolations) {
      console.error(`- ${item.path}:${item.line} ${item.rule} (${item.reason})`);
    }
  }
  if (staleEntries.length > 0) {
    console.error('\nStale query-shape allowlist entries:');
    for (const entry of staleEntries) {
      console.error(
        `- ${entry.path}:${entry.rule}: expected ${entry.expectedCount}, found ${entry.actualCount} (${entry.owner})`,
      );
    }
  }
  process.exit(1);
}

console.log(
  `Query shape check passed (${violations.length} allowlisted violations, 0 new violations).`,
);
