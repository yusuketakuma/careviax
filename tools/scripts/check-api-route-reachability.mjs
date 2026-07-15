#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const REPO_ROOT = process.cwd();
const ROUTE_ROOT = 'src/app/api';
const SOURCE_ROOT = 'src';
const INVENTORY_PATH = 'tools/api-route-reachability-inventory.json';
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const EXCLUDED_EVIDENCE_PATHS = new Set([
  'src/lib/api/rate-limit.ts',
  'src/lib/api/route-catalog.ts',
]);
const INTERNAL_PREFIXES = ['/api/auth', '/api/jobs', '/api/meta', '/api/webhooks', '/api/phos'];
const EXTERNAL_PREFIXES = ['/api/external-access', '/api/public', '/api/health', '/api/fhir'];
const APPROVED_FETCH_SYMBOL_PATHS = new Map([
  ['fetchEvidenceSync', new Set(['src/lib/offline/evidence-drafts.ts'])],
  [
    'fetchImpl',
    new Set([
      'src/app/(dashboard)/schedules/schedule-day-facility-batch.ts',
      'src/app/(dashboard)/schedules/schedule-day-facility-visit-day.ts',
      'src/app/(dashboard)/schedules/schedule-day-planner.ts',
    ]),
  ],
]);
const DEFAULT_REVIEW_EXPIRY = '2026-10-15';
const INVENTORY_OWNER = 'API-REACHABILITY-RATCHET-001';

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function walkFiles(relativeRoot) {
  const absoluteRoot = path.join(REPO_ROOT, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];

  const files = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const child of readdirSync(current).sort().reverse()) {
        if (child === 'node_modules' || child === '.next') continue;
        stack.push(path.join(current, child));
      }
      continue;
    }
    if (stats.isFile()) files.push(toPosix(path.relative(REPO_ROOT, current)));
  }
  return files.sort();
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function routePathFromFile(filePath) {
  const routeRelative = filePath.slice(`${ROUTE_ROOT}/`.length, -'/route.ts'.length);
  const urlSegments = routeRelative
    .split('/')
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .filter((segment) => !segment.startsWith('@'))
    .map((segment) => {
      const optionalCatchAll = segment.match(/^\[\[\.\.\.([^\]]+)\]\]$/u);
      if (optionalCatchAll) return `*${optionalCatchAll[1]}?`;
      const catchAll = segment.match(/^\[\.\.\.([^\]]+)\]$/u);
      if (catchAll) return `*${catchAll[1]}`;
      const dynamic = segment.match(/^\[([^\]]+)\]$/u);
      if (dynamic) return `:${dynamic[1]}`;
      return segment;
    });
  return `/api/${urlSegments.join('/')}`.replace(/\/$/u, '');
}

function collectRouteExports(filePath) {
  const content = readFileSync(path.join(REPO_ROOT, filePath), 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const exports = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      hasExportModifier(statement) &&
      statement.name &&
      HTTP_METHODS.has(statement.name.text)
    ) {
      exports.push({ method: statement.name.text, export_kind: 'direct' });
      continue;
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && HTTP_METHODS.has(declaration.name.text)) {
          exports.push({ method: declaration.name.text, export_kind: 'direct' });
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (statement.isTypeOnly) continue;
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const exportedName = element.name.text;
        if (!HTTP_METHODS.has(exportedName)) continue;
        exports.push({
          method: exportedName,
          export_kind: statement.moduleSpecifier ? 're_export' : 'local_alias',
        });
      }
    }
  }

  return exports;
}

function collectLiveRoutes() {
  const routeFiles = walkFiles(ROUTE_ROOT).filter((filePath) => filePath.endsWith('/route.ts'));
  const entries = [];
  const errors = [];

  for (const filePath of routeFiles) {
    const route = routePathFromFile(filePath);
    const seenMethods = new Set();
    const routeExports = collectRouteExports(filePath);
    if (routeExports.length === 0) {
      errors.push(`route file has no supported HTTP method export: ${filePath}`);
    }
    for (const routeExport of routeExports) {
      if (seenMethods.has(routeExport.method)) {
        errors.push(`duplicate live export ${routeExport.method} ${route} in ${filePath}`);
        continue;
      }
      seenMethods.add(routeExport.method);
      entries.push({
        key: `${routeExport.method} ${route}`,
        route,
        method: routeExport.method,
        file: filePath,
        export_kind: routeExport.export_kind,
      });
    }
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));
  return { routeFiles, entries, errors };
}

function isEvidenceSource(filePath) {
  if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) return false;
  if (filePath.startsWith(`${ROUTE_ROOT}/`)) return false;
  if (EXCLUDED_EVIDENCE_PATHS.has(filePath)) return false;
  if (filePath.includes('/__tests__/')) return false;
  if (/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/u.test(filePath)) return false;
  return true;
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function normalizeReference(reference) {
  const apiIndex = reference.indexOf('/api/');
  if (apiIndex < 0) return null;
  const apiReference = reference.slice(apiIndex);
  const queryIndex = apiReference.search(/[?#]/u);
  const withoutQuery = queryIndex >= 0 ? apiReference.slice(0, queryIndex) : apiReference;
  const normalized = withoutQuery.replace(/\/+$/u, '').replace(/\/{2,}/gu, '/');
  return normalized.startsWith('/api/') ? normalized : null;
}

function renderExpressionValue(node, parameterValues = new Map()) {
  if (!node) return null;
  const expression = unwrapExpression(node);

  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isIdentifier(expression)) return parameterValues.get(expression.text) ?? null;

  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      value += renderExpressionValue(span.expression, parameterValues) ?? ':param';
      value += span.literal.text;
    }
    return value;
  }

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = renderExpressionValue(expression.left, parameterValues);
    const right = renderExpressionValue(expression.right, parameterValues);
    if (left === null && right === null) return null;
    return `${left ?? ':param'}${right ?? ':param'}`;
  }

  if (ts.isCallExpression(expression) && expression.arguments.length > 0) {
    return renderExpressionValue(expression.arguments[0], parameterValues) ?? ':param';
  }

  return null;
}

function findReturnExpression(body) {
  if (!body) return null;
  if (!ts.isBlock(body)) return body;
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) return statement.expression;
  }
  return null;
}

function createBuilderDefinition(name, parameters, body, sourcePath, exported) {
  const returnExpression = findReturnExpression(body);
  if (!returnExpression) return null;
  const definition = {
    name,
    parameters: parameters.map((parameter) => ({
      name: ts.isIdentifier(parameter.name) ? parameter.name.text : null,
      initializer: parameter.initializer ?? null,
    })),
    returnExpression,
    sourcePath,
    exported,
  };
  return renderBuilder(definition, []) ? definition : null;
}

function renderBuilder(definition, callArguments) {
  const parameterValues = new Map();
  for (let index = 0; index < definition.parameters.length; index += 1) {
    const parameter = definition.parameters[index];
    if (!parameter.name) continue;
    const argumentValue = renderExpressionValue(callArguments[index], new Map());
    const defaultValue = renderExpressionValue(parameter.initializer, parameterValues);
    parameterValues.set(parameter.name, argumentValue ?? defaultValue ?? ':param');
  }
  const rendered = renderExpressionValue(definition.returnExpression, parameterValues);
  return rendered ? normalizeReference(rendered) : null;
}

function collectBuilderDefinitions(sourceFile, filePath) {
  const local = new Map();
  const exported = new Map();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const definition = createBuilderDefinition(
        statement.name.text,
        statement.parameters,
        statement.body,
        filePath,
        hasExportModifier(statement),
      );
      if (!definition) continue;
      local.set(statement.name.text, definition);
      if (definition.exported) exported.set(statement.name.text, definition);
      continue;
    }

    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const initializer = unwrapExpression(declaration.initializer);
      let definition = null;
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        definition = createBuilderDefinition(
          declaration.name.text,
          initializer.parameters,
          initializer.body,
          filePath,
          hasExportModifier(statement),
        );
      } else {
        const reference = normalizeReference(renderExpressionValue(initializer) ?? '');
        if (reference) {
          definition = {
            name: declaration.name.text,
            parameters: [],
            returnExpression: initializer,
            sourcePath: filePath,
            exported: hasExportModifier(statement),
          };
        }
      }
      if (!definition) continue;
      local.set(declaration.name.text, definition);
      if (definition.exported) exported.set(declaration.name.text, definition);
    }
  }

  return { local, exported };
}

function resolveImportSourceCandidates(importerPath, moduleSpecifier) {
  let basePath;
  if (moduleSpecifier.startsWith('@/')) {
    basePath = `src/${moduleSpecifier.slice(2)}`;
  } else if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
    basePath = path.posix.normalize(
      path.posix.join(path.posix.dirname(importerPath), moduleSpecifier),
    );
  } else {
    return new Set();
  }

  if (SOURCE_EXTENSIONS.has(path.posix.extname(basePath))) return new Set([basePath]);
  const candidates = new Set();
  for (const extension of SOURCE_EXTENSIONS) {
    candidates.add(`${basePath}${extension}`);
    candidates.add(`${basePath}/index${extension}`);
  }
  return candidates;
}

function resolveRouteExpression(node, constants = new Map(), builders = new Map()) {
  if (!node) return null;
  const expression = unwrapExpression(node);

  if (ts.isStringLiteralLike(expression)) return normalizeReference(expression.text);

  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      value += ':param';
      value += span.literal.text;
    }
    return normalizeReference(value);
  }

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = resolveRouteExpression(expression.left, constants);
    const right = resolveRouteExpression(expression.right, constants);
    if (left && right) return normalizeReference(`${left}${right}`);
    if (left) return normalizeReference(`${left}:param`);
    if (right) return normalizeReference(`:param${right}`);
    return null;
  }

  if (ts.isIdentifier(expression)) {
    if (constants.has(expression.text)) return constants.get(expression.text);
    const builder = builders.get(expression.text);
    return builder && builder.parameters.length === 0 ? renderBuilder(builder, []) : null;
  }

  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    builders.has(expression.expression.text)
  ) {
    return renderBuilder(builders.get(expression.expression.text), expression.arguments);
  }

  if (
    ts.isNewExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'URL'
  ) {
    return resolveRouteExpression(expression.arguments?.[0], constants, builders);
  }

  return null;
}

function readMethodLiteral(node, stringConstants) {
  if (!node) return null;
  const value = unwrapExpression(node);
  if (ts.isStringLiteralLike(value)) {
    const method = value.text.toUpperCase();
    return HTTP_METHODS.has(method) ? method : null;
  }
  if (ts.isIdentifier(value)) return stringConstants.get(value.text) ?? null;
  return null;
}

function readMethodFromOptions(node, stringConstants, objectConstants, seen = new Set()) {
  if (!node) return { state: 'absent', method: null };
  let options = unwrapExpression(node);
  if (ts.isIdentifier(options)) {
    if (seen.has(options.text)) return { state: 'unknown', method: null };
    const resolved = objectConstants.get(options.text);
    if (!resolved) return { state: 'unknown', method: null };
    seen.add(options.text);
    options = resolved;
  }
  if (!ts.isObjectLiteralExpression(options)) return { state: 'unknown', method: null };

  let result = { state: 'absent', method: null };
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spreadResult = readMethodFromOptions(
        property.expression,
        stringConstants,
        objectConstants,
        new Set(seen),
      );
      if (spreadResult.state !== 'absent') result = spreadResult;
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'method') {
      const method = stringConstants.get(property.name.text) ?? null;
      result = method ? { state: 'known', method } : { state: 'unknown', method: null };
      continue;
    }
    if (!ts.isPropertyAssignment(property)) {
      const unsupportedName = property.name;
      if (
        unsupportedName &&
        (ts.isIdentifier(unsupportedName) || ts.isStringLiteralLike(unsupportedName)) &&
        unsupportedName.text.toLowerCase() === 'method'
      ) {
        result = { state: 'unknown', method: null };
      }
      continue;
    }
    const name = property.name;
    const propertyName =
      ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text.toLowerCase() : null;
    if (propertyName !== 'method') continue;
    const method = readMethodLiteral(property.initializer, stringConstants);
    result = method ? { state: 'known', method } : { state: 'unknown', method: null };
  }
  return result;
}

function inferCallMethod(callExpression, stringConstants, objectConstants) {
  const options = callExpression.arguments[1];
  if (!options) return 'GET';
  const methodResult = readMethodFromOptions(options, stringConstants, objectConstants);
  if (methodResult.state === 'known') return methodResult.method;
  if (methodResult.state === 'absent') return 'GET';
  return null;
}

function callName(callExpression) {
  const callee = callExpression.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (
    ts.isElementAccessExpression(callee) &&
    callee.argumentExpression &&
    ts.isStringLiteralLike(callee.argumentExpression)
  ) {
    return callee.argumentExpression.text;
  }
  return null;
}

function sourceDeclaresIdentifier(sourceFile, identifierName) {
  let declared = false;

  function bindingContainsIdentifier(name) {
    if (ts.isIdentifier(name)) return name.text === identifierName;
    return name.elements.some(
      (element) => ts.isBindingElement(element) && bindingContainsIdentifier(element.name),
    );
  }

  function visit(node) {
    if (declared) return;
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      bindingContainsIdentifier(node.name)
    ) {
      declared = true;
      return;
    }
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name?.text === identifierName
    ) {
      declared = true;
      return;
    }
    if (ts.isImportClause(node) && node.name?.text === identifierName) {
      declared = true;
      return;
    }
    if (ts.isImportSpecifier(node) && node.name.text === identifierName) {
      declared = true;
      return;
    }
    if (ts.isNamespaceImport(node) && node.name.text === identifierName) {
      declared = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return declared;
}

function consumerCallKind(
  callExpression,
  filePath,
  { shadowsGlobalFetch, shadowsWindow, shadowsLocation },
) {
  const name = callName(callExpression);
  if (!name) return null;
  const callee = callExpression.expression;
  if (ts.isIdentifier(callee)) {
    if (name === 'fetch') return shadowsGlobalFetch ? null : 'network_call';
    if (APPROVED_FETCH_SYMBOL_PATHS.get(name)?.has(filePath)) return 'network_call';
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const receiver = callee.expression.getText();
    if (name === 'fetch' && receiver === 'window' && !shadowsWindow) return 'network_call';
    if (name === 'open' && receiver === 'window' && !shadowsWindow) {
      return 'navigation_href';
    }
    if (name === 'assign' && /^(?:location|window\.location)$/u.test(receiver)) {
      if (receiver === 'location' && shadowsLocation) return null;
      if (receiver === 'window.location' && shadowsWindow) return null;
      return 'navigation_href';
    }
    if (/^(?:push|replace)$/u.test(name) && /(?:^|\.)router$/u.test(receiver)) {
      return 'navigation_href';
    }
  }
  return null;
}

function routeSegments(route) {
  return route.split('/').filter(Boolean);
}

function referenceMatchesRoute(reference, route) {
  const referenceParts = routeSegments(reference);
  const routeParts = routeSegments(route);
  let referenceIndex = 0;

  for (let routeIndex = 0; routeIndex < routeParts.length; routeIndex += 1) {
    const routePart = routeParts[routeIndex];
    if (routePart.startsWith('*')) {
      const optional = routePart.endsWith('?');
      return optional || referenceIndex < referenceParts.length;
    }
    const referencePart = referenceParts[referenceIndex];
    if (referencePart === undefined) return false;
    if (routePart.startsWith(':')) {
      referenceIndex += 1;
      continue;
    }
    if (referencePart === ':param' || referencePart !== routePart) return false;
    referenceIndex += 1;
  }

  return referenceIndex === referenceParts.length;
}

function routeSpecificity(route) {
  return routeSegments(route).reduce((score, segment) => {
    if (segment.startsWith('*')) return score - 100;
    if (segment.startsWith(':')) return score - 10;
    return score + 1000;
  }, routeSegments(route).length);
}

function collectSourceEvidence(liveEntries) {
  const evidenceByKey = new Map(liveEntries.map((entry) => [entry.key, []]));
  const sourceFiles = walkFiles(SOURCE_ROOT).filter(isEvidenceSource);
  const globalBuildersByName = new Map();

  for (const filePath of sourceFiles) {
    const content = readFileSync(path.join(REPO_ROOT, filePath), 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const definitions = collectBuilderDefinitions(sourceFile, filePath);
    for (const [name, definition] of definitions.exported) {
      const existing = globalBuildersByName.get(name) ?? [];
      existing.push(definition);
      globalBuildersByName.set(name, existing);
    }
  }

  for (const filePath of sourceFiles) {
    const content = readFileSync(path.join(REPO_ROOT, filePath), 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const constants = new Map();
    const ambiguousRouteConstants = new Set();
    const stringConstants = new Map();
    const objectConstants = new Map();
    const ambiguousStringConstants = new Set();
    const ambiguousObjectConstants = new Set();
    const definitions = collectBuilderDefinitions(sourceFile, filePath);
    const builders = new Map(definitions.local);
    const shadowsGlobalFetch = sourceDeclaresIdentifier(sourceFile, 'fetch');
    const shadowsWindow = sourceDeclaresIdentifier(sourceFile, 'window');
    const shadowsLocation = sourceDeclaresIdentifier(sourceFile, 'location');

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const sourceCandidates = resolveImportSourceCandidates(
        filePath,
        statement.moduleSpecifier.text,
      );
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        const candidates = (globalBuildersByName.get(importedName) ?? []).filter((definition) =>
          sourceCandidates.has(definition.sourcePath),
        );
        if (candidates.length === 1) builders.set(element.name.text, candidates[0]);
      }
    }

    function collectConstants(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const reference = resolveRouteExpression(node.initializer, constants, builders);
        if (reference) {
          if (constants.has(node.name.text) || ambiguousRouteConstants.has(node.name.text)) {
            constants.delete(node.name.text);
            ambiguousRouteConstants.add(node.name.text);
          } else {
            constants.set(node.name.text, reference);
          }
        }
        if (
          ts.isVariableDeclarationList(node.parent) &&
          (node.parent.flags & ts.NodeFlags.Const) !== 0
        ) {
          const initializer = unwrapExpression(node.initializer);
          if (ts.isStringLiteralLike(initializer)) {
            const method = initializer.text.toUpperCase();
            if (HTTP_METHODS.has(method)) {
              if (
                stringConstants.has(node.name.text) ||
                ambiguousStringConstants.has(node.name.text)
              ) {
                stringConstants.delete(node.name.text);
                ambiguousStringConstants.add(node.name.text);
              } else {
                stringConstants.set(node.name.text, method);
              }
            }
          } else if (ts.isObjectLiteralExpression(initializer)) {
            if (
              objectConstants.has(node.name.text) ||
              ambiguousObjectConstants.has(node.name.text)
            ) {
              objectConstants.delete(node.name.text);
              ambiguousObjectConstants.add(node.name.text);
            } else {
              objectConstants.set(node.name.text, initializer);
            }
          }
        }
      }
      ts.forEachChild(node, collectConstants);
    }
    collectConstants(sourceFile);

    function addEvidence(reference, method, kind, symbol) {
      if (!method) return;
      const pathMatches = liveEntries.filter((entry) =>
        referenceMatchesRoute(reference, entry.route),
      );
      const highestSpecificity = Math.max(
        Number.NEGATIVE_INFINITY,
        ...pathMatches.map((entry) => routeSpecificity(entry.route)),
      );
      for (const entry of pathMatches) {
        if (entry.method !== method) continue;
        if (routeSpecificity(entry.route) !== highestSpecificity) continue;
        const values = evidenceByKey.get(entry.key);
        values.push({ path: filePath, kind, symbol, reference });
      }
    }

    function visit(node) {
      if (ts.isCallExpression(node)) {
        const kind = consumerCallKind(node, filePath, {
          shadowsGlobalFetch,
          shadowsWindow,
          shadowsLocation,
        });
        const reference = kind
          ? resolveRouteExpression(node.arguments[0], constants, builders)
          : null;
        if (reference && kind) {
          addEvidence(
            reference,
            inferCallMethod(node, stringConstants, objectConstants),
            kind,
            callName(node),
          );
        }
      }

      if (
        ts.isJsxAttribute(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'href' &&
        node.initializer
      ) {
        const hrefExpression = ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer;
        const reference = resolveRouteExpression(hrefExpression, constants, builders);
        if (reference) addEvidence(reference, 'GET', 'navigation_href', 'href');
      }

      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  for (const [key, values] of evidenceByKey) {
    const unique = new Map(
      values.map((value) => [
        `${value.path}:${value.kind}:${value.symbol}:${value.reference}`,
        value,
      ]),
    );
    evidenceByKey.set(
      key,
      [...unique.values()].sort((left, right) =>
        `${left.path}:${left.kind}:${left.symbol}:${left.reference}`.localeCompare(
          `${right.path}:${right.kind}:${right.symbol}:${right.reference}`,
        ),
      ),
    );
  }

  return evidenceByKey;
}

function startsWithPrefix(route, prefixes) {
  return prefixes.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

function isInternalEvidence(evidence) {
  return evidence.path.startsWith('src/server/') || evidence.path.startsWith('src/phos/');
}

function selectEvidence(items) {
  const kindRank = {
    network_call: 0,
    navigation_href: 1,
    typed_path_builder: 2,
    route_contract: 3,
  };
  return [...items]
    .sort((left, right) => {
      const rankDelta = (kindRank[left.kind] ?? 99) - (kindRank[right.kind] ?? 99);
      if (rankDelta !== 0) return rankDelta;
      return `${left.path}:${left.symbol}:${left.reference}`.localeCompare(
        `${right.path}:${right.symbol}:${right.reference}`,
      );
    })
    .slice(0, 1);
}

function buildInventoryEntry(entry, discoveredEvidence, previousEntry) {
  let classification;
  let evidence;
  let reason;

  if (startsWithPrefix(entry.route, EXTERNAL_PREFIXES)) {
    classification = 'external_public';
    evidence = [
      { path: entry.file, kind: 'route_contract', symbol: 'route_export', reference: entry.route },
    ];
    reason =
      'Reserved external/public API prefix; reachability is defined by the external contract.';
  } else if (startsWithPrefix(entry.route, INTERNAL_PREFIXES)) {
    classification = 'internal_job_webhook_bff_auth';
    evidence = [
      { path: entry.file, kind: 'route_contract', symbol: 'route_export', reference: entry.route },
    ];
    reason = 'Reserved internal job, webhook, BFF, metadata, or authentication prefix.';
  } else if (discoveredEvidence.some((item) => !isInternalEvidence(item))) {
    classification = 'reachable_ui_rsc_client';
    evidence = selectEvidence(discoveredEvidence.filter((item) => !isInternalEvidence(item)));
    reason = 'Production UI, RSC, or shared client source contains a method-matched API reference.';
  } else if (discoveredEvidence.length > 0) {
    classification = 'internal_job_webhook_bff_auth';
    evidence = selectEvidence(discoveredEvidence);
    reason = 'Production server or PH-OS source contains a method-matched internal API reference.';
  } else {
    classification = 'owner_review_pending_orphan_retire_candidate';
    evidence = [
      { path: entry.file, kind: 'route_contract', symbol: 'route_export', reference: entry.route },
    ];
    reason =
      previousEntry?.classification === classification && previousEntry.reason
        ? previousEntry.reason
        : 'No production consumer evidence or reserved contract prefix was found; retain only for owner review before retirement.';
  }

  const inventoryEntry = {
    ...entry,
    classification,
    reason,
    evidence,
  };

  if (classification === 'owner_review_pending_orphan_retire_candidate') {
    inventoryEntry.review_state = 'pending';
    inventoryEntry.owner = previousEntry?.owner ?? INVENTORY_OWNER;
    inventoryEntry.expiry = previousEntry?.expiry ?? DEFAULT_REVIEW_EXPIRY;
  }

  return inventoryEntry;
}

function buildInventory(live, previousInventory) {
  const evidenceByKey = collectSourceEvidence(live.entries);
  const previousByKey = new Map(
    Array.isArray(previousInventory?.entries)
      ? previousInventory.entries.map((entry) => [entry.key, entry])
      : [],
  );
  const entries = live.entries.map((entry) =>
    buildInventoryEntry(entry, evidenceByKey.get(entry.key) ?? [], previousByKey.get(entry.key)),
  );

  return {
    version: 1,
    owner: INVENTORY_OWNER,
    source: `${ROUTE_ROOT}/**/route.ts`,
    route_file_count: live.routeFiles.length,
    route_method_count: entries.length,
    entries,
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function currentDateKey() {
  const override = process.env.API_ROUTE_REACHABILITY_TODAY;
  if (override) return override;
  return new Date().toISOString().slice(0, 10);
}

function validateInventory(inventory, expectedInventory, live) {
  const errors = [...live.errors];
  if (inventory?.version !== 1) errors.push('inventory version must be 1');
  if (inventory?.owner !== INVENTORY_OWNER) {
    errors.push(`inventory owner must be ${INVENTORY_OWNER}`);
  }
  if (inventory?.source !== `${ROUTE_ROOT}/**/route.ts`) {
    errors.push(`inventory source must be ${ROUTE_ROOT}/**/route.ts`);
  }
  if (!Array.isArray(inventory?.entries)) return [...errors, 'inventory entries must be an array'];

  const inventoryKeys = new Set();
  for (const entry of inventory.entries) {
    if (inventoryKeys.has(entry.key)) errors.push(`duplicate inventory key ${entry.key}`);
    inventoryKeys.add(entry.key);
  }

  const liveKeys = new Set(live.entries.map((entry) => entry.key));
  for (const liveEntry of live.entries) {
    if (!inventoryKeys.has(liveEntry.key))
      errors.push(`unclassified live route-method ${liveEntry.key}`);
  }
  for (const inventoryEntry of inventory.entries) {
    if (!liveKeys.has(inventoryEntry.key))
      errors.push(`stale inventory route-method ${inventoryEntry.key}`);
  }

  if (inventory.route_file_count !== live.routeFiles.length) {
    errors.push(
      `route_file_count is ${inventory.route_file_count}; expected ${live.routeFiles.length}`,
    );
  }
  if (inventory.route_method_count !== live.entries.length) {
    errors.push(
      `route_method_count is ${inventory.route_method_count}; expected ${live.entries.length}`,
    );
  }

  const expectedByKey = new Map(expectedInventory.entries.map((entry) => [entry.key, entry]));
  for (const entry of inventory.entries) {
    const expected = expectedByKey.get(entry.key);
    if (!expected) continue;

    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      errors.push(`${entry.key} requires a reviewed classification reason`);
    }
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      errors.push(`${entry.key} requires consumer or route-contract evidence`);
    }

    for (const field of ['route', 'method', 'file', 'export_kind', 'classification']) {
      if (entry[field] !== expected[field]) {
        errors.push(
          `${entry.key} ${field} is ${JSON.stringify(entry[field])}; expected ${JSON.stringify(expected[field])}`,
        );
      }
    }
    if (entry.reason !== expected.reason)
      errors.push(`${entry.key} has stale classification reason`);
    if (stableJson(entry.evidence) !== stableJson(expected.evidence)) {
      errors.push(`${entry.key} has stale or non-production consumer evidence`);
    }

    if (entry.classification === 'owner_review_pending_orphan_retire_candidate') {
      if (entry.review_state !== 'pending') {
        errors.push(`${entry.key} orphan candidate must remain explicitly review_state=pending`);
      }
      if (typeof entry.owner !== 'string' || entry.owner.trim().length === 0) {
        errors.push(`${entry.key} orphan entry requires an owner`);
      }
      if (typeof entry.expiry !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(entry.expiry)) {
        errors.push(`${entry.key} orphan entry requires a YYYY-MM-DD expiry`);
      } else if (entry.expiry < currentDateKey()) {
        errors.push(`${entry.key} orphan review expired on ${entry.expiry}`);
      }
    } else if ('review_state' in entry || 'owner' in entry || 'expiry' in entry) {
      errors.push(`${entry.key} non-orphan entry must not carry orphan review metadata`);
    }
  }

  return errors;
}

function summarize(inventory) {
  const classificationCounts = {};
  const exportCounts = {};
  for (const entry of inventory.entries) {
    classificationCounts[entry.classification] =
      (classificationCounts[entry.classification] ?? 0) + 1;
    exportCounts[entry.export_kind] = (exportCounts[entry.export_kind] ?? 0) + 1;
  }
  const classifications = Object.entries(classificationCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name}=${count}`)
    .join(', ');
  const exports = Object.entries(exportCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name}=${count}`)
    .join(', ');
  return `${inventory.route_file_count} route files / ${inventory.route_method_count} route-methods; ${exports}; ${classifications}`;
}

const writeMode = process.argv.includes('--write');
const live = collectLiveRoutes();
if (live.errors.length > 0) {
  console.error('API route reachability check failed.');
  for (const error of live.errors) console.error(`- ${error}`);
  process.exit(1);
}

const inventoryAbsolutePath = path.join(REPO_ROOT, INVENTORY_PATH);
const previousInventory = existsSync(inventoryAbsolutePath)
  ? JSON.parse(readFileSync(inventoryAbsolutePath, 'utf8'))
  : null;
const expectedInventory = buildInventory(live, previousInventory);

if (writeMode) {
  writeFileSync(inventoryAbsolutePath, stableJson(expectedInventory));
  console.log(`Wrote ${INVENTORY_PATH} (${summarize(expectedInventory)}).`);
  process.exit(0);
}

if (!previousInventory) {
  console.error(
    `API route reachability check failed. Missing ${INVENTORY_PATH}; run with --write.`,
  );
  process.exit(1);
}

const errors = validateInventory(previousInventory, expectedInventory, live);
if (errors.length > 0) {
  console.error('API route reachability check failed.');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`API route reachability check passed (${summarize(previousInventory)}).`);
