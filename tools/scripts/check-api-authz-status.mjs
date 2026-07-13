#!/usr/bin/env node
// Authorization failures must not be reported as input-validation failures.
//
// This intentionally checks syntax-level static string literals passed directly
// to validationError(). Dynamic expressions require route tests because their
// semantics cannot be classified safely by this guard.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const REPO_ROOT = process.cwd();
const SCAN_ROOT = 'src/app/api';
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIPPED_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

function walkRouteFiles() {
  const files = [];
  const stack = [path.join(REPO_ROOT, SCAN_ROOT)];
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
    if (!relativePath.endsWith('/route.ts') && !relativePath.endsWith('/route.tsx')) continue;
    if (SKIPPED_SUFFIXES.some((suffix) => relativePath.endsWith(suffix))) continue;
    if (TARGET_EXTENSIONS.has(path.extname(relativePath))) files.push(relativePath);
  }
  return files.sort();
}

function findAuthorizationValidationViolations(content, file) {
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'validationError'
    ) {
      const messageNode = node.arguments[0];
      const isStaticMessage =
        messageNode &&
        (ts.isStringLiteral(messageNode) || ts.isNoSubstitutionTemplateLiteral(messageNode));
      if (isStaticMessage && messageNode.text.includes('権限')) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.expression.getStart(sourceFile),
        );
        violations.push({
          path: file,
          line: line + 1,
          message: messageNode.text,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

const violations = [];
for (const file of walkRouteFiles()) {
  const content = readFileSync(path.join(REPO_ROOT, file), 'utf8');
  violations.push(...findAuthorizationValidationViolations(content, file));
}

if (violations.length > 0) {
  console.error('API authorization status check failed.');
  console.error('Use forbidden()/403 AUTH_FORBIDDEN for permission denials:');
  for (const violation of violations) {
    console.error(`- ${violation.path}:${violation.line} ${violation.message}`);
  }
  process.exit(1);
}

console.log(
  'API authorization status check passed (0 direct static permission literals passed to validationError).',
);
