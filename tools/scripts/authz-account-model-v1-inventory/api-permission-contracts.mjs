import { existsSync, lstatSync } from 'node:fs';

import { createPermissionCheckAnalyzer } from './callback-analysis.mjs';
import {
  path,
  permissionLiteral,
  readRepoFile,
  safePath,
  sourceKind,
  ts,
  unresolvedDirectMethodMarker,
  unresolvedPermissionMarker,
  unresolvedReexportMarker,
  unwrapExpression,
} from './core.mjs';

export function parseApiPermissionContracts(sourcePath, content, repoRoot = process.cwd()) {
  if (!/^src\/app\/api(?:\/.*)?\/route\.[cm]?[jt]sx?$/.test(sourcePath)) return [];
  const parseFile = (currentPath, currentContent, seenBindings, requestedExports = []) => {
    const source = ts.createSourceFile(
      currentPath,
      currentContent,
      ts.ScriptTarget.Latest,
      true,
      sourceKind(currentPath),
    );
    const variables = new Map();
    const functions = new Map();
    const directlyExportedNames = new Set();
    const methods = new Map();
    const directMethodBindingCounts = new Map();
    const runtimeDeclarationCounts = new Map();
    const unresolvedBindingPatterns = new Map();
    const importedIdentifiers = new Set();
    const importedIdentifierNames = new Map();
    const importedIdentifierSources = new Map();
    const lexicalShadowBindings = new Map();
    const destructuredValueBindings = new Map();
    const reexports = [];
    const hasExportModifier = (node) =>
      (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) ?? false;
    const hasDefaultModifier = (node) =>
      (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      ) ?? false;
    const bindingIdentifiers = (name) => {
      if (ts.isIdentifier(name)) return [name];
      const identifiers = [];
      for (const element of name.elements) {
        if (ts.isOmittedExpression(element)) continue;
        identifiers.push(...bindingIdentifiers(element.name));
      }
      return identifiers;
    };
    const addLexicalShadowBinding = (name, declaration, scope) => {
      const bindings = lexicalShadowBindings.get(name) ?? [];
      bindings.push({ declaration, scope });
      lexicalShadowBindings.set(name, bindings);
    };
    const addDestructuredValueBinding = (name, binding) => {
      const bindings = destructuredValueBindings.get(name) ?? [];
      bindings.push(binding);
      destructuredValueBindings.set(name, bindings);
    };
    const functionOrSourceScope = (node) => {
      let current = node.parent;
      while (current && !ts.isSourceFile(current) && !ts.isFunctionLike(current)) {
        current = current.parent;
      }
      return ts.isFunctionLike(current) ? (current.body ?? current) : source;
    };
    const variableDeclarationScope = (node) => {
      if (ts.isCatchClause(node.parent)) return node.parent.block;
      if (
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.BlockScoped) === 0
      ) {
        return functionOrSourceScope(node);
      }
      let scope = node.parent;
      while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
      return scope ?? source;
    };
    const collectDeclarations = (node) => {
      if (ts.isParameter(node)) {
        const owner = node.parent;
        const scope = owner.body ?? owner;
        for (const identifier of bindingIdentifiers(node.name)) {
          addLexicalShadowBinding(identifier.text, node, scope);
        }
      }
      if (ts.isImportDeclaration(node) && node.importClause) {
        const moduleSpecifier = ts.isStringLiteralLike(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : '';
        if (node.importClause.name) {
          importedIdentifiers.add(node.importClause.name.text);
          importedIdentifierNames.set(node.importClause.name.text, 'default');
          importedIdentifierSources.set(node.importClause.name.text, moduleSpecifier);
        }
        const bindings = node.importClause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          importedIdentifiers.add(bindings.name.text);
          importedIdentifierNames.set(bindings.name.text, '*');
          importedIdentifierSources.set(bindings.name.text, moduleSpecifier);
        }
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            importedIdentifiers.add(element.name.text);
            importedIdentifierNames.set(
              element.name.text,
              element.propertyName?.text ?? element.name.text,
            );
            importedIdentifierSources.set(element.name.text, moduleSpecifier);
          }
        }
      }
      if (ts.isVariableDeclaration(node)) {
        const statement = node.parent?.parent;
        const topLevel = ts.isVariableStatement(statement) && statement.parent === source;
        const directlyExported = topLevel && hasExportModifier(statement);
        if (!ts.isIdentifier(node.name)) {
          const scope = variableDeclarationScope(node);
          for (const identifier of bindingIdentifiers(node.name)) {
            addLexicalShadowBinding(identifier.text, node, scope);
          }
          if (ts.isObjectBindingPattern(node.name) && node.initializer) {
            for (const element of node.name.elements) {
              if (!ts.isIdentifier(element.name) || element.dotDotDotToken) continue;
              addDestructuredValueBinding(element.name.text, {
                declaration: element,
                initializer: node.initializer,
                propertyName: element.propertyName ?? element.name,
                scope,
              });
            }
          }
        }
        if (!ts.isIdentifier(node.name) && topLevel) {
          for (const identifier of bindingIdentifiers(node.name)) {
            runtimeDeclarationCounts.set(
              identifier.text,
              (runtimeDeclarationCounts.get(identifier.text) ?? 0) + 1,
            );
            unresolvedBindingPatterns.set(identifier.text, node);
            if (directlyExported) directlyExportedNames.add(identifier.text);
            if (
              directlyExported &&
              /^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(identifier.text)
            ) {
              methods.set(identifier.text, node);
              directMethodBindingCounts.set(
                identifier.text,
                (directMethodBindingCounts.get(identifier.text) ?? 0) + 1,
              );
            }
          }
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        addLexicalShadowBinding(node.name.text, node, variableDeclarationScope(node));
        const declarations = variables.get(node.name.text) ?? [];
        declarations.push(node);
        variables.set(node.name.text, declarations);
        const statement = node.parent?.parent;
        const directlyExported =
          ts.isVariableStatement(statement) &&
          statement.parent === source &&
          hasExportModifier(statement);
        if (ts.isVariableStatement(statement) && statement.parent === source) {
          runtimeDeclarationCounts.set(
            node.name.text,
            (runtimeDeclarationCounts.get(node.name.text) ?? 0) + 1,
          );
        }
        if (directlyExported) directlyExportedNames.add(node.name.text);
        if (
          /^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(node.name.text) &&
          directlyExported
        ) {
          methods.set(node.name.text, node.initializer);
          directMethodBindingCounts.set(
            node.name.text,
            (directMethodBindingCounts.get(node.name.text) ?? 0) + 1,
          );
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        const declarations = functions.get(node.name.text) ?? [];
        declarations.push(node);
        functions.set(node.name.text, declarations);
        if (node.parent === source && node.body) {
          runtimeDeclarationCounts.set(
            node.name.text,
            (runtimeDeclarationCounts.get(node.name.text) ?? 0) + 1,
          );
        }
        if (node.parent === source && hasExportModifier(node) && !hasDefaultModifier(node)) {
          directlyExportedNames.add(node.name.text);
        }
        if (
          /^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(node.name.text) &&
          node.parent === source &&
          hasExportModifier(node) &&
          !hasDefaultModifier(node)
        ) {
          if (node.body || !methods.has(node.name.text)) methods.set(node.name.text, node);
          if (node.body) {
            directMethodBindingCounts.set(
              node.name.text,
              (directMethodBindingCounts.get(node.name.text) ?? 0) + 1,
            );
          }
        }
      }
      if (ts.isExportDeclaration(node)) {
        if (node.isTypeOnly) {
          ts.forEachChild(node, collectDeclarations);
          return;
        }
        const moduleSpecifier =
          node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : undefined;
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            if (element.isTypeOnly) continue;
            reexports.push({
              kind: 'named',
              exported: element.name.text,
              original: element.propertyName?.text ?? element.name.text,
              moduleSpecifier,
            });
          }
        } else if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
          reexports.push({
            kind: 'namespace',
            exported: node.exportClause.name.text,
            original: '*',
            moduleSpecifier,
          });
        } else if (!node.exportClause && moduleSpecifier) {
          reexports.push({ kind: 'star', exported: '*', original: '*', moduleSpecifier });
        }
      }
      ts.forEachChild(node, collectDeclarations);
    };
    collectDeclarations(source);

    const lexicalContainer = (node) => {
      if (ts.isVariableDeclaration(node)) return variableDeclarationScope(node);
      let current = node.parent;
      while (current && !ts.isBlock(current) && !ts.isSourceFile(current)) current = current.parent;
      return current;
    };

    const containsNode = (container, node) =>
      container && container.getStart(source) <= node.getStart(source) && container.end >= node.end;

    const visibleDeclaration = (declarations, reference) =>
      (declarations ?? [])
        .filter((declaration) => {
          const container = lexicalContainer(declaration);
          if (!containsNode(container, reference)) return false;
          return (
            ts.isFunctionDeclaration(declaration) ||
            declaration.getStart(source) <= reference.getStart(source)
          );
        })
        .sort((left, right) => {
          const leftContainer = lexicalContainer(left);
          const rightContainer = lexicalContainer(right);
          const spanDelta =
            leftContainer.end -
            leftContainer.getStart(source) -
            (rightContainer.end - rightContainer.getStart(source));
          return spanDelta || right.getStart(source) - left.getStart(source);
        })[0];

    const visibleLexicalShadow = (name, reference) =>
      (lexicalShadowBindings.get(name) ?? [])
        .filter(
          ({ declaration, scope }) =>
            containsNode(scope, reference) && declaration.getSourceFile() === source,
        )
        .sort(
          (left, right) =>
            left.scope.end -
              left.scope.getStart(source) -
              (right.scope.end - right.scope.getStart(source)) ||
            right.declaration.getStart(source) - left.declaration.getStart(source),
        )[0];

    const visibleDestructuredValueBinding = (name, reference) =>
      (destructuredValueBindings.get(name) ?? [])
        .filter(({ scope }) => containsNode(scope, reference))
        .sort(
          (left, right) =>
            left.scope.end -
              left.scope.getStart(source) -
              (right.scope.end - right.scope.getStart(source)) ||
            right.declaration.getStart(source) - left.declaration.getStart(source),
        )[0];

    const staticPropertyName = (name, seen = new Set()) => {
      if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
      if (!ts.isComputedPropertyName(name)) return undefined;
      return resolveStaticScalar(name.expression, seen);
    };

    const resolveStaticScalar = (expression, seen = new Set()) => {
      if (!expression) return undefined;
      const node = unwrapExpression(expression);
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isNumericLiteral(node)) return Number(node.text);
      if (ts.isIdentifier(node)) {
        const declaration = visibleDeclaration(variables.get(node.text), node);
        if (!declaration) return undefined;
        const key = `scalar:${node.text}:${declaration.pos}`;
        if (seen.has(key)) return undefined;
        return resolveStaticScalar(declaration.initializer, new Set(seen).add(key));
      }
      return undefined;
    };

    const selectObjectMember = (object, key, seen = new Set()) => {
      for (const property of [...object.properties].reverse()) {
        if (ts.isSpreadAssignment(property)) {
          const spread = resolveValueNode(property.expression, seen);
          if (!spread || !ts.isObjectLiteralExpression(spread)) return { unresolved: true };
          const selected = selectObjectMember(spread, key, seen);
          if (selected.node || selected.unresolved) return selected;
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          if (property.name.text === `${key}`) return { node: property.name };
          continue;
        }
        if (ts.isMethodDeclaration(property)) {
          const name = staticPropertyName(property.name, seen);
          if (name === undefined && ts.isComputedPropertyName(property.name)) {
            return { unresolved: true };
          }
          if (name === `${key}`) return { node: property };
          continue;
        }
        if (!ts.isPropertyAssignment(property)) continue;
        const name = staticPropertyName(property.name, seen);
        if (name === undefined && ts.isComputedPropertyName(property.name)) {
          return { unresolved: true };
        }
        if (name === `${key}`) return { node: property.initializer };
      }
      return {};
    };

    const resolveValueNode = (expression, seen = new Set()) => {
      if (!expression) return undefined;
      const node = unwrapExpression(expression);
      if (ts.isIdentifier(node)) {
        const declaration = visibleDeclaration(variables.get(node.text), node);
        if (!declaration) {
          const destructured = visibleDestructuredValueBinding(node.text, node);
          if (!destructured) return node;
          const owner = resolveValueNode(destructured.initializer, seen);
          const key = staticPropertyName(destructured.propertyName, seen);
          if (key === undefined || !owner) return undefined;
          if (ts.isObjectLiteralExpression(owner)) {
            const selected = selectObjectMember(owner, key, seen);
            return selected.node ? resolveValueNode(selected.node, seen) : undefined;
          }
          return undefined;
        }
        const key = `value:${node.text}:${declaration.pos}`;
        if (seen.has(key)) return undefined;
        return resolveValueNode(declaration.initializer, new Set(seen).add(key));
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const owner = resolveValueNode(node.expression, seen);
        const key = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : resolveStaticScalar(node.argumentExpression, seen);
        if (key === undefined || !owner) return undefined;
        if (ts.isArrayLiteralExpression(owner) && typeof key === 'number') {
          const element = owner.elements[key];
          return element && !ts.isOmittedExpression(element)
            ? resolveValueNode(element, seen)
            : undefined;
        }
        if (ts.isObjectLiteralExpression(owner)) {
          const selected = selectObjectMember(owner, key, seen);
          return selected.node ? resolveValueNode(selected.node, seen) : undefined;
        }
        return undefined;
      }
      return node;
    };

    const authPermissionEntrypoints = new Set([
      'withAuthContext',
      'requireAuthContext',
      'requireApiKeyOrAuthContext',
    ]);
    const canonicalPermissionEvaluatorModules = new Set([
      '@/lib/auth/permissions',
      '@/lib/auth/permission-matrix',
    ]);
    const resolveCallable = (expression, seen = new Set()) => {
      if (!expression) return { kind: 'unresolved' };
      const node = unwrapExpression(expression);
      if (ts.isIdentifier(node)) {
        const lexicalShadow = visibleLexicalShadow(node.text, node);
        const variableDeclaration = visibleDeclaration(variables.get(node.text), node);
        if (lexicalShadow && lexicalShadow.declaration !== variableDeclaration) {
          return { kind: 'shadowed_lexical', name: node.text };
        }
        const functionDeclaration = visibleDeclaration(functions.get(node.text), node);
        if (functionDeclaration) {
          return authPermissionEntrypoints.has(node.text)
            ? { kind: 'shadowed_auth' }
            : { kind: 'target', target: functionDeclaration };
        }
        if (variableDeclaration) {
          if (authPermissionEntrypoints.has(node.text)) return { kind: 'shadowed_auth' };
          const key = `callable:${node.text}:${variableDeclaration.pos}`;
          if (seen.has(key)) return { kind: 'unresolved_alias' };
          const resolved = resolveCallable(variableDeclaration.initializer, new Set(seen).add(key));
          return ['unresolved', 'shadowed_lexical'].includes(resolved.kind)
            ? { kind: 'unresolved_alias' }
            : resolved;
        }
        if (importedIdentifiers.has(node.text)) {
          const original = importedIdentifierNames.get(node.text) ?? node.text;
          const moduleSpecifier = importedIdentifierSources.get(node.text) ?? '';
          if (authPermissionEntrypoints.has(original) && moduleSpecifier === '@/lib/auth/context') {
            return { kind: 'auth', name: original };
          }
          return {
            kind: 'imported',
            name: node.text,
            original,
            moduleSpecifier,
          };
        }
        return { kind: 'unresolved' };
      }
      if (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)
      ) {
        return { kind: 'target', target: node };
      }
      if (ts.isCallExpression(node)) {
        const bindReceiver =
          ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'bind'
            ? node.expression.expression
            : ts.isElementAccessExpression(node.expression) &&
                ts.isStringLiteralLike(node.expression.argumentExpression) &&
                node.expression.argumentExpression.text === 'bind'
              ? node.expression.expression
              : undefined;
        if (bindReceiver) {
          if (ts.isCallExpression(bindReceiver)) {
            const factory = resolveCallable(bindReceiver.expression, seen);
            return ['target', 'targets'].includes(factory.kind)
              ? { kind: 'target', target: bindReceiver }
              : factory;
          }
          return resolveCallable(bindReceiver, seen);
        }
        return { kind: 'target', target: node };
      }
      if (ts.isConditionalExpression(node)) {
        const branches = [
          resolveCallable(node.whenTrue, seen),
          resolveCallable(node.whenFalse, seen),
        ];
        if (branches.every((branch) => branch.kind === 'target' || branch.kind === 'targets')) {
          return {
            kind: 'targets',
            targets: branches.flatMap((branch) =>
              branch.kind === 'target' ? [branch.target] : branch.targets,
            ),
          };
        }
        if (
          branches.every((branch) => branch.kind === 'auth' && branch.name === branches[0].name)
        ) {
          return branches[0];
        }
        return { kind: 'unresolved_alias' };
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return resolveCallable(node.right, seen);
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const selected = resolveValueNode(node, seen);
        if (selected && selected !== node) return resolveCallable(selected, seen);
      }
      return { kind: 'unresolved' };
    };

    const resolveExpression = (expression, seen = new Set()) => {
      if (!expression) return new Set();
      const node = unwrapExpression(expression);
      if (ts.isStringLiteralLike(node)) {
        const permission = permissionLiteral(node.text);
        return new Set(permission ? [permission] : []);
      }
      if (ts.isIdentifier(node)) {
        const declaration = visibleDeclaration(variables.get(node.text), node);
        if (!declaration) return new Set();
        const key = `variable:${node.text}:${declaration.pos}`;
        if (seen.has(key)) return new Set();
        return resolveExpression(declaration.initializer, new Set(seen).add(key));
      }
      if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) {
        const selected = resolveValueNode(node, seen);
        return selected && selected !== node ? resolveExpression(selected, seen) : new Set();
      }
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          const declaration = visibleDeclaration(
            functions.get(node.expression.text),
            node.expression,
          );
          const key = declaration && `function:${node.expression.text}:${declaration.pos}`;
          if (declaration && !seen.has(key)) {
            return resolveFunctionReturns(declaration, new Set(seen).add(key));
          }
        }
        return new Set();
      }
      if (ts.isArrayLiteralExpression(node)) {
        const values = new Set();
        for (const element of node.elements) {
          if (ts.isOmittedExpression(element)) continue;
          for (const value of resolveExpression(element, seen)) values.add(value);
        }
        return values;
      }
      if (ts.isObjectLiteralExpression(node)) {
        const selected = selectObjectMember(node, 'permission', seen);
        return selected.node ? resolveExpression(selected.node, seen) : new Set();
      }
      return new Set();
    };

    const resolveFunctionReturns = (fn, seen) => {
      const values = new Set();
      const visit = (node) => {
        if (
          ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node)
        ) {
          return;
        }
        if (ts.isReturnStatement(node)) {
          for (const value of resolveExpression(node.expression, seen)) values.add(value);
          return;
        }
        ts.forEachChild(node, visit);
      };
      if (fn?.body) visit(fn.body);
      return values;
    };

    const analyzePermissionOptions = (expression, seen = new Set()) => {
      const values = new Set();
      if (!expression) return values;
      const node = unwrapExpression(expression);
      if (ts.isIdentifier(node)) {
        const declaration = visibleDeclaration(variables.get(node.text), node);
        const key = declaration && `options:${node.text}:${declaration.pos}`;
        if (!declaration || seen.has(key)) {
          values.add(unresolvedPermissionMarker(node, source));
          return values;
        }
        return analyzePermissionOptions(declaration.initializer, new Set(seen).add(key));
      }
      if (!ts.isObjectLiteralExpression(node)) {
        values.add(unresolvedPermissionMarker(node, source));
        return values;
      }
      const selected = selectObjectMember(node, 'permission', seen);
      if (selected.unresolved) {
        values.add(unresolvedPermissionMarker(node, source));
        return values;
      }
      if (!selected.node) return values;
      const resolved = resolveExpression(selected.node);
      if (resolved.size === 0) values.add(unresolvedPermissionMarker(selected.node, source));
      for (const value of resolved) values.add(value);
      return values;
    };

    const analyzePermissionChecks = createPermissionCheckAnalyzer({
      analyzePermissionOptions,
      authPermissionEntrypoints,
      canonicalPermissionEvaluatorModules,
      containsNode,
      importedIdentifierNames,
      importedIdentifiers,
      resolveCallable,
      resolveExpression,
      resolveStaticScalar,
      resolveValueNode,
      selectObjectMember,
      source,
      staticPropertyName,
      variables,
      visibleDeclaration,
      visibleDestructuredValueBinding,
    });

    const contractForDeclaration = (method, declaration, originName = method) => {
      const permissions = new Set();
      let handler;
      if (!declaration || (ts.isFunctionDeclaration(declaration) && !declaration.body)) {
        return {
          method,
          permissions: [unresolvedDirectMethodMarker(currentPath, method, declaration, source)],
          origin: `${currentPath}#${originName}`,
        };
      }
      if (ts.isFunctionDeclaration(declaration)) {
        handler = declaration;
      } else if (declaration) {
        for (const value of analyzePermissionChecks(declaration, new Set(), true)) {
          permissions.add(value);
        }
        const initializer = unwrapExpression(declaration);
        if (ts.isCallExpression(initializer)) {
          const callee = unwrapExpression(initializer.expression);
          const callable = resolveCallable(callee);
          if (callable.kind === 'auth' && callable.name === 'withAuthContext') {
            for (const option of initializer.arguments.slice(1)) {
              for (const value of analyzePermissionOptions(option)) permissions.add(value);
            }
          }
          const importedCallee =
            callable.kind === 'imported' ||
            callable.kind === 'unresolved_alias' ||
            callable.kind === 'shadowed_auth' ||
            (callable.kind === 'unresolved' && callee.getText(source) !== 'Object.assign');
          if (importedCallee) {
            permissions.add(unresolvedDirectMethodMarker(currentPath, method, declaration, source));
          }
          if (initializer.arguments[0]) {
            const first = unwrapExpression(initializer.arguments[0]);
            if (ts.isIdentifier(first)) {
              handler =
                visibleDeclaration(functions.get(first.text), first) ??
                visibleDeclaration(variables.get(first.text), first)?.initializer;
              if (!handler && importedIdentifiers.has(first.text)) {
                permissions.add(
                  unresolvedDirectMethodMarker(currentPath, method, declaration, source),
                );
              }
            } else if (ts.isArrowFunction(first) || ts.isFunctionExpression(first)) handler = first;
            else {
              permissions.add(
                unresolvedDirectMethodMarker(currentPath, method, declaration, source),
              );
            }
          }
        } else if (ts.isIdentifier(initializer)) {
          handler =
            visibleDeclaration(functions.get(initializer.text), initializer) ??
            visibleDeclaration(variables.get(initializer.text), initializer)?.initializer;
          if (!handler) {
            permissions.add(unresolvedDirectMethodMarker(currentPath, method, declaration, source));
          }
        } else if (
          ts.isPropertyAccessExpression(initializer) ||
          ts.isElementAccessExpression(initializer)
        ) {
          permissions.add(unresolvedDirectMethodMarker(currentPath, method, declaration, source));
        }
      }
      for (const value of analyzePermissionChecks(handler)) permissions.add(value);
      return {
        method,
        permissions: [...permissions].sort(),
        origin: `${currentPath}#${originName}`,
      };
    };

    const contractForName = (method, name, directExportRequired = false) => {
      if (directExportRequired && !directlyExportedNames.has(name)) return undefined;
      const declarationCount = runtimeDeclarationCounts.get(name) ?? 0;
      if (declarationCount > 1) {
        const origin = `${currentPath}#${name}`;
        return {
          method,
          permissions: [
            unresolvedReexportMarker(
              `${origin}|occurrences=${declarationCount}`,
              method,
              'explicit_conflict',
            ),
          ],
          origin: `ambiguous:${origin}`,
        };
      }
      const bindingPattern = unresolvedBindingPatterns.get(name);
      if (bindingPattern) {
        return {
          method,
          permissions: [unresolvedDirectMethodMarker(currentPath, method, bindingPattern, source)],
          origin: `${currentPath}#${name}`,
        };
      }
      const functionDeclaration = functions
        .get(name)
        ?.find(
          (declaration) =>
            ts.isSourceFile(lexicalContainer(declaration)) && declaration.body !== undefined,
        );
      const variableDeclaration = variables
        .get(name)
        ?.find((declaration) => ts.isSourceFile(lexicalContainer(declaration)));
      const declaration = functionDeclaration ?? variableDeclaration?.initializer;
      return declaration ? contractForDeclaration(method, declaration, name) : undefined;
    };

    const resolveRelativeTarget = (moduleSpecifier) => {
      if (!moduleSpecifier.startsWith('.')) return undefined;
      const base = path.posix.normalize(
        path.posix.join(path.posix.dirname(currentPath), moduleSpecifier),
      );
      const candidates = path.posix.extname(base)
        ? [base]
        : [
            base,
            ...['.ts', '.tsx', '.js', '.mjs'].map((extension) => `${base}${extension}`),
            `${base}/index.ts`,
          ];
      return candidates.find((candidate) => {
        const resolved = safePath(repoRoot, candidate, 'route re-export target');
        return existsSync(resolved.absolute) && lstatSync(resolved.absolute).isFile();
      });
    };

    const contractsByMethod = new Map();
    for (const request of requestedExports) {
      const contract = contractForName(request.method, request.original, true);
      if (contract) contractsByMethod.set(request.method, contract);
    }
    if (requestedExports.length === 0) {
      for (const [method, declaration] of methods) {
        contractsByMethod.set(
          method,
          unresolvedBindingPatterns.has(method)
            ? contractForName(method, method, true)
            : contractForDeclaration(method, declaration),
        );
      }
    }
    for (const [method, count] of directMethodBindingCounts) {
      if (count <= 1 || !contractsByMethod.has(method)) continue;
      const origin = `${currentPath}#${method}`;
      contractsByMethod.set(method, {
        method,
        permissions: [
          unresolvedReexportMarker(`${origin}|occurrences=${count}`, method, 'explicit_conflict'),
        ],
        origin: `ambiguous:${origin}`,
      });
    }
    const requestsByExported = new Map(
      requestedExports.map((request) => [request.original, request.method]),
    );
    const starMethodSources = new Map();
    const explicitMethodCounts = new Map(
      [...contractsByMethod.keys()].map((method) => [
        method,
        directMethodBindingCounts.get(method) ?? 1,
      ]),
    );
    const explicitMethodOrigins = new Map(
      [...contractsByMethod.entries()].map(([method, contract]) => [
        method,
        new Set([contract.origin]),
      ]),
    );
    let sawCyclicStarBranch = false;
    const orderedReexports = [...reexports].sort(
      (left, right) => Number(left.kind === 'star') - Number(right.kind === 'star'),
    );
    for (const reexport of orderedReexports) {
      if (reexport.kind === 'star') {
        const targetPath = resolveRelativeTarget(reexport.moduleSpecifier);
        const targetRequests = requestedExports.filter(
          (request) => !seenBindings.has(`${targetPath}#${request.original}`),
        );
        if (targetPath && targetRequests.length < requestedExports.length) {
          sawCyclicStarBranch = true;
        }
        const rootTargetBinding = `${targetPath}#*`;
        if (targetPath && requestedExports.length === 0 && seenBindings.has(rootTargetBinding)) {
          sawCyclicStarBranch = true;
          continue;
        }
        if (targetPath && requestedExports.length > 0 && targetRequests.length === 0) continue;
        const targetAvailable = Boolean(targetPath);
        let targetContracts = [];
        if (targetAvailable) {
          const nextBindings = new Set(seenBindings);
          if (requestedExports.length > 0) {
            for (const request of targetRequests) {
              nextBindings.add(`${targetPath}#${request.original}`);
            }
          } else {
            nextBindings.add(rootTargetBinding);
          }
          targetContracts = parseFile(
            targetPath,
            readRepoFile(repoRoot, targetPath, 'route star re-export target'),
            nextBindings,
            requestedExports.length > 0 ? targetRequests : requestedExports,
          );
        }
        if (targetContracts.length === 0) {
          if (targetAvailable) continue;
          targetContracts =
            requestedExports.length > 0
              ? requestedExports.map((request) => ({
                  method: request.method,
                  permissions: [
                    unresolvedReexportMarker(
                      reexport.moduleSpecifier,
                      request.original,
                      request.method,
                    ),
                  ],
                  origin: `unresolved:${currentPath}:${reexport.moduleSpecifier}#${request.original}`,
                }))
              : [
                  {
                    method: 'UNKNOWN',
                    permissions: [unresolvedReexportMarker(reexport.moduleSpecifier, '*', '*')],
                    origin: `unresolved:${currentPath}:${reexport.moduleSpecifier}#*`,
                  },
                ];
        }
        for (const contract of targetContracts) {
          if (contract.cyclic) {
            sawCyclicStarBranch = true;
            continue;
          }
          const starOrigins = starMethodSources.get(contract.method);
          if (!starOrigins && contractsByMethod.has(contract.method)) continue;
          if (!starOrigins) {
            contractsByMethod.set(contract.method, contract);
            starMethodSources.set(contract.method, new Set([contract.origin]));
          } else if (!starOrigins.has(contract.origin)) {
            starOrigins.add(contract.origin);
            const origins = [...starOrigins].sort().join('|');
            contractsByMethod.set(contract.method, {
              method: contract.method,
              permissions: [
                unresolvedReexportMarker(origins, contract.method, 'ambiguous_star_export'),
              ],
              origin: `ambiguous:${origins}`,
            });
          }
        }
        continue;
      }
      const method =
        requestedExports.length > 0
          ? requestsByExported.get(reexport.exported)
          : /^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(reexport.exported)
            ? reexport.exported
            : undefined;
      if (!method) continue;
      let contract;
      if (reexport.kind === 'namespace') {
        contract = undefined;
      } else if (reexport.moduleSpecifier) {
        const targetPath = resolveRelativeTarget(reexport.moduleSpecifier);
        const targetBinding = `${targetPath}#${reexport.original}`;
        if (targetPath && !seenBindings.has(targetBinding)) {
          const targetContracts = parseFile(
            targetPath,
            readRepoFile(repoRoot, targetPath, 'route re-export target'),
            new Set(seenBindings).add(targetBinding),
            [{ method, original: reexport.original }],
          );
          const candidate = targetContracts.find((item) => item.method === method);
          if (!candidate?.cyclic) contract = candidate;
        }
      } else {
        contract = contractForName(method, reexport.original);
      }
      const resolvedContract = contract ?? {
        method,
        permissions: [
          unresolvedReexportMarker(reexport.moduleSpecifier, reexport.original, reexport.exported),
        ],
        origin: `unresolved:${currentPath}:${reexport.moduleSpecifier ?? '<local>'}#${reexport.original}`,
      };
      const occurrenceCount = explicitMethodCounts.get(method) ?? 0;
      const explicitOrigins = explicitMethodOrigins.get(method) ?? new Set();
      explicitOrigins.add(resolvedContract.origin);
      explicitMethodOrigins.set(method, explicitOrigins);
      explicitMethodCounts.set(method, occurrenceCount + 1);
      if (occurrenceCount === 0) {
        contractsByMethod.set(method, resolvedContract);
      } else {
        const origins = [...explicitOrigins].sort().join('|');
        contractsByMethod.set(method, {
          method,
          permissions: [
            unresolvedReexportMarker(
              `${origins}|occurrences=${occurrenceCount + 1}`,
              method,
              'explicit_conflict',
            ),
          ],
          origin: `ambiguous:${origins}`,
        });
      }
    }
    if (contractsByMethod.size === 0 && sawCyclicStarBranch) {
      return requestedExports.length > 0
        ? requestedExports.map((request) => ({
            method: request.method,
            permissions: [],
            origin: `cycle:${currentPath}#${request.original}`,
            cyclic: true,
          }))
        : [
            {
              method: 'UNKNOWN',
              permissions: [],
              origin: `cycle:${currentPath}#*`,
              cyclic: true,
            },
          ];
    }
    return [...contractsByMethod.values()].sort((left, right) =>
      left.method.localeCompare(right.method),
    );
  };

  return parseFile(sourcePath, content, new Set([`${sourcePath}#*`])).map((contract) => ({
    method: contract.method,
    permissions: contract.cyclic
      ? [unresolvedReexportMarker(sourcePath, contract.method, 'cyclic_star_export')]
      : contract.permissions,
  }));
}
