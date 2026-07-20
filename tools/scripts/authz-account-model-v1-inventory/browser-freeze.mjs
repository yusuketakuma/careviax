import { existsSync, lstatSync, readdirSync } from 'node:fs';

import {
  assert,
  path,
  readRepoBuffer,
  readRepoFile,
  safePath,
  sha256,
  SKIPPED_DIRECTORIES,
  sourceKind,
  stableJson,
  ts,
  unwrapExpression,
  walkFiles,
} from './core.mjs';
import {
  sourceContainsDynamicModuleLoader,
  sourceReferencesPlaywrightPackage,
} from './browser-module-detection.mjs';

function collectBrowserSnapshotPaths(repoRoot) {
  const files = [];
  const visit = (relativePath, insideSnapshotDirectory = false) => {
    const resolved = safePath(repoRoot, relativePath, 'browser snapshot path');
    if (!existsSync(resolved.absolute)) return;
    const stat = lstatSync(resolved.absolute);
    assert(!stat.isSymbolicLink(), 'browser snapshot path must not be a symlink', [relativePath]);
    if (stat.isFile()) {
      if (insideSnapshotDirectory) files.push(resolved.normalized);
      return;
    }
    assert(stat.isDirectory(), 'browser snapshot path must be a directory', [relativePath]);
    for (const entry of readdirSync(resolved.absolute, { withFileTypes: true })) {
      visit(
        path.posix.join(resolved.normalized, entry.name),
        insideSnapshotDirectory || entry.name.endsWith('-snapshots'),
      );
    }
  };
  visit('tools/tests');
  return files.sort();
}

function collectBrowserHarnessPaths(repoRoot) {
  const files = [];
  const visit = (relativePath) => {
    const resolved = safePath(repoRoot, relativePath, 'browser harness path');
    if (!existsSync(resolved.absolute)) return;
    const stat = lstatSync(resolved.absolute);
    assert(!stat.isSymbolicLink(), 'browser harness path must not be a symlink', [relativePath]);
    if (stat.isFile()) {
      files.push(resolved.normalized);
      return;
    }
    assert(stat.isDirectory(), 'browser harness path must be a directory', [relativePath]);
    for (const entry of readdirSync(resolved.absolute, { withFileTypes: true })) {
      visit(path.posix.join(resolved.normalized, entry.name));
    }
  };
  visit('tools/browser-harness');
  return files.sort();
}

function collectBrowserExtendedModulePaths(repoRoot) {
  const files = [];
  const visit = (relativePath) => {
    const resolved = safePath(repoRoot, relativePath, 'browser extended module path');
    if (!existsSync(resolved.absolute)) return;
    const stat = lstatSync(resolved.absolute);
    assert(!stat.isSymbolicLink(), 'browser extended module path must not be a symlink', [
      relativePath,
    ]);
    if (stat.isFile()) {
      if (/\.[cm]ts$/.test(resolved.normalized)) files.push(resolved.normalized);
      return;
    }
    assert(stat.isDirectory(), 'browser extended module path must be a directory', [relativePath]);
    for (const entry of readdirSync(resolved.absolute, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      visit(path.posix.join(resolved.normalized, entry.name));
    }
  };
  visit('tools/tests');
  return files.sort();
}

const BROWSER_TOOL_SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
];
const BROWSER_SPEC_PATTERN = /\.spec\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;
const PLAYWRIGHT_CONFIG_PATTERN =
  /(?:^|\/)playwright(?:\.[^/]+)*\.config\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;

function resolveBrowserToolDependency(repoRoot, fromPath, moduleSpecifier) {
  if (!moduleSpecifier.startsWith('.')) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), moduleSpecifier));
  const candidates = BROWSER_TOOL_SOURCE_EXTENSIONS.includes(path.posix.extname(base))
    ? [base]
    : [
        base,
        ...BROWSER_TOOL_SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
        ...BROWSER_TOOL_SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
      ];
  for (const candidate of candidates) {
    const resolved = safePath(repoRoot, candidate, 'browser asset dependency');
    if (existsSync(resolved.absolute) && lstatSync(resolved.absolute).isFile()) {
      return resolved.normalized;
    }
  }
  assert(false, 'browser asset dependency unresolved', [fromPath, moduleSpecifier]);
}

function collectBrowserToolModuleSpecifiers(sourcePath, content) {
  const source = ts.createSourceFile(
    sourcePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith('.tsx') || sourcePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function collectBrowserPackageScriptPaths(repoRoot) {
  const packagePath = safePath(repoRoot, 'package.json', 'browser package scripts');
  if (!existsSync(packagePath.absolute)) return new Set();
  const packageJson = JSON.parse(readRepoFile(repoRoot, 'package.json', 'browser package scripts'));
  const scripts = packageJson.scripts ?? {};
  assert(
    scripts && typeof scripts === 'object' && !Array.isArray(scripts),
    'browser package scripts must be an object',
  );
  const browserScriptNames = new Set(
    Object.entries(scripts)
      .filter(
        ([name, command]) =>
          /(?:browser|e2e|playwright)/i.test(name) ||
          (typeof command === 'string' && /(?:browser|e2e|playwright)/i.test(command)),
      )
      .map(([name]) => name),
  );
  const pending = [...browserScriptNames];
  const paths = new Set();
  while (pending.length > 0) {
    const scriptName = pending.pop();
    const command = scripts[scriptName];
    assert(typeof command === 'string', 'browser package script must be a string', [scriptName]);
    for (const match of command.matchAll(
      /(?:^|[\s"'=<(])(?:\$PWD\/|\.\/)?((?:tools\/)[^\s"';&|)<>]+)/g,
    )) {
      const sourcePath = match[1].replace(/[,:]+$/, '');
      const resolved = safePath(repoRoot, sourcePath, 'browser package script asset');
      assert(
        existsSync(resolved.absolute) && lstatSync(resolved.absolute).isFile(),
        'browser package script asset missing',
        [scriptName, sourcePath],
      );
      paths.add(resolved.normalized);
    }
    for (const match of command.matchAll(/\bpnpm(?:\s+run)?\s+([\w:-]+)/g)) {
      const dependencyName = match[1];
      if (Object.hasOwn(scripts, dependencyName) && !browserScriptNames.has(dependencyName)) {
        browserScriptNames.add(dependencyName);
        pending.push(dependencyName);
      }
    }
  }
  return paths;
}

function collectRepositoryBrowserEntrypoints(repoRoot) {
  const repositoryFiles = [];
  const visit = (relativePath) => {
    const resolved = safePath(repoRoot, relativePath, 'browser repository entrypoint');
    const stat = lstatSync(resolved.absolute);
    assert(!stat.isSymbolicLink(), 'browser repository entrypoint must not be a symlink', [
      relativePath,
    ]);
    if (stat.isFile()) {
      repositoryFiles.push(resolved.normalized);
      return;
    }
    assert(stat.isDirectory(), 'browser repository entrypoint must be a directory', [relativePath]);
    for (const entry of readdirSync(resolved.absolute, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      visit(path.posix.join(resolved.normalized, entry.name));
    }
  };
  visit('.');

  const configPaths = repositoryFiles.filter((sourcePath) =>
    PLAYWRIGHT_CONFIG_PATTERN.test(sourcePath),
  );
  assert(configPaths.length > 0, 'Playwright config discovery must not be empty');
  const configSet = new Set(configPaths);
  const configMetadata = new Map();
  for (const configPath of configPaths) {
    const source = ts.createSourceFile(
      configPath,
      readRepoFile(repoRoot, configPath, 'Playwright config discovery'),
      ts.ScriptTarget.Latest,
      true,
      sourceKind(configPath),
    );
    const imports = new Map();
    const variables = new Map();
    const canonicalDefineConfigIdentifiers = new Set();
    const canonicalPlaywrightNamespaces = new Set();
    let defaultExport;
    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === '@playwright/test' &&
        statement.importClause?.namedBindings
      ) {
        if (ts.isNamedImports(statement.importClause.namedBindings)) {
          for (const element of statement.importClause.namedBindings.elements) {
            if ((element.propertyName?.text ?? element.name.text) === 'defineConfig') {
              canonicalDefineConfigIdentifiers.add(element.name.text);
            }
          }
        } else if (ts.isNamespaceImport(statement.importClause.namedBindings)) {
          canonicalPlaywrightNamespaces.add(statement.importClause.namedBindings.name.text);
        }
      }
      if (
        ts.isImportDeclaration(statement) &&
        statement.importClause?.name &&
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.startsWith('.')
      ) {
        const base = path.posix.normalize(
          path.posix.join(path.posix.dirname(configPath), statement.moduleSpecifier.text),
        );
        const candidates = BROWSER_TOOL_SOURCE_EXTENSIONS.includes(path.posix.extname(base))
          ? [base]
          : BROWSER_TOOL_SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`);
        const inherited = candidates.find((candidate) => configSet.has(candidate));
        if (inherited) imports.set(statement.importClause.name.text, inherited);
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            variables.set(declaration.name.text, declaration.initializer);
          }
        }
      }
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        assert(!defaultExport, 'Playwright config has multiple default exports', [configPath]);
        defaultExport = statement.expression;
      }
    }
    assert(defaultExport, 'Playwright config default export is missing', [configPath]);
    configMetadata.set(configPath, {
      source,
      imports,
      variables,
      canonicalDefineConfigIdentifiers,
      canonicalPlaywrightNamespaces,
      defaultExport,
    });
  }

  const resolvedTestDirectoryValues = new Map();
  const resolveConfigExpression = (configPath, expression, seen) => {
    const metadata = configMetadata.get(configPath);
    const node = unwrapExpression(expression);
    if (ts.isCallExpression(node)) {
      const canonicalDefineConfigCall =
        (ts.isIdentifier(node.expression) &&
          metadata.canonicalDefineConfigIdentifiers.has(node.expression.text)) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          metadata.canonicalPlaywrightNamespaces.has(node.expression.expression.text) &&
          node.expression.name.text === 'defineConfig');
      assert(
        canonicalDefineConfigCall && node.arguments.length === 1,
        'Playwright config default export call is not statically supported',
        [configPath],
      );
      return resolveConfigExpression(configPath, node.arguments[0], seen);
    }
    if (ts.isIdentifier(node)) {
      if (metadata.imports.has(node.text)) {
        return resolveConfigDefault(metadata.imports.get(node.text), seen);
      }
      const initializer = metadata.variables.get(node.text);
      assert(initializer, 'Playwright config identifier is not statically resolved', [
        configPath,
        node.text,
      ]);
      return resolveConfigExpression(configPath, initializer, seen);
    }
    assert(
      ts.isObjectLiteralExpression(node),
      'Playwright config object is not statically resolved',
      [configPath],
    );
    let result = { provided: false, value: undefined };
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = resolveConfigExpression(configPath, property.expression, seen);
        if (spread.provided) result = spread;
        continue;
      }
      let name;
      if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) {
        name = property.name.text;
      } else if (
        ts.isComputedPropertyName(property.name) &&
        ts.isStringLiteralLike(unwrapExpression(property.name.expression))
      ) {
        name = unwrapExpression(property.name.expression).text;
      } else if (ts.isComputedPropertyName(property.name)) {
        assert(false, 'Playwright config computed property is not statically resolved', [
          configPath,
        ]);
      }
      if (name !== 'testDir') continue;
      assert(ts.isPropertyAssignment(property), 'Playwright config testDir is not a value', [
        configPath,
      ]);
      const initializer = unwrapExpression(property.initializer);
      assert(
        ts.isStringLiteralLike(initializer),
        'Playwright config testDir is not statically resolved',
        [configPath],
      );
      result = { provided: true, value: initializer.text };
    }
    return result;
  };
  const resolveConfigDefault = (configPath, seen = new Set()) => {
    if (resolvedTestDirectoryValues.has(configPath)) {
      return resolvedTestDirectoryValues.get(configPath);
    }
    assert(!seen.has(configPath), 'Playwright config inheritance cycle', [configPath]);
    const metadata = configMetadata.get(configPath);
    const result = resolveConfigExpression(
      configPath,
      metadata.defaultExport,
      new Set(seen).add(configPath),
    );
    resolvedTestDirectoryValues.set(configPath, result);
    return result;
  };

  const specPaths = new Set();
  for (const configPath of configPaths) {
    const resolvedValue = resolveConfigDefault(configPath);
    const testDirectory = resolvedValue.provided
      ? path.posix.normalize(path.posix.join(path.posix.dirname(configPath), resolvedValue.value))
      : path.posix.dirname(configPath);
    const resolved = safePath(repoRoot, testDirectory, 'Playwright testDir');
    assert(
      existsSync(resolved.absolute) && lstatSync(resolved.absolute).isDirectory(),
      'Playwright testDir is missing or not a directory',
      [configPath, testDirectory],
    );
    for (const sourcePath of repositoryFiles) {
      if (
        (sourcePath.startsWith(`${resolved.normalized}/`) ||
          (resolved.normalized === '.' && !sourcePath.startsWith('../'))) &&
        BROWSER_SPEC_PATTERN.test(sourcePath)
      ) {
        specPaths.add(sourcePath);
      }
    }
  }
  return { configPaths: new Set(configPaths), specPaths, repositoryFiles };
}

function collectBrowserAssetPaths(repoRoot) {
  const paths = new Set();
  for (const sourcePath of walkFiles(repoRoot, ['tools/tests'], [])) paths.add(sourcePath);
  for (const sourcePath of collectBrowserExtendedModulePaths(repoRoot)) paths.add(sourcePath);
  for (const sourcePath of collectBrowserSnapshotPaths(repoRoot)) paths.add(sourcePath);
  for (const sourcePath of collectBrowserHarnessPaths(repoRoot)) paths.add(sourcePath);
  const browserEntrypoints = collectRepositoryBrowserEntrypoints(repoRoot);
  for (const config of browserEntrypoints.configPaths) paths.add(config);
  for (const spec of browserEntrypoints.specPaths) paths.add(spec);
  for (const sourcePath of browserEntrypoints.repositoryFiles) {
    // The freeze manifest contains the word Playwright and cannot content-address itself.
    if (sourcePath === 'tools/authz-account-model-v1/inventory.json') continue;
    const playwrightSpecificTextAsset =
      /\.(?:[cm]?[jt]sx?|md|json|ya?ml|prisma|py|sh|sql)$/i.test(sourcePath) ||
      /(?:^|\/)\.env\.(?:example|sample|template)$/i.test(sourcePath);
    const content = playwrightSpecificTextAsset
      ? readRepoFile(repoRoot, sourcePath, 'Playwright text asset')
      : '';
    if (
      playwrightSpecificTextAsset &&
      (/playwright/i.test(content) ||
        sourceReferencesPlaywrightPackage(sourcePath, content) ||
        sourceContainsDynamicModuleLoader(sourcePath, content))
    ) {
      paths.add(sourcePath);
    }
  }
  for (const config of [
    'package.json',
    'pnpm-lock.yaml',
    '.github/workflows/ci.yml',
    '.agent-loop/GATE_CONFIG.md',
  ]) {
    paths.add(config);
  }
  for (const sourcePath of collectBrowserPackageScriptPaths(repoRoot)) paths.add(sourcePath);

  const visited = new Set();
  const pending = [...paths].filter((sourcePath) => /\.[cm]?[jt]sx?$/.test(sourcePath));
  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (visited.has(sourcePath)) continue;
    visited.add(sourcePath);
    for (const moduleSpecifier of collectBrowserToolModuleSpecifiers(
      sourcePath,
      readRepoFile(repoRoot, sourcePath, 'browser tool dependency'),
    )) {
      const dependencyPath = resolveBrowserToolDependency(repoRoot, sourcePath, moduleSpecifier);
      if (!dependencyPath || paths.has(dependencyPath)) continue;
      paths.add(dependencyPath);
      if (/\.[cm]?[jt]sx?$/.test(dependencyPath)) pending.push(dependencyPath);
    }
  }
  return [...paths].sort();
}

export function discoverBrowserAssets(repoRoot) {
  return collectBrowserAssetPaths(repoRoot).map((sourcePath) => ({
    path: sourcePath,
    sha256: sha256(readRepoBuffer(repoRoot, sourcePath, 'browser asset')),
  }));
}

export function discoverBrowserScenarios(repoRoot) {
  const scenarios = [];
  const specPaths = collectBrowserAssetPaths(repoRoot).filter((sourcePath) =>
    BROWSER_SPEC_PATTERN.test(sourcePath),
  );
  for (const sourcePath of specPaths) {
    const content = readRepoFile(repoRoot, sourcePath, 'browser spec');
    const source = ts.createSourceFile(
      sourcePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      sourceKind(sourcePath),
    );
    const resolveModule = (fromPath, moduleSpecifier) => {
      const base = path.posix.normalize(
        path.posix.join(path.posix.dirname(fromPath), moduleSpecifier),
      );
      const candidates = path.posix.extname(base)
        ? [base]
        : [
            base,
            ...BROWSER_TOOL_SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
            ...BROWSER_TOOL_SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
          ];
      return candidates.find((candidate) => {
        const resolved = safePath(repoRoot, candidate, 'browser scenario import');
        return existsSync(resolved.absolute) && lstatSync(resolved.absolute).isFile();
      });
    };

    const modules = new Map();
    const getModule = (modulePath, providedSource) => {
      if (modules.has(modulePath)) return modules.get(modulePath);
      const moduleSource =
        providedSource ??
        ts.createSourceFile(
          modulePath,
          readRepoFile(repoRoot, modulePath, 'browser scenario import'),
          ts.ScriptTarget.Latest,
          true,
          sourceKind(modulePath),
        );
      const moduleBindings = {
        source: moduleSource,
        constants: new Map(),
        imports: new Map(),
        exports: new Map(),
      };
      modules.set(modulePath, moduleBindings);
      for (const statement of moduleSource.statements) {
        if (ts.isVariableStatement(statement)) {
          const exported = (ts.getModifiers(statement) ?? []).some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
          );
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
            moduleBindings.constants.set(declaration.name.text, declaration.initializer);
            if (exported) {
              moduleBindings.exports.set(declaration.name.text, {
                kind: 'local',
                local: declaration.name.text,
              });
            }
          }
          continue;
        }
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteralLike(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text.startsWith('.') &&
          statement.importClause?.namedBindings &&
          ts.isNamedImports(statement.importClause.namedBindings)
        ) {
          for (const element of statement.importClause.namedBindings.elements) {
            moduleBindings.imports.set(element.name.text, {
              imported: element.propertyName?.text ?? element.name.text,
              moduleSpecifier: statement.moduleSpecifier.text,
            });
          }
          continue;
        }
        if (
          ts.isExportDeclaration(statement) &&
          !statement.isTypeOnly &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause)
        ) {
          const moduleSpecifier =
            statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
              ? statement.moduleSpecifier.text
              : undefined;
          for (const element of statement.exportClause.elements) {
            if (element.isTypeOnly) continue;
            moduleBindings.exports.set(element.name.text, {
              kind: moduleSpecifier ? 'reexport' : 'local',
              local: moduleSpecifier
                ? undefined
                : (element.propertyName?.text ?? element.name.text),
              imported: element.propertyName?.text ?? element.name.text,
              moduleSpecifier,
            });
          }
        }
      }
      return moduleBindings;
    };
    getModule(sourcePath, source);

    const importedValues = new Map();
    const resolveExportedValue = (targetPath, exportedName, seen) => {
      const key = `${targetPath}#${exportedName}`;
      if (seen.has(key)) return undefined;
      if (importedValues.has(key)) return importedValues.get(key);
      const targetModule = getModule(targetPath);
      const binding = targetModule.exports.get(exportedName);
      if (!binding) return undefined;
      const nextSeen = new Set(seen).add(key);
      let value;
      if (binding.kind === 'reexport') {
        const reexportPath = resolveModule(targetPath, binding.moduleSpecifier);
        if (!reexportPath) return undefined;
        value = resolveExportedValue(reexportPath, binding.imported, nextSeen);
      } else if (targetModule.constants.has(binding.local)) {
        value = evaluate(
          targetModule.constants.get(binding.local),
          new Map(),
          nextSeen,
          targetModule.source,
        );
      } else {
        value = resolveImportedValue(binding.local, nextSeen, targetPath);
      }
      if (value !== undefined) importedValues.set(key, value);
      return value;
    };
    const resolveImportedValue = (localName, seen, fromPath = sourcePath) => {
      const fromModule = getModule(fromPath);
      const binding = fromModule.imports.get(localName);
      if (!binding) return undefined;
      const targetPath = resolveModule(fromPath, binding.moduleSpecifier);
      if (!targetPath) return undefined;
      return resolveExportedValue(targetPath, binding.imported, seen);
    };

    const evaluate = (expression, environment, seen = new Set(), expressionSource = source) => {
      let node = expression;
      while (
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isParenthesizedExpression(node) ||
        ts.isNonNullExpression(node)
      ) {
        node = node.expression;
      }
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isNumericLiteral(node)) return Number(node.text);
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (node.kind === ts.SyntaxKind.NullKeyword) return null;
      if (ts.isIdentifier(node)) {
        if (environment.has(node.text)) return environment.get(node.text);
        const expressionPath = expressionSource.fileName;
        const expressionModule = getModule(expressionPath, expressionSource);
        const key = `${expressionPath}#${node.text}`;
        if (seen.has(key)) return undefined;
        const initializer = expressionModule.constants.get(node.text);
        if (initializer) {
          return evaluate(
            initializer,
            environment,
            new Set(seen).add(key),
            expressionModule.source,
          );
        }
        return resolveImportedValue(node.text, seen, expressionPath);
      }
      if (ts.isArrayLiteralExpression(node)) {
        const values = [];
        for (const element of node.elements) {
          if (ts.isSpreadElement(element)) {
            const spread = evaluate(element.expression, environment, seen, expressionSource);
            if (!Array.isArray(spread)) return undefined;
            values.push(...spread);
          } else {
            const value = evaluate(element, environment, seen, expressionSource);
            if (value === undefined) return undefined;
            values.push(value);
          }
        }
        return values;
      }
      if (ts.isObjectLiteralExpression(node)) {
        const value = {};
        for (const property of node.properties) {
          if (ts.isSpreadAssignment(property)) {
            const spread = evaluate(property.expression, environment, seen, expressionSource);
            if (!spread || typeof spread !== 'object' || Array.isArray(spread)) return undefined;
            Object.assign(value, spread);
            continue;
          }
          if (ts.isPropertyAssignment(property)) {
            const name =
              ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
                ? property.name.text
                : undefined;
            if (!name) continue;
            const propertyValue = evaluate(
              property.initializer,
              environment,
              seen,
              expressionSource,
            );
            if (propertyValue !== undefined) value[name] = propertyValue;
          } else if (ts.isShorthandPropertyAssignment(property)) {
            value[property.name.text] = evaluate(
              property.name,
              environment,
              seen,
              expressionSource,
            );
          }
        }
        return value;
      }
      if (ts.isPropertyAccessExpression(node)) {
        const owner = evaluate(node.expression, environment, seen, expressionSource);
        return owner && typeof owner === 'object' ? owner[node.name.text] : undefined;
      }
      if (ts.isElementAccessExpression(node) && node.argumentExpression) {
        const owner = evaluate(node.expression, environment, seen, expressionSource);
        const key = evaluate(node.argumentExpression, environment, seen, expressionSource);
        return owner &&
          typeof owner === 'object' &&
          (typeof key === 'string' || typeof key === 'number')
          ? owner[key]
          : undefined;
      }
      if (ts.isTemplateExpression(node)) {
        let result = node.head.text;
        for (const span of node.templateSpans) {
          const value = evaluate(span.expression, environment, seen, expressionSource);
          if (value === undefined || (typeof value === 'object' && value !== null))
            return undefined;
          result += `${value}${span.literal.text}`;
        }
        return result;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = evaluate(node.left, environment, seen, expressionSource);
        const right = evaluate(node.right, environment, seen, expressionSource);
        return left === undefined || right === undefined ? undefined : left + right;
      }
      if (ts.isCallExpression(node)) {
        if (
          sourcePath === 'tools/tests/ui-design-fidelity.spec.ts' &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'filterScreens' &&
          node.arguments.length > 0
        ) {
          return evaluate(node.arguments[0], environment, seen, expressionSource);
        }
        if (
          sourcePath === 'tools/tests/ui-design-fidelity.spec.ts' &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'filter'
        ) {
          return evaluate(node.expression.expression, environment, seen, expressionSource);
        }
      }
      return undefined;
    };

    const directTestCall = (node) =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^(?:test|it)$/.test(node.expression.text);
    const modifierTestCall = (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      /^(?:test|it)$/.test(node.expression.expression.text) &&
      /^(?:only|skip|fixme|fail)$/.test(node.expression.name.text) &&
      node.arguments.length >= 2 &&
      (ts.isArrowFunction(node.arguments[1]) || ts.isFunctionExpression(node.arguments[1]));
    const eachTestCall = (node) =>
      ts.isCallExpression(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      /^(?:test|it)$/.test(node.expression.expression.expression.text) &&
      node.expression.expression.name.text === 'each';
    const describeCall = (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      /^(?:test|it)$/.test(node.expression.expression.text) &&
      node.expression.name.text === 'describe' &&
      node.arguments.length >= 2 &&
      (ts.isArrowFunction(node.arguments[1]) || ts.isFunctionExpression(node.arguments[1]));

    const containsTestRegistration = (node) => {
      let found = false;
      const inspect = (child) => {
        if (directTestCall(child) || modifierTestCall(child) || eachTestCall(child)) {
          found = true;
          return;
        }
        ts.forEachChild(child, inspect);
      };
      inspect(node);
      return found;
    };

    const visit = (node, environment) => {
      if (ts.isVariableStatement(node)) {
        const next = new Map(environment);
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
          if (
            (ts.isArrowFunction(declaration.initializer) ||
              ts.isFunctionExpression(declaration.initializer)) &&
            containsTestRegistration(declaration.initializer.body)
          ) {
            assert(false, 'browser registration factory is unsupported', [
              `${sourcePath}:${source.getLineAndCharacterOfPosition(declaration.getStart(source)).line + 1}`,
            ]);
          }
          const value = evaluate(declaration.initializer, next);
          if (value !== undefined) next.set(declaration.name.text, value);
        }
        return next;
      }
      if (ts.isFunctionDeclaration(node) && node.body && containsTestRegistration(node.body)) {
        assert(false, 'browser registration factory is unsupported', [
          `${sourcePath}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        ]);
      }
      if (ts.isForOfStatement(node)) {
        if (!containsTestRegistration(node.statement)) return environment;
        const values = evaluate(node.expression, environment);
        assert(
          Array.isArray(values),
          'browser parameterized scenario is not statically enumerable',
          [`${sourcePath}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`],
        );
        const declaration = node.initializer.declarations?.[0];
        assert(
          declaration && ts.isIdentifier(declaration.name),
          'browser parameterized scenario binding is unsupported',
          [sourcePath],
        );
        for (const value of values) {
          walkChildren(node.statement, new Map(environment).set(declaration.name.text, value));
        }
        return environment;
      }
      if (ts.isForStatement(node) && containsTestRegistration(node.statement)) {
        assert(false, 'browser classic-loop scenario registration is unsupported', [
          `${sourcePath}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        ]);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'forEach' &&
        node.arguments.some(
          (argument) =>
            (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
            containsTestRegistration(argument.body),
        )
      ) {
        assert(false, 'browser forEach scenario registration is unsupported', [
          `${sourcePath}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        ]);
      }
      if (eachTestCall(node)) {
        assert(false, 'browser test.each scenario registration is unsupported', [
          `${sourcePath}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        ]);
      }
      if (
        ts.isCallExpression(node) &&
        !describeCall(node) &&
        !directTestCall(node) &&
        !modifierTestCall(node) &&
        node.arguments.some(
          (argument) =>
            (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
            containsTestRegistration(argument.body),
        )
      ) {
        assert(false, 'browser registration callback factory is unsupported', [
          `${sourcePath}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        ]);
      }
      if (directTestCall(node) || modifierTestCall(node)) {
        const title = node.arguments[0] && evaluate(node.arguments[0], environment);
        assert(typeof title === 'string', 'browser scenario title is not statically enumerable', [
          `${sourcePath}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        ]);
        scenarios.push({
          path: sourcePath,
          suite: environment.get('__browser_suite') ?? '',
          title,
          modifier: modifierTestCall(node) ? node.expression.name.text : 'run',
        });
      }
      return environment;
    };
    const walkChildren = (node, environment) => {
      let currentEnvironment = environment;
      if (describeCall(node)) {
        const title = evaluate(node.arguments[0], environment);
        assert(typeof title === 'string', 'browser suite title is not statically enumerable', [
          `${sourcePath}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        ]);
        const parentSuite = environment.get('__browser_suite');
        const suite = parentSuite ? `${parentSuite} > ${title}` : title;
        walkChildren(node.arguments[1].body, new Map(environment).set('__browser_suite', suite));
        return;
      }
      if (ts.isSourceFile(node) || ts.isBlock(node)) {
        for (const statement of node.statements) {
          const result = visit(statement, currentEnvironment);
          if (result !== currentEnvironment) currentEnvironment = result;
          if (!ts.isVariableStatement(statement) && !ts.isForOfStatement(statement)) {
            ts.forEachChild(statement, (child) => walkChildren(child, currentEnvironment));
          }
        }
        return;
      }
      const result = visit(node, currentEnvironment);
      if (ts.isForOfStatement(node) && containsTestRegistration(node.statement)) return;
      if (ts.isForStatement(node) && containsTestRegistration(node.statement)) return;
      ts.forEachChild(node, (child) => walkChildren(child, result));
    };
    walkChildren(source, new Map());
  }
  const sorted = scenarios.sort((left, right) =>
    `${left.path}:${left.suite}:${left.title}:${left.modifier}`.localeCompare(
      `${right.path}:${right.suite}:${right.title}:${right.modifier}`,
    ),
  );
  const duplicate = sorted.find(
    (entry, index) =>
      index > 0 &&
      entry.path === sorted[index - 1].path &&
      entry.suite === sorted[index - 1].suite &&
      entry.title === sorted[index - 1].title &&
      entry.modifier === sorted[index - 1].modifier,
  );
  assert(!duplicate, 'duplicate browser scenario identity', [
    duplicate
      ? `${duplicate.path}:${duplicate.suite}:${duplicate.title}:${duplicate.modifier}`
      : '',
  ]);
  return sorted;
}

export function validateBrowserFreeze(repoRoot, gate) {
  const assets = discoverBrowserAssets(repoRoot);
  const scenarios = discoverBrowserScenarios(repoRoot);
  assert(
    assets.filter((entry) => BROWSER_SPEC_PATTERN.test(entry.path)).length === 29,
    'Playwright spec baseline must remain 29',
  );
  assert(
    assets.filter((entry) => PLAYWRIGHT_CONFIG_PATTERN.test(entry.path)).length === 4,
    'Playwright config baseline must remain 4',
  );
  assert(stableJson(assets) === stableJson(gate.asset_baseline), 'browser asset freeze drift');
  assert(
    stableJson(scenarios) === stableJson(gate.scenario_baseline),
    'browser scenario freeze drift',
  );
  const packageJson = JSON.parse(readRepoFile(repoRoot, 'package.json'));
  assert(
    packageJson.devDependencies?.['@playwright/test'],
    'Playwright dependency removed before cutover',
  );
  assert(
    packageJson.devDependencies?.['@axe-core/playwright'],
    'Playwright accessibility dependency removed before cutover',
  );
}
