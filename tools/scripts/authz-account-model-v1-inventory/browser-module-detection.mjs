import ts from 'typescript';

function sourceKind(sourcePath) {
  return sourcePath.endsWith('.tsx') || sourcePath.endsWith('.jsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
}

function unwrap(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function resolveStaticStrings(expression, variables, seen = new Set()) {
  const node = expression && unwrap(expression);
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans) {
      const resolved = resolveStaticStrings(span.expression, variables, seen);
      if (resolved.length === 0) return [];
      values = values.flatMap((prefix) =>
        resolved.map((value) => `${prefix}${value}${span.literal.text}`),
      );
    }
    return values;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveStaticStrings(node.left, variables, seen);
    const right = resolveStaticStrings(node.right, variables, seen);
    return left.flatMap((prefix) => right.map((suffix) => `${prefix}${suffix}`));
  }
  if (ts.isConditionalExpression(node)) {
    return [
      ...resolveStaticStrings(node.whenTrue, variables, seen),
      ...resolveStaticStrings(node.whenFalse, variables, seen),
    ];
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'join' &&
    ts.isArrayLiteralExpression(unwrap(node.expression.expression)) &&
    node.arguments.length <= 1
  ) {
    const separator =
      node.arguments.length === 0
        ? [',']
        : resolveStaticStrings(node.arguments[0], variables, seen);
    const elements = unwrap(node.expression.expression).elements.map((element) =>
      resolveStaticStrings(element, variables, seen),
    );
    if (separator.length !== 1 || elements.some((values) => values.length !== 1)) return [];
    return [elements.map(([value]) => value).join(separator[0])];
  }
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return [];
    const initializers = variables.get(node.text) ?? [];
    const nextSeen = new Set(seen).add(node.text);
    return initializers.flatMap((initializer) =>
      resolveStaticStrings(initializer, variables, nextSeen),
    );
  }
  return [];
}

function collectVariables(source) {
  const variables = new Map();
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const values = variables.get(node.name.text) ?? [];
      values.push(node.initializer);
      variables.set(node.name.text, values);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  return variables;
}

function propertyName(expression) {
  const node = unwrap(expression);
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(unwrap(node.argumentExpression))
  ) {
    return unwrap(node.argumentExpression).text;
  }
  return undefined;
}

function isNodeModuleSpecifier(expression, variables) {
  return resolveStaticStrings(expression, variables).some(
    (specifier) => specifier === 'node:module' || specifier === 'module',
  );
}

function collectModuleLoaderBindings(source, variables) {
  const loaders = new Set(['require']);
  const factories = new Set();
  const moduleObjects = new Set();

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !isNodeModuleSpecifier(statement.moduleSpecifier, variables)
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) moduleObjects.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      moduleObjects.add(clause.namedBindings.name.text);
    } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if ((element.propertyName ?? element.name).text === 'createRequire') {
          factories.add(element.name.text);
        }
      }
    }
  }

  const isLoaderValue = (expression) => {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) return loaders.has(node.text);
    return (
      ts.isCallExpression(node) &&
      propertyName(node.expression) === 'bind' &&
      isLoaderValue(unwrap(node.expression).expression)
    );
  };
  const isModuleObjectValue = (expression) => {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) return moduleObjects.has(node.text);
    return (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isIdentifier(unwrap(node.expression)) &&
      loaders.has(unwrap(node.expression).text) &&
      isNodeModuleSpecifier(node.arguments[0], variables)
    );
  };
  const isFactoryValue = (expression) => {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) return factories.has(node.text);
    return propertyName(node) === 'createRequire' && isModuleObjectValue(unwrap(node).expression);
  };

  let changed = true;
  while (changed) {
    changed = false;
    const add = (set, value) => {
      if (!set.has(value)) {
        set.add(value);
        changed = true;
      }
    };
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const initializer = unwrap(node.initializer);
        if (ts.isIdentifier(node.name)) {
          if (isLoaderValue(initializer)) add(loaders, node.name.text);
          if (isModuleObjectValue(initializer)) add(moduleObjects, node.name.text);
          if (isFactoryValue(initializer)) add(factories, node.name.text);
          if (ts.isCallExpression(initializer) && isFactoryValue(initializer.expression)) {
            add(loaders, node.name.text);
          }
        } else if (ts.isObjectBindingPattern(node.name) && isModuleObjectValue(initializer)) {
          for (const element of node.name.elements) {
            const sourceName = (element.propertyName ?? element.name).getText(source);
            if (sourceName === 'createRequire' && ts.isIdentifier(element.name)) {
              add(factories, element.name.text);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { loaders, isLoaderValue };
}

export function collectStaticModuleSpecifiers(sourcePath, content) {
  const source = ts.createSourceFile(
    sourcePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    sourceKind(sourcePath),
  );
  const variables = collectVariables(source);

  const specifiers = new Set();
  const collect = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      for (const value of resolveStaticStrings(node.moduleSpecifier, variables)) {
        specifiers.add(value);
      }
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      for (const value of resolveStaticStrings(node.arguments[0], variables)) {
        specifiers.add(value);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  return [...specifiers].sort();
}

export function sourceReferencesPlaywrightPackage(sourcePath, content) {
  return collectStaticModuleSpecifiers(sourcePath, content).some((specifier) =>
    /^(?:@playwright\/test|@axe-core\/playwright|playwright(?:-core)?)(?:\/.*)?$/.test(specifier),
  );
}

export function sourceContainsDynamicModuleLoader(sourcePath, content) {
  const source = ts.createSourceFile(
    sourcePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    sourceKind(sourcePath),
  );
  const variables = collectVariables(source);
  const { isLoaderValue } = collectModuleLoaderBindings(source, variables);
  let found = false;
  const isDynamic = (expression) => resolveStaticStrings(expression, variables).length === 0;
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      found = true;
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (isLoaderValue(callee) && node.arguments[0] && isDynamic(node.arguments[0])) {
        found = true;
        return;
      }
      const method = propertyName(callee);
      const receiver =
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
        unwrap(callee.expression);
      if (receiver && isLoaderValue(receiver)) {
        if (method === 'call' && node.arguments[1] && isDynamic(node.arguments[1])) {
          found = true;
          return;
        }
        if (method === 'apply' && node.arguments[1]) {
          const packed = unwrap(node.arguments[1]);
          if (
            !ts.isArrayLiteralExpression(packed) ||
            !packed.elements[0] ||
            isDynamic(packed.elements[0])
          ) {
            found = true;
            return;
          }
        }
        if (method === 'resolve' && node.arguments[0] && isDynamic(node.arguments[0])) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
