#!/usr/bin/env node
// Raw Prisma read org-scope guardrail (RLS-RAW-READ-GUARD-001).
//
// Read paths that call the raw `prisma` client directly (i.e. NOT the RLS
// transaction client `tx` handed out by withOrgContext / createScopedTxRunner)
// bypass PostgreSQL Row-Level Security. Their only tenant isolation is an
// app-layer `where: { org_id: ... }` filter — a single layer of defense. When
// that filter is missing, a raw read can leak rows across tenants.
//
// This static check scans API route handlers (src/app/api/**/route.ts) and
// server modules (src/server/**) for raw `prisma.<model>.<readMethod>(...)`
// call-sites. Each call-site must satisfy ONE of:
//   1. org scope — the argument's `where` subtree carries an org_id/orgId token
//      (app-layer defense present). Tokens found only in `select`/`include` or in
//      comments do NOT count: selecting org_id as a column provides zero tenant
//      isolation, so only the `where` filter is treated as org-scoping; OR
//   2. RLS scope — the read runs on the `tx` client (not matched here, because
//      we only flag the `prisma` receiver); OR
//   3. an explicit allowlist entry with a documented reason (global master
//      tables, id-then-org-recheck patterns, etc.).
//
// Existing debt is frozen in tools/raw-read-org-guard-allowlist.json so it can
// burn down entry by entry. New unscoped raw reads fail CI.
//
// Rationale for scoping to the `prisma` receiver: inside withOrgContext the code
// uses the injected `tx` client, so a read on the global `prisma` client is,
// by construction, outside a scoped transaction. `tx` reads are RLS-protected
// and intentionally out of scope here. `db`-style parameters are ambiguous
// (a service may receive either `prisma` or a scoped `tx`) and are likewise
// left out to keep the guard precise and false-positive-free.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const ALLOWLIST_PATH = 'tools/raw-read-org-guard-allowlist.json';

const SCAN_TARGETS = [
  { root: 'src/app/api', onlyRouteFiles: true },
  { root: 'src/server', onlyRouteFiles: false },
];

const TARGET_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIPPED_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

const READ_METHODS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

// Matches `prisma.<model>.<readMethod>(` — the raw client receiver only.
const RAW_READ_PATTERN =
  /\bprisma\s*\.\s*([A-Za-z_$][\w$]*)\s*\.\s*(findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|count|aggregate|groupBy)\s*\(/g;

// Org-scope token anywhere in the argument object literal (where/select tree).
const ORG_SCOPE_PATTERN = /\borg_?[iI]d\b/;

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10 /* \n */) line += 1;
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

// Returns the source text of the first call argument (trimmed), correctly
// skipping strings, comments, and nested brackets.
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

function isObjectLiteral(value) {
  return value.trim().startsWith('{');
}

function isBareIdentifier(value) {
  return /^[A-Za-z_$][\w$]*$/.test(value.trim());
}

// Reads the value of `propertyName` from a `{ ... }` object literal, returning
// the raw source text of the value (or null if the property is absent). Mirrors
// the bracket/quote/comment-aware reader used by check-query-shape.mjs.
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
        if (valueDepth === 0 && valueChar === '}') return objectLiteral.slice(valueStart, j).trim();
        valueDepth -= 1;
        continue;
      }
      if (valueChar === ',' && valueDepth === 0) return objectLiteral.slice(valueStart, j).trim();
    }
    return objectLiteral.slice(valueStart).trim();
  }
  return null;
}

// Reads the balanced right-hand side of an assignment, starting just after the
// `=` sign, up to the top-level statement terminator (`;` at depth 0).
function readBalancedExpr(content, startIndex) {
  let depth = 0;
  let i = startIndex;
  while (i < content.length && /\s/.test(content[i])) i += 1;
  const start = i;
  for (; i < content.length; i += 1) {
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
      depth -= 1;
      continue;
    }
    if (char === ';' && depth === 0) return content.slice(start, i).trim();
  }
  return content.slice(start).trim();
}

// Finds `const|let|var NAME [: Type] = <expr>` and returns the expr text, or null.
function findAssignmentExpr(content, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b[^=;\\n]*?=`, 'g');
  const match = pattern.exec(content);
  if (!match) return null;
  return readBalancedExpr(content, match.index + match[0].length);
}

// Bare-identifier spreads (`...foo`) but NOT spread-calls (`...foo(...)`).
function collectSpreadIdentifiers(expr) {
  const idents = new Set();
  for (const m of expr.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)\b(?!\s*\()/g)) idents.add(m[1]);
  return idents;
}

// Removes `//` and block comments from a source fragment, preserving string
// literal contents. Used so an org_id token buried in a comment never counts as
// an org filter (a comment provides zero tenant isolation).
function stripComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' || char === "'" || char === '`') {
      const end = skipQuoted(text, i, char);
      out += text.slice(i, end);
      i = end - 1;
      continue;
    }
    if (char === '/' && next === '/') {
      i = skipLineComment(text, i) - 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i = skipBlockComment(text, i) - 1;
      continue;
    }
    out += char;
  }
  return out;
}

// Decides whether a `where` clause expression is org-scoped: an org_id/orgId
// token appears in the (comment-stripped) where text, or transitively in any
// variable/spread the where resolves to. Only the `where` subtree is inspected —
// tokens in `select`/`include` do not reach this function.
function whereIsOrgScoped(content, whereExpr, visited = new Set(), depth = 0) {
  if (depth > 6) return false;
  const trimmed = whereExpr.trim();
  if (!trimmed) return false;
  if (ORG_SCOPE_PATTERN.test(stripComments(trimmed))) return true;

  const idents = new Set();
  if (isBareIdentifier(trimmed)) {
    idents.add(trimmed);
  } else {
    // Object literal or fragment: resolve any spread identifiers it pulls in.
    for (const id of collectSpreadIdentifiers(trimmed)) idents.add(id);
  }

  for (const id of idents) {
    if (visited.has(id)) continue;
    visited.add(id);
    const rhs = findAssignmentExpr(content, id);
    if (rhs && whereIsOrgScoped(content, rhs, visited, depth + 1)) return true;
  }
  return false;
}

// Decides whether a Prisma read argument (object literal, or a variable holding
// one) is org-scoped. Org scope is established ONLY by an org_id/orgId token in
// the `where` subtree (resolved transitively through variables/spreads) — never
// by a token that appears only in `select`/`include` or in a comment, which
// provide no tenant isolation.
function argIsOrgScoped(content, arg, visited = new Set(), depth = 0) {
  if (depth > 6) return false;
  const trimmed = arg.trim();

  if (isBareIdentifier(trimmed)) {
    // A variable holding the full args object → resolve and inspect its where.
    if (visited.has(trimmed)) return false;
    visited.add(trimmed);
    const rhs = findAssignmentExpr(content, trimmed);
    return rhs ? argIsOrgScoped(content, rhs, visited, depth + 1) : false;
  }

  if (isObjectLiteral(trimmed)) {
    const whereValue = readPropertyValue(trimmed, 'where');
    if (whereValue) {
      return whereIsOrgScoped(content, whereValue, visited, depth + 1);
    }
    if (/[,{]\s*where\s*[,}]/.test(trimmed)) {
      // `where` shorthand property → resolve the variable named `where`.
      return whereIsOrgScoped(content, 'where', visited, depth + 1);
    }
    // Top-level spreads of the whole args object (e.g. `...baseArgs`) may carry
    // a where subtree; resolve each and inspect it as a full args object.
    for (const id of collectSpreadIdentifiers(trimmed)) {
      if (visited.has(id)) continue;
      visited.add(id);
      const rhs = findAssignmentExpr(content, id);
      if (rhs && argIsOrgScoped(content, rhs, visited, depth + 1)) return true;
    }
  }
  return false;
}

function walkFiles(root, onlyRouteFiles) {
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
    if (SKIPPED_SUFFIXES.some((suffix) => relativePath.endsWith(suffix))) continue;
    if (!TARGET_EXTENSIONS.has(path.extname(relativePath))) continue;
    if (onlyRouteFiles && path.basename(relativePath) !== 'route.ts') continue;
    files.push(relativePath);
  }
  return files.sort();
}

function findViolationsInFile(file) {
  const content = readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const violations = [];
  RAW_READ_PATTERN.lastIndex = 0;
  let match;
  while ((match = RAW_READ_PATTERN.exec(content)) !== null) {
    const method = match[2];
    if (!READ_METHODS.has(method)) continue;
    const openParenIndex = content.indexOf('(', match.index + match[0].length - 1);
    const firstArgument = readFirstArgument(content, openParenIndex);
    const line = lineOf(content, match.index);

    if (argIsOrgScoped(content, firstArgument)) continue;

    if (!isObjectLiteral(firstArgument) && !isBareIdentifier(firstArgument)) {
      // Args built by a call/spread expression cannot be statically resolved to
      // an org filter. Treat as debt requiring an allowlist reason.
      violations.push({
        path: file,
        line,
        rule: 'unverifiable_org_scope',
        symbol: method,
        reason: `prisma.${match[1]}.${method}() receives non-literal args; org scope cannot be verified statically`,
      });
      continue;
    }

    violations.push({
      path: file,
      line,
      rule: 'missing_org_scope',
      symbol: method,
      reason: `raw prisma.${match[1]}.${method}() has no org_id filter and runs outside withOrgContext (RLS bypassed)`,
    });
  }
  return violations;
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
    for (const field of ['path', 'rule', 'owner', 'debtId', 'reason', 'plannedAction']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`${label}.${field} is required`);
      }
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

function findViolations() {
  const violations = [];
  for (const target of SCAN_TARGETS) {
    for (const file of walkFiles(target.root, target.onlyRouteFiles)) {
      violations.push(...findViolationsInFile(file));
    }
  }
  return violations;
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
  console.error('Raw read org-guard check failed.');
  if (newViolations.length > 0) {
    console.error('\nNew unscoped raw prisma reads:');
    for (const item of newViolations) {
      console.error(`- ${item.path}:${item.line} ${item.rule} (${item.reason})`);
    }
  }
  if (staleEntries.length > 0) {
    console.error('\nStale raw read org-guard allowlist entries:');
    for (const entry of staleEntries) {
      console.error(
        `- ${entry.path}:${entry.rule}: expected ${entry.expectedCount}, found ${entry.actualCount} (${entry.owner})`,
      );
    }
  }
  process.exit(1);
}

console.log(
  `Raw read org-guard check passed (${violations.length} allowlisted violations, 0 new violations).`,
);
