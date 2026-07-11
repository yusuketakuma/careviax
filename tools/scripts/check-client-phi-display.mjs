#!/usr/bin/env node
/**
 * PHI-safe client display guard.
 *
 * API failures can carry untrusted patient, credential, or provider detail.
 * Client components must render a reviewed recovery copy instead of passing an
 * Error.message directly to a visible prop, state setter, toast, or JSX node.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ['src/app', 'src/components'];
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx']);
const ERROR_REFERENCE = String.raw`(?:error|err|reason|cause|[A-Za-z_$][\w$]*Error|[A-Za-z_$][\w$]*Query\.error)(?:\?\.|\.)message`;
const RAW_ERROR_REFERENCE = new RegExp(String.raw`\b${ERROR_REFERENCE}\b`);
const VISIBLE_PROP_PATTERN = /\b(?:detail|description|errorMessage)\s*=\s*\{/g;
const VISIBLE_SETTER_PATTERN = /\bset[A-Za-z_$][\w$]*(?:Error|Message)\s*\(/g;
const VISIBLE_TOAST_PATTERN = /\btoast\.(?:error|warning|info)\s*\(/g;
const VISIBLE_JSX_PATTERN = new RegExp(String.raw`>\s*\{\s*${ERROR_REFERENCE}\s*\}\s*<`, 'g');

function isTestFile(relativePath) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath);
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
    if (!isTestFile(relativePath) && TARGET_EXTENSIONS.has(path.extname(relativePath))) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function lineAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function normalizeSnippet(source, index) {
  return source
    .slice(index, index + 260)
    .split(/\r?\n/)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findDelimitedEnd(source, startIndex) {
  const opening = source[startIndex];
  const closingByOpening = { '(': ')', '[': ']', '{': '}' };
  const stack = [opening];
  let quote = null;
  let escaped = false;

  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index];
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
      stack.push(char);
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      const openingChar = stack.at(-1);
      if (openingChar && closingByOpening[openingChar] === char) {
        stack.pop();
        if (stack.length === 0) return index;
      }
    }
  }

  return source.length;
}

function stripReviewedMessageCalls(expression) {
  const safeCallPattern = /\bmessageFromError\s*\(/g;
  let cursor = 0;
  let scrubbed = '';

  for (const match of expression.matchAll(safeCallPattern)) {
    const index = match.index ?? 0;
    const callStart = expression.indexOf('(', index);
    const callEnd = findDelimitedEnd(expression, callStart);
    const fallbackStart = findFirstTopLevelComma(expression, callStart + 1, callEnd);
    scrubbed += expression.slice(cursor, index);
    if (fallbackStart === -1) {
      scrubbed += expression.slice(index, callEnd + 1);
    } else {
      scrubbed += ' '.repeat(Math.max(0, fallbackStart + 1 - index));
      scrubbed += expression.slice(fallbackStart + 1, callEnd);
      scrubbed += ' ';
    }
    cursor = callEnd + 1;
  }

  return scrubbed + expression.slice(cursor);
}

function findFirstTopLevelComma(source, startIndex, endIndex) {
  const stack = [];
  let quote = null;
  let escaped = false;

  for (let index = startIndex; index < endIndex; index += 1) {
    const char = source[index];
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
      stack.push(char);
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      stack.pop();
      continue;
    }
    if (char === ',' && stack.length === 0) return index;
  }

  return -1;
}

function hasUnsafeErrorMessage(expression) {
  return RAW_ERROR_REFERENCE.test(stripReviewedMessageCalls(expression));
}

function pushViolation(violations, source, file, index, rule, description) {
  violations.push({
    path: file,
    line: lineAt(source, index),
    rule,
    description,
    text: normalizeSnippet(source, index),
  });
}

function findVisiblePropViolations(source, file, violations) {
  VISIBLE_PROP_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(VISIBLE_PROP_PATTERN)) {
    const index = match.index ?? 0;
    const expressionStart = source.indexOf('{', index);
    const expressionEnd = findDelimitedEnd(source, expressionStart);
    const expression = source.slice(expressionStart + 1, expressionEnd);
    if (hasUnsafeErrorMessage(expression)) {
      pushViolation(
        violations,
        source,
        file,
        index,
        'visible-error-prop',
        'visible error prop receives Error.message',
      );
    }
  }
}

function findVisibleCallViolations(source, file, violations, pattern, rule, description) {
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    const callStart = source.indexOf('(', index);
    const callEnd = findDelimitedEnd(source, callStart);
    const args = source.slice(callStart + 1, callEnd);
    if (hasUnsafeErrorMessage(args)) {
      pushViolation(violations, source, file, index, rule, description);
    }
  }
}

const violations = [];
for (const root of SCAN_ROOTS) {
  for (const file of walkFiles(root)) {
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    findVisiblePropViolations(source, file, violations);
    findVisibleCallViolations(
      source,
      file,
      violations,
      VISIBLE_SETTER_PATTERN,
      'visible-error-setter',
      'visible error state receives Error.message',
    );
    findVisibleCallViolations(
      source,
      file,
      violations,
      VISIBLE_TOAST_PATTERN,
      'visible-error-toast',
      'toast receives Error.message',
    );
    VISIBLE_JSX_PATTERN.lastIndex = 0;
    for (const match of source.matchAll(VISIBLE_JSX_PATTERN)) {
      pushViolation(
        violations,
        source,
        file,
        match.index ?? 0,
        'visible-error-jsx',
        'JSX text node receives Error.message',
      );
    }
  }
}

if (violations.length > 0) {
  console.error('Client PHI-display check failed.');
  for (const violation of violations) {
    console.error(`- ${violation.path}:${violation.line} ${violation.rule}`);
    console.error(`  ${violation.description}: ${violation.text}`);
  }
  console.error(
    '\nRender a reviewed fixed recovery copy (or SafeClientMessageError from a local allowlist), not Error.message.',
  );
  process.exit(1);
}

console.log('Client PHI-display check passed (0 direct Error.message display paths).');
