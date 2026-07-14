import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODE_REGISTRY } from '@/lib/api/error-codes';

const apiRoot = join(process.cwd(), 'src', 'app', 'api');

type RegisteredErrorCode = keyof typeof API_ERROR_CODE_REGISTRY;

type RawRegisteredErrorUsage = {
  filePath: string;
  code: RegisteredErrorCode;
  httpStatus: number | null;
  canonicalHttpStatus: number;
};

const allowedRawRegisteredErrorUsages: RawRegisteredErrorUsage[] = [
  {
    filePath: 'src/app/api/dispense-audits/route.ts',
    code: 'VALIDATION_ERROR',
    httpStatus: 422,
    canonicalHttpStatus: 400,
  },
];

function collectRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) return collectRouteFiles(fullPath);
    return entry === 'route.ts' ? [fullPath] : [];
  });
}

function isRegisteredErrorCode(code: string): code is RegisteredErrorCode {
  return Object.prototype.hasOwnProperty.call(API_ERROR_CODE_REGISTRY, code);
}

function collectErrorHelperNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== '@/lib/api/response') continue;

    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === 'error') names.add(element.name.text);
    }
  }

  return names;
}

function findRawRegisteredErrorUsages(filePath: string): RawRegisteredErrorUsage[] {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const errorHelperNames = collectErrorHelperNames(sourceFile);
  if (errorHelperNames.size === 0) return [];

  const usages: RawRegisteredErrorUsage[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      errorHelperNames.has(node.expression.text)
    ) {
      const [codeArgument, , statusArgument] = node.arguments;
      if (
        codeArgument &&
        ts.isStringLiteralLike(codeArgument) &&
        isRegisteredErrorCode(codeArgument.text)
      ) {
        usages.push({
          filePath: relative(process.cwd(), filePath),
          code: codeArgument.text,
          httpStatus:
            statusArgument && ts.isNumericLiteral(statusArgument)
              ? Number(statusArgument.text)
              : null,
          canonicalHttpStatus: API_ERROR_CODE_REGISTRY[codeArgument.text].httpStatus,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return usages;
}

describe('registered API error usage', () => {
  it('keeps literal registered codes on registeredError except the exact 422 compatibility branch', () => {
    const usages = collectRouteFiles(apiRoot)
      .flatMap(findRawRegisteredErrorUsages)
      .sort((left, right) =>
        `${left.filePath}:${left.code}`.localeCompare(`${right.filePath}:${right.code}`),
      );

    expect(usages).toEqual(allowedRawRegisteredErrorUsages);
    expect(usages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          httpStatus: 422,
          canonicalHttpStatus: 400,
        }),
      ]),
    );
  });
});
