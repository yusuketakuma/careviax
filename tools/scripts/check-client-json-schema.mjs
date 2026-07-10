#!/usr/bin/env node
// API-CONTRACT-001 frontend response-schema ratchet.
//
// Existing schema-less readApiJson calls remain explicit debt, but every new call,
// count increase, and stale allowlist entry fails until the reader is schema-backed.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const ALLOWLIST_PATH = 'tools/client-json-schema-allowlist.json';
const SCAN_ROOT = 'src';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const CATEGORY_KEYS = ['stringFallback', 'missingOptions', 'objectWithoutSchema', 'dynamicOptions'];

function emptyCounts() {
  return Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0]));
}

function isProductionSource(file) {
  return (
    SOURCE_EXTENSIONS.has(path.extname(file)) &&
    !file.endsWith('.d.ts') &&
    !/\.(?:test|spec)\.tsx?$/u.test(file) &&
    !file.split('/').includes('__tests__')
  );
}

function walkSourceFiles(repoRoot) {
  const root = path.join(repoRoot, SCAN_ROOT);
  const stack = [root];
  const files = [];
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
    const relative = path.relative(repoRoot, current).split(path.sep).join('/');
    if (isProductionSource(relative)) files.push(relative);
  }
  return files.sort();
}

function isClientJsonModule(moduleName) {
  return /(?:^|\/)client-json$/u.test(moduleName);
}

function readApiJsonBindings(sourceFile) {
  const identifiers = new Set();
  const namespaces = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !isClientJsonModule(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === 'readApiJson') {
          identifiers.add(element.name.text);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
  }
  return { identifiers, namespaces };
}

function isReadApiJsonCall(node, bindings) {
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) return bindings.identifiers.has(node.expression.text);
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    bindings.namespaces.has(node.expression.expression.text) &&
    node.expression.name.text === 'readApiJson'
  );
}

function propertyNameText(name) {
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : null;
}

function hasInlineSchema(options) {
  if (!ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some((property) => {
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property) &&
      !ts.isMethodDeclaration(property)
    ) {
      return false;
    }
    return propertyNameText(property.name) === 'schema';
  });
}

function classifyOptions(options) {
  if (!options) return 'missingOptions';
  if (ts.isObjectLiteralExpression(options)) {
    return hasInlineSchema(options) ? null : 'objectWithoutSchema';
  }
  if (
    ts.isStringLiteralLike(options) ||
    ts.isNoSubstitutionTemplateLiteral(options) ||
    ts.isTemplateExpression(options)
  ) {
    return 'stringFallback';
  }
  return 'dynamicOptions';
}

export function scanClientJsonSchemaDebt(repoRoot = process.cwd()) {
  const calls = [];
  let schemaBackedCount = 0;

  for (const file of walkSourceFiles(repoRoot)) {
    const content = readFileSync(path.join(repoRoot, file), 'utf8');
    if (!content.includes('readApiJson')) continue;
    const sourceFile = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const bindings = readApiJsonBindings(sourceFile);
    if (bindings.identifiers.size === 0 && bindings.namespaces.size === 0) continue;

    function visit(node) {
      if (isReadApiJsonCall(node, bindings)) {
        const category = classifyOptions(node.arguments[1]);
        if (category === null) {
          schemaBackedCount += 1;
        } else {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          calls.push({ file, line: position.line + 1, category });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  const byPath = new Map();
  for (const call of calls) {
    const counts = byPath.get(call.file) ?? emptyCounts();
    counts[call.category] += 1;
    byPath.set(call.file, counts);
  }
  const entries = [...byPath.entries()]
    .map(([file, counts]) => ({ path: file, counts }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const totals = emptyCounts();
  for (const { counts } of entries) {
    for (const key of CATEGORY_KEYS) totals[key] += counts[key];
  }

  return { calls, entries, totals, schemaBackedCount };
}

function normalizeAllowlist(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.entries)) {
    throw new Error(`${ALLOWLIST_PATH} must contain version 1 and an entries array`);
  }
  for (const key of ['owner', 'debtId', 'reason', 'plannedAction']) {
    if (typeof raw[key] !== 'string' || !raw[key].trim()) {
      throw new Error(`${ALLOWLIST_PATH}.${key} is required`);
    }
  }

  const entries = new Map();
  for (const [index, entry] of raw.entries.entries()) {
    const label = `${ALLOWLIST_PATH}:entries[${index}]`;
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || !entry.path) {
      throw new Error(`${label}.path is required`);
    }
    if (entries.has(entry.path)) throw new Error(`${label}.path is duplicated: ${entry.path}`);
    if (!entry.counts || typeof entry.counts !== 'object') {
      throw new Error(`${label}.counts is required`);
    }
    const counts = emptyCounts();
    for (const [key, value] of Object.entries(entry.counts)) {
      if (!CATEGORY_KEYS.includes(key)) throw new Error(`${label}.counts.${key} is unknown`);
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${label}.counts.${key} must be a positive integer`);
      }
      counts[key] = value;
    }
    if (CATEGORY_KEYS.every((key) => counts[key] === 0)) {
      throw new Error(`${label}.counts must contain debt`);
    }
    entries.set(entry.path, counts);
  }
  return entries;
}

function formatCounts(counts) {
  return CATEGORY_KEYS.filter((key) => counts[key] > 0)
    .map((key) => `${key}=${counts[key]}`)
    .join(', ');
}

export function compareClientJsonSchemaDebt(scan, allowlistRaw) {
  const expected = normalizeAllowlist(allowlistRaw);
  const actual = new Map(scan.entries.map((entry) => [entry.path, entry.counts]));
  const problems = [];

  for (const [file, counts] of actual) {
    const baseline = expected.get(file);
    if (!baseline) {
      const locations = scan.calls
        .filter((call) => call.file === file)
        .map((call) => `${call.file}:${call.line} ${call.category}`);
      problems.push(`new schema-less readApiJson debt: ${formatCounts(counts)}`, ...locations);
      continue;
    }
    for (const key of CATEGORY_KEYS) {
      if (counts[key] !== baseline[key]) {
        problems.push(
          `${file} ${key}: expected ${baseline[key]}, found ${counts[key]} (update code or remove stale debt)`,
        );
      }
    }
  }
  for (const [file, counts] of expected) {
    if (!actual.has(file)) {
      problems.push(`${file}: expected ${formatCounts(counts)}, found no schema-less calls`);
    }
  }
  return problems;
}

export function buildClientJsonSchemaAllowlist(scan) {
  return {
    version: 1,
    owner: 'API-CONTRACT-001',
    debtId: 'API-CONTRACT-001FZCLIENTRATCHET',
    reason: 'Existing production readers still trust compile-time types without a runtime schema.',
    plannedAction: 'Migrate bounded provider/consumer families to exact runtime response schemas.',
    entries: scan.entries.map(({ path: file, counts }) => ({
      path: file,
      counts: Object.fromEntries(
        CATEGORY_KEYS.filter((key) => counts[key] > 0).map((key) => [key, counts[key]]),
      ),
    })),
  };
}

function readAllowlist(repoRoot) {
  return JSON.parse(readFileSync(path.join(repoRoot, ALLOWLIST_PATH), 'utf8'));
}

function debtTotal(totals) {
  return CATEGORY_KEYS.reduce((sum, key) => sum + totals[key], 0);
}

function run() {
  const repoRoot = process.cwd();
  const scan = scanClientJsonSchemaDebt(repoRoot);
  if (process.argv.includes('--print-baseline')) {
    process.stdout.write(`${JSON.stringify(buildClientJsonSchemaAllowlist(scan), null, 2)}\n`);
    return;
  }
  const problems = compareClientJsonSchemaDebt(scan, readAllowlist(repoRoot));
  if (problems.length > 0) {
    console.error('Client JSON schema check failed.');
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log(
    `Client JSON schema check passed (${scan.schemaBackedCount} schema-backed, ${debtTotal(scan.totals)} allowlisted schema-less calls across ${scan.entries.length} files; 0 new debt).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
