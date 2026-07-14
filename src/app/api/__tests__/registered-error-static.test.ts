import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODE_REGISTRY } from '@/lib/api/error-codes';

const apiRoot = join(process.cwd(), 'src', 'app', 'api');

type RegisteredErrorCode = keyof typeof API_ERROR_CODE_REGISTRY;
type RawErrorHelperName = 'error' | 'externalError';

type RawLiteralErrorUsage = {
  filePath: string;
  code: string;
  httpStatus: number | null;
};

type RawDynamicErrorUsage = {
  filePath: string;
  codeExpression: string;
  statusExpression: string | null;
};

type RawErrorUsages = {
  literal: RawLiteralErrorUsage[];
  dynamic: RawDynamicErrorUsage[];
};

type RawRegisteredErrorUsage = RawLiteralErrorUsage & {
  code: RegisteredErrorCode;
  canonicalHttpStatus: number;
};

// High-risk route migrations stay incremental; this exact baseline must not grow.
const allowedRawLiteralErrorUsages: RawLiteralErrorUsage[] = [
  {
    filePath: 'src/app/api/admin/organizations/route.ts',
    code: 'COGNITO_CREATE_FAILED',
    httpStatus: 502,
  },
  {
    filePath: 'src/app/api/admin/organizations/route.ts',
    code: 'ORGANIZATION_PROVISIONING_FAILED',
    httpStatus: 500,
  },
  {
    filePath: 'src/app/api/admin/organizations/route.ts',
    code: 'ORGANIZATION_PROVISIONING_PARTIAL_FAILURE',
    httpStatus: 500,
  },
  {
    filePath: 'src/app/api/admin/organizations/route.ts',
    code: 'ORGANIZATION_PROVISIONING_PARTIAL_FAILURE',
    httpStatus: 500,
  },
  {
    filePath: 'src/app/api/admin/webhooks/route.ts',
    code: 'WEBHOOK_SECRET_ENCRYPTION_UNAVAILABLE',
    httpStatus: 503,
  },
  {
    filePath: 'src/app/api/billing-candidates/close/route.ts',
    code: 'BILLING_CLOSE_BLOCKED',
    httpStatus: 409,
  },
  {
    filePath: 'src/app/api/billing-candidates/close/route.ts',
    code: 'BILLING_CLOSE_STALE_CANDIDATES',
    httpStatus: 409,
  },
  {
    filePath: 'src/app/api/billing-candidates/export/route.ts',
    code: 'CLAIMS_EXPORT_FAILED',
    httpStatus: null,
  },
  {
    filePath: 'src/app/api/billing-candidates/export/route.ts',
    code: 'CLAIMS_EXPORT_SITE_UNRESOLVED',
    httpStatus: 422,
  },
  {
    filePath: 'src/app/api/care-reports/[id]/send/route.ts',
    code: 'IDEMPOTENCY_CONFLICT',
    httpStatus: 409,
  },
  {
    filePath: 'src/app/api/care-reports/[id]/send/route.ts',
    code: 'IDEMPOTENCY_CONFLICT',
    httpStatus: 409,
  },
  {
    filePath: 'src/app/api/dispense-audits/route.ts',
    code: 'VALIDATION_ERROR',
    httpStatus: 422,
  },
  {
    filePath: 'src/app/api/external-access/[token]/self-report/route.ts',
    code: 'EXTERNAL_ACCESS_SELF_REPORT_SCOPE_DENIED',
    httpStatus: 403,
  },
  {
    filePath: 'src/app/api/external-access/[token]/self-report/route.ts',
    code: 'IDEMPOTENCY_CONFLICT',
    httpStatus: 409,
  },
  {
    filePath: 'src/app/api/external-access/route.ts',
    code: 'EXTERNAL_ACCESS_OTP_DELIVERY_AUDIT_FAILED',
    httpStatus: 500,
  },
  {
    filePath: 'src/app/api/external-access/route.ts',
    code: 'EXTERNAL_ACCESS_SECRET_MISSING',
    httpStatus: 500,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'AMBIGUOUS_ACTIVE_CYCLE',
    httpStatus: 409,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'CASE_NOT_ACCESSIBLE',
    httpStatus: 422,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'CONFLICT',
    httpStatus: 409,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'EPRESCRIPTION_CASE_CONFLICT',
    httpStatus: 409,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'EPRESCRIPTION_CASE_CONFLICT',
    httpStatus: 409,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'EPRESCRIPTION_CASE_CONFLICT',
    httpStatus: 409,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'EPRESCRIPTION_CONFIGURATION_ERROR',
    httpStatus: 503,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'EPRESCRIPTION_NOT_ENABLED',
    httpStatus: 501,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'EPRESCRIPTION_UPSTREAM_FAILURE',
    httpStatus: null,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'EPRESCRIPTION_UPSTREAM_UNAUTHORIZED',
    httpStatus: 502,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'NO_ACCESSIBLE_CASE',
    httpStatus: 422,
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    code: 'NO_ACTIVE_CYCLE',
    httpStatus: 422,
  },
  {
    filePath: 'src/app/api/platform/break-glass/route.ts',
    code: 'BREAK_GLASS_DENIED',
    httpStatus: null,
  },
  {
    filePath: 'src/app/api/platform/break-glass/route.ts',
    code: 'BREAK_GLASS_REAUTH_FAILED',
    httpStatus: 401,
  },
  {
    filePath: 'src/app/api/visit-records/[id]/handoff/extract/route.ts',
    code: 'extraction_failed',
    httpStatus: 500,
  },
  {
    filePath: 'src/app/api/visit-records/[id]/handoff/extract/route.ts',
    code: 'no_structured_soap',
    httpStatus: 422,
  },
  {
    filePath: 'src/app/api/visit-records/[id]/handoff/route.ts',
    code: 'internal_error',
    httpStatus: 500,
  },
  {
    filePath: 'src/app/api/visit-records/[id]/handoff/supervision-confirm/route.ts',
    code: 'internal_error',
    httpStatus: 500,
  },
  {
    filePath: 'src/app/api/visit-records/[id]/handoff/supervision-request/route.ts',
    code: 'internal_error',
    httpStatus: 500,
  },
  {
    filePath: 'src/app/api/visit-records/[id]/medication-stock-observations/route.ts',
    code: 'MEDICATION_STOCK_OBSERVATION_UNAVAILABLE',
    httpStatus: 503,
  },
];

const allowedExternalLiteralErrorUsages: RawLiteralErrorUsage[] = [
  {
    filePath: 'src/app/api/auth/mfa/recovery/route.ts',
    code: 'EXTERNAL_MFA_RECOVERY_FAILED',
    httpStatus: 502,
  },
  {
    filePath: 'src/app/api/auth/mfa/recovery/route.ts',
    code: 'EXTERNAL_MFA_RECOVERY_FAILED',
    httpStatus: 503,
  },
  {
    filePath: 'src/app/api/auth/password/reset/confirm/route.ts',
    code: 'EXTERNAL_PASSWORD_RESET_CONFIRM_FAILED',
    httpStatus: null,
  },
  {
    filePath: 'src/app/api/auth/password/reset/request/route.ts',
    code: 'EXTERNAL_PASSWORD_RESET_REQUEST_FAILED',
    httpStatus: 502,
  },
  {
    filePath: 'src/app/api/me/logout-all/route.ts',
    code: 'EXTERNAL_GLOBAL_SIGNOUT_FAILED',
    httpStatus: 502,
  },
  {
    filePath: 'src/app/api/me/mfa/disable/route.ts',
    code: 'EXTERNAL_MFA_DISABLE_FAILED',
    httpStatus: 400,
  },
  {
    filePath: 'src/app/api/me/mfa/setup/route.ts',
    code: 'EXTERNAL_MFA_SETUP_FAILED',
    httpStatus: 400,
  },
  {
    filePath: 'src/app/api/me/mfa/verify/route.ts',
    code: 'AUTH_USER_NOT_FOUND',
    httpStatus: 404,
  },
  {
    filePath: 'src/app/api/me/mfa/verify/route.ts',
    code: 'EXTERNAL_MFA_VERIFY_FAILED',
    httpStatus: 400,
  },
  {
    filePath: 'src/app/api/me/password/route.ts',
    code: 'EXTERNAL_PASSWORD_CHANGE_FAILED',
    httpStatus: 400,
  },
  {
    filePath: 'src/app/api/me/profile/route.ts',
    code: 'EXTERNAL_COGNITO_UPDATE_FAILED',
    httpStatus: 502,
  },
];

const allowedRawDynamicErrorUsages: RawDynamicErrorUsage[] = [
  {
    filePath: 'src/app/api/files/[id]/download/route.ts',
    codeExpression: 'cause.code',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/files/complete/route.ts',
    codeExpression: 'cause.code',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/files/presigned-upload/route.ts',
    codeExpression: 'cause.code',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/files/presigned-upload/route.ts',
    codeExpression: 'cause.code',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/patients/medications/bulk-export/route.ts',
    codeExpression: 'cause.code',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/pharmacy-contracts/[id]/documents/route.ts',
    codeExpression: 'cause.code',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/visit-records/[id]/medication-stock-observations/route.ts',
    codeExpression: 'VISIT_MEDICATION_STOCK_OBSERVATION_DISABLED_CODE',
    statusExpression: '503',
  },
];

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

function collectErrorHelperNames(
  sourceFile: ts.SourceFile,
  importedHelperName: RawErrorHelperName,
): Set<string> {
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== '@/lib/api/response') continue;

    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === importedHelperName) names.add(element.name.text);
    }
  }

  return names;
}

function findErrorUsages(filePath: string, importedHelperName: RawErrorHelperName): RawErrorUsages {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const errorHelperNames = collectErrorHelperNames(sourceFile, importedHelperName);
  if (errorHelperNames.size === 0) return { literal: [], dynamic: [] };

  const usages: RawErrorUsages = { literal: [], dynamic: [] };

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      errorHelperNames.has(node.expression.text)
    ) {
      const [codeArgument, , statusArgument] = node.arguments;
      if (codeArgument && ts.isStringLiteralLike(codeArgument)) {
        usages.literal.push({
          filePath: relative(process.cwd(), filePath),
          code: codeArgument.text,
          httpStatus:
            statusArgument && ts.isNumericLiteral(statusArgument)
              ? Number(statusArgument.text)
              : null,
        });
      } else if (codeArgument) {
        usages.dynamic.push({
          filePath: relative(process.cwd(), filePath),
          codeExpression: codeArgument.getText(sourceFile),
          statusExpression: statusArgument?.getText(sourceFile) ?? null,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return usages;
}

function collectSortedErrorUsages(importedHelperName: RawErrorHelperName): RawErrorUsages {
  const usages = collectRouteFiles(apiRoot).map((filePath) =>
    findErrorUsages(filePath, importedHelperName),
  );

  return {
    literal: usages
      .flatMap((usage) => usage.literal)
      .sort((left, right) =>
        `${left.filePath}:${left.code}:${left.httpStatus}`.localeCompare(
          `${right.filePath}:${right.code}:${right.httpStatus}`,
        ),
      ),
    dynamic: usages
      .flatMap((usage) => usage.dynamic)
      .sort((left, right) =>
        `${left.filePath}:${left.codeExpression}:${left.statusExpression}`.localeCompare(
          `${right.filePath}:${right.codeExpression}:${right.statusExpression}`,
        ),
      ),
  };
}

describe('raw API error usage', () => {
  it('keeps literal and dynamic helper debt exact and registered bypasses on the one 422 branch', () => {
    const rawUsages = collectSortedErrorUsages('error');
    const externalUsages = collectSortedErrorUsages('externalError');
    const registeredRawUsages = rawUsages.literal.flatMap((usage): RawRegisteredErrorUsage[] =>
      isRegisteredErrorCode(usage.code)
        ? [
            {
              ...usage,
              code: usage.code,
              canonicalHttpStatus: API_ERROR_CODE_REGISTRY[usage.code].httpStatus,
            },
          ]
        : [],
    );
    const registeredExternalUsages = externalUsages.literal.filter((usage) =>
      isRegisteredErrorCode(usage.code),
    );

    expect(rawUsages.literal).toEqual(allowedRawLiteralErrorUsages);
    expect(rawUsages.dynamic).toEqual(allowedRawDynamicErrorUsages);
    expect(externalUsages.literal).toEqual(allowedExternalLiteralErrorUsages);
    expect(externalUsages.dynamic).toEqual([]);
    expect(registeredRawUsages).toEqual(allowedRawRegisteredErrorUsages);
    expect(registeredExternalUsages).toEqual([]);
    expect(registeredRawUsages).toEqual(
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
