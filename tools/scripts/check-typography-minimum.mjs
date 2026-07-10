#!/usr/bin/env node
// Minimum typography ratchet (DV-02).
//
// The PH-OS UI SSOT prohibits 9px to 11px browser text. Existing production
// debt is recorded per source file and syntax kind in
// tools/typography-minimum-allowlist.json so this check can fail on new,
// increased, reclassified, or stale violations while focused remediation
// removes entries. A removed occurrence must also remove or reduce its entry;
// stale allowlist data is therefore a failure, not a silent pass.
//
// Covered browser production forms:
// - Tailwind arbitrary text sizes, including line-height and length variants
// - React inline and JSX/SVG fontSize values below 12px, including conditional
//   and fallback branches plus decimals such as 10.5px
// - CSS font-size declarations below 12px
//
// React-PDF services use point units, not browser CSS pixels, and are excluded
// from this browser-only rule. Print/PDF typography requires its own verified
// unit policy. Tests, stories, declaration files, and test directories are
// excluded because they may intentionally reference rejected values as fixtures.
// Ambiguous untyped text-[var(...)] is fail-closed; use text-[color:...] for
// arbitrary text color or an explicit, statically provable size instead.
// This is a ratchet, not a formatter or a substitute for visual verification of
// each remediation slice.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const REPO_ROOT = process.cwd();
const ALLOWLIST_PATH = 'tools/typography-minimum-allowlist.json';
const SCAN_ROOTS = ['src'];
const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx']);
const CSS_EXTENSIONS = new Set(['.css']);
const SKIPPED_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.stories.ts',
  '.stories.tsx',
];
const NON_BROWSER_RENDERER_PATH_PREFIXES = ['src/server/services/pdf-'];
const ALLOWLIST_KINDS = new Set([
  'tailwind-text',
  'inline-font-size',
  'jsx-font-size',
  'css-font-size',
]);

function readAllowlist() {
  const raw = readFileSync(path.join(REPO_ROOT, ALLOWLIST_PATH), 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(ALLOWLIST_PATH + ' must contain an entries array');
  }
  const defaultReason = parsed.defaultReason;
  if (defaultReason != null && (typeof defaultReason !== 'string' || !defaultReason)) {
    throw new Error(ALLOWLIST_PATH + '.defaultReason must be a non-empty string when provided');
  }

  const paths = new Set();
  return parsed.entries.map((entry, index) => {
    const label = ALLOWLIST_PATH + ':entries[' + index + ']';
    if (!entry || typeof entry !== 'object') throw new Error(label + ' must be an object');
    if (typeof entry.path !== 'string' || !entry.path.startsWith('src/')) {
      throw new Error(label + '.path must be a source path');
    }
    if (paths.has(entry.path)) throw new Error(label + '.path duplicates ' + entry.path);
    paths.add(entry.path);
    if ('expectedCount' in entry) {
      throw new Error(label + '.expectedCount is obsolete; use expectedCounts by syntax kind');
    }
    if (
      !entry.expectedCounts ||
      Array.isArray(entry.expectedCounts) ||
      typeof entry.expectedCounts !== 'object'
    ) {
      throw new Error(label + '.expectedCounts must be an object');
    }

    const expectedCounts = {};
    for (const [kind, count] of Object.entries(entry.expectedCounts)) {
      if (!ALLOWLIST_KINDS.has(kind)) {
        throw new Error(label + '.expectedCounts has an unknown kind: ' + kind);
      }
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) {
        throw new Error(label + '.expectedCounts.' + kind + ' must be a positive integer');
      }
      expectedCounts[kind] = count;
    }
    if (Object.keys(expectedCounts).length === 0) {
      throw new Error(label + '.expectedCounts must contain at least one syntax kind');
    }
    const reason = typeof entry.reason === 'string' && entry.reason ? entry.reason : defaultReason;
    if (!reason) {
      throw new Error(label + '.reason is required when no defaultReason is set');
    }
    return {
      actualCounts: {},
      expectedCounts,
      path: entry.path,
      reason,
    };
  });
}

function isSkippedPath(relativePath) {
  return (
    relativePath.endsWith('.d.ts') ||
    relativePath.includes('/__tests__/') ||
    SKIPPED_SUFFIXES.some((suffix) => relativePath.endsWith(suffix)) ||
    NON_BROWSER_RENDERER_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
  );
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
    if (isSkippedPath(relativePath)) continue;
    const extension = path.extname(relativePath);
    if (SCRIPT_EXTENSIONS.has(extension) || CSS_EXTENSIONS.has(extension)) files.push(relativePath);
  }

  return files.sort();
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function addOccurrence(occurrences, source, file, index, value, kind) {
  if (!Number.isFinite(value) || value >= 12) return;
  occurrences.push({
    kind,
    line: lineNumber(source, index),
    path: file,
    unresolved: false,
    value,
  });
}

function addUnresolvedOccurrence(occurrences, source, file, index, kind) {
  occurrences.push({
    kind,
    line: lineNumber(source, index),
    path: file,
    unresolved: true,
    value: 'unresolved',
  });
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) {
    return name.expression.text;
  }
  return null;
}

function isFontSizeName(name) {
  const text = propertyNameText(name);
  return text === 'fontSize' || text === 'font-size';
}

function fontSizeValueFromString(value) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(px|pt)?$/i);
  if (!match) return null;
  const numericValue = Number(match[1]);
  return match[2]?.toLowerCase() === 'pt' ? (numericValue * 96) / 72 : numericValue;
}

function mergeStaticFontSizeValues(evaluations) {
  const values = [];
  let unresolved = false;
  for (const evaluation of evaluations) {
    values.push(...evaluation.values);
    unresolved = unresolved || evaluation.unresolved;
  }
  return { unresolved, values };
}

function staticFontSizeValues(expression) {
  if (!expression) return { unresolved: true, values: [] };
  if (ts.isNumericLiteral(expression)) {
    return { unresolved: false, values: [Number(expression.text)] };
  }
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    const value = fontSizeValueFromString(expression.text);
    return value == null
      ? { unresolved: true, values: [] }
      : { unresolved: false, values: [value] };
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return staticFontSizeValues(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return mergeStaticFontSizeValues([
      staticFontSizeValues(expression.whenTrue),
      staticFontSizeValues(expression.whenFalse),
    ]);
  }
  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return mergeStaticFontSizeValues([
      staticFontSizeValues(expression.left),
      staticFontSizeValues(expression.right),
    ]);
  }
  return { unresolved: true, values: [] };
}

function tailwindFontSizeValue(value) {
  const match = value.trim().match(/^(?:length:)?(\d+(?:\.\d+)?)px(?:\/[^\s\]]+)?$/);
  return match ? Number(match[1]) : null;
}

function isUnresolvedTailwindFontSize(value, isExplicitFontSize) {
  const normalized = value.trim();
  if (isExplicitFontSize || normalized.startsWith('length:')) return true;
  if (/^(?:var|calc|min|max|clamp)\(/.test(normalized)) return true;
  return /^\d+(?:\.\d+)?(?:[a-z%]+)(?:\/[^\s\]]+)?$/i.test(normalized);
}

function findOccurrencesInScript(source, file) {
  const occurrences = [];
  const addTailwindOccurrence = (index, rawValue, isExplicitFontSize = false) => {
    const value = tailwindFontSizeValue(rawValue);
    if (value != null) {
      addOccurrence(occurrences, source, file, index, value, 'tailwind-text');
      return;
    }
    if (isUnresolvedTailwindFontSize(rawValue, isExplicitFontSize)) {
      addUnresolvedOccurrence(occurrences, source, file, index, 'unresolved-tailwind-font-size');
    }
  };

  for (const match of source.matchAll(/text-\[([^\]\r\n]+)\]/g)) {
    addTailwindOccurrence(match.index ?? 0, match[1]);
  }
  for (const match of source.matchAll(/\[font-size:([^\]\r\n]+)\]/g)) {
    addTailwindOccurrence(match.index ?? 0, match[1], true);
  }

  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const addExpressionValues = (expression, kind) => {
    const result = staticFontSizeValues(expression);
    const start = expression.getStart(sourceFile);
    for (const value of result.values) {
      addOccurrence(occurrences, source, file, start, value, kind);
    }
    if (result.unresolved) {
      addUnresolvedOccurrence(occurrences, source, file, start, 'unresolved-' + kind);
    }
  };
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && isFontSizeName(node.name)) {
      addExpressionValues(node.initializer, 'inline-font-size');
    }
    if (
      ts.isJsxAttribute(node) &&
      (node.name.text === 'fontSize' || node.name.text === 'font-size')
    ) {
      const initializer = node.initializer;
      if (!initializer) {
        addUnresolvedOccurrence(
          occurrences,
          source,
          file,
          node.getStart(sourceFile),
          'unresolved-jsx-font-size',
        );
      } else if (ts.isStringLiteral(initializer)) {
        addExpressionValues(initializer, 'jsx-font-size');
      } else if (ts.isJsxExpression(initializer) && initializer.expression) {
        addExpressionValues(initializer.expression, 'jsx-font-size');
      } else {
        addUnresolvedOccurrence(
          occurrences,
          source,
          file,
          node.getStart(sourceFile),
          'unresolved-jsx-font-size',
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return occurrences;
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, ' '));
}

function cssFontSizeValue(value) {
  const normalized = value.trim().replace(/\s*!important\s*$/i, '');
  const match = normalized.match(/^(\d+(?:\.\d+)?)(px|pt)$/i);
  if (!match) return null;
  const numericValue = Number(match[1]);
  return match[2].toLowerCase() === 'pt' ? (numericValue * 96) / 72 : numericValue;
}

function findOccurrencesInCss(source, file) {
  const occurrences = [];
  const sanitized = stripCssComments(source);
  for (const match of sanitized.matchAll(/(^|[;{\s])font-size\s*:\s*([^;}\r\n]+)/gm)) {
    const index = (match.index ?? 0) + match[1].length;
    const value = cssFontSizeValue(match[2]);
    if (value == null) {
      addUnresolvedOccurrence(occurrences, source, file, index, 'unresolved-css-font-size');
    } else {
      addOccurrence(occurrences, source, file, index, value, 'css-font-size');
    }
  }
  for (const match of sanitized.matchAll(/(^|[;{\s])font\s*:\s*([^;}\r\n]+)/gm)) {
    const index = (match.index ?? 0) + match[1].length;
    addUnresolvedOccurrence(occurrences, source, file, index, 'unresolved-css-font');
  }
  return occurrences;
}

function findOccurrences() {
  const occurrences = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkFiles(root)) {
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const extension = path.extname(file);
      if (SCRIPT_EXTENSIONS.has(extension)) {
        occurrences.push(...findOccurrencesInScript(source, file));
      }
      if (CSS_EXTENSIONS.has(extension)) {
        occurrences.push(...findOccurrencesInCss(source, file));
      }
    }
  }
  return occurrences;
}

function formatCounts(counts) {
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => kind + '=' + count);
  return parts.length > 0 ? parts.join(', ') : 'none';
}

function countsMatch(expectedCounts, actualCounts) {
  const kinds = new Set([...Object.keys(expectedCounts), ...Object.keys(actualCounts)]);
  return [...kinds].every((kind) => expectedCounts[kind] === actualCounts[kind]);
}

const entries = readAllowlist();
const allowByPath = new Map(entries.map((entry) => [entry.path, entry]));
const occurrences = findOccurrences();
const violations = [];
const unresolvedViolations = [];

for (const occurrence of occurrences) {
  if (occurrence.unresolved) {
    unresolvedViolations.push(occurrence);
    continue;
  }
  const entry = allowByPath.get(occurrence.path);
  if (!entry) {
    violations.push(occurrence);
    continue;
  }
  entry.actualCounts[occurrence.kind] = (entry.actualCounts[occurrence.kind] ?? 0) + 1;
}

const staleEntries = entries.filter(
  (entry) => !countsMatch(entry.expectedCounts, entry.actualCounts),
);
if (violations.length > 0 || unresolvedViolations.length > 0 || staleEntries.length > 0) {
  console.error('Typography minimum check failed.');
  if (violations.length > 0) {
    console.error('\nNew production sub-12px typography (use at least 12px):');
    for (const item of violations) {
      console.error(
        '- ' + item.path + ':' + item.line + ' (' + item.kind + ' ' + item.value + 'px)',
      );
    }
  }
  if (unresolvedViolations.length > 0) {
    console.error('\nUnresolved production font-size (use a static px or pt value):');
    for (const item of unresolvedViolations) {
      console.error('- ' + item.path + ':' + item.line + ' (' + item.kind + ')');
    }
  }
  if (staleEntries.length > 0) {
    console.error('\nStale typography debt entries (expected syntax-kind counts no longer match):');
    for (const entry of staleEntries) {
      console.error(
        '- ' +
          entry.path +
          ' expected={' +
          formatCounts(entry.expectedCounts) +
          '} actual={' +
          formatCounts(entry.actualCounts) +
          '}',
      );
    }
  }
  console.error(
    '\nRemove the violation or update ' +
      ALLOWLIST_PATH +
      ' only as part of a reviewed DV-02 remediation.',
  );
  process.exit(1);
}

const byKind = new Map();
for (const occurrence of occurrences) {
  if (!occurrence.unresolved) {
    byKind.set(occurrence.kind, (byKind.get(occurrence.kind) ?? 0) + 1);
  }
}

console.log(
  'Typography minimum check passed: ' +
    occurrences.length +
    ' allowlisted sub-12px occurrence(s), 0 drift.',
);
for (const [kind, count] of [...byKind.entries()].sort()) {
  console.log('- ' + kind + ': ' + count);
}
