import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODE_REGISTRY } from '@/lib/api/error-codes';

const apiRoot = join(process.cwd(), 'src', 'app', 'api');

type RegisteredErrorCode = keyof typeof API_ERROR_CODE_REGISTRY;
type RawErrorHelperName = 'error' | 'externalError' | 'localizedError';

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

type RawNonliteralMessageUsage = {
  filePath: string;
  helper: RawErrorHelperName;
  codeExpression: string;
  messageExpression: string;
  statusExpression: string | null;
};

type RawErrorDetailsUsage = {
  filePath: string;
  helper: RawErrorHelperName;
  codeExpression: string;
  detailsExpression: string;
};

type RawResponseNamespaceImportUsage = {
  filePath: string;
  namespaceName: string;
};

type ErrorHelperBindings = {
  helperNames: Set<string>;
  namespaceNames: Set<string>;
};

type RawErrorUsages = {
  literal: RawLiteralErrorUsage[];
  dynamic: RawDynamicErrorUsage[];
  nonliteralMessage: RawNonliteralMessageUsage[];
  details: RawErrorDetailsUsage[];
  namespaceImports: RawResponseNamespaceImportUsage[];
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

// Reviewed constants and conditional literals stay visible here alongside provider-derived messages.
// Migrations should make this list smaller; new nonliteral messages require an explicit contract review.
const allowedRawNonliteralMessageUsages: RawNonliteralMessageUsage[] = [
  {
    filePath: 'src/app/api/admin/organizations/route.ts',
    helper: 'error',
    codeExpression: "'COGNITO_CREATE_FAILED'",
    messageExpression: 'COGNITO_CREATE_FAILED_MESSAGE',
    statusExpression: '502',
  },
  {
    filePath: 'src/app/api/billing-candidates/export/route.ts',
    helper: 'error',
    codeExpression: "'CLAIMS_EXPORT_SITE_UNRESOLVED'",
    messageExpression:
      "siteResolution.reason === 'missing_site_id' ? 'CLAIMS-XML の薬局拠点を解決できません' : 'CLAIMS-XML は単一薬局拠点の候補だけをエクスポートできます'",
    statusExpression: '422',
  },
  {
    filePath: 'src/app/api/files/[id]/download/route.ts',
    helper: 'error',
    codeExpression: 'cause.code',
    messageExpression: 'cause.message',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/files/complete/route.ts',
    helper: 'error',
    codeExpression: 'cause.code',
    messageExpression: 'cause.message',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/files/presigned-upload/route.ts',
    helper: 'error',
    codeExpression: 'cause.code',
    messageExpression: 'cause.message',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/files/presigned-upload/route.ts',
    helper: 'error',
    codeExpression: 'cause.code',
    messageExpression: 'cause.message',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    helper: 'error',
    codeExpression: "'AMBIGUOUS_ACTIVE_CYCLE'",
    messageExpression:
      "requestedCaseId ? '指定されたケースには受付可能な服薬サイクルが複数あります。サイクルを整理してから再実行してください。' : 'この患者には受付可能なケースが複数あります。case_id を指定してください。'",
    statusExpression: '409',
  },
  {
    filePath: 'src/app/api/patients/medications/bulk-export/route.ts',
    helper: 'error',
    codeExpression: 'cause.code',
    messageExpression: 'cause.message',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/pharmacy-contracts/[id]/documents/route.ts',
    helper: 'error',
    codeExpression: 'cause.code',
    messageExpression: 'cause.message',
    statusExpression: 'cause.status',
  },
  {
    filePath: 'src/app/api/platform/break-glass/route.ts',
    helper: 'error',
    codeExpression: "'BREAK_GLASS_DENIED'",
    messageExpression: 'err.message',
    statusExpression: 'status',
  },
  {
    filePath: 'src/app/api/visit-records/[id]/handoff/extract/route.ts',
    helper: 'error',
    codeExpression: "'extraction_failed'",
    messageExpression: 'VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE',
    statusExpression: '500',
  },
  {
    filePath: 'src/app/api/visit-records/[id]/medication-stock-observations/route.ts',
    helper: 'error',
    codeExpression: 'VISIT_MEDICATION_STOCK_OBSERVATION_DISABLED_CODE',
    messageExpression: 'VISIT_MEDICATION_STOCK_OBSERVATION_DISABLED_MESSAGE',
    statusExpression: '503',
  },
];

const allowedExternalNonliteralMessageUsages: RawNonliteralMessageUsage[] = [
  {
    filePath: 'src/app/api/auth/password/reset/confirm/route.ts',
    helper: 'externalError',
    codeExpression: "'EXTERNAL_PASSWORD_RESET_CONFIRM_FAILED'",
    messageExpression: 'classified.message',
    statusExpression: 'classified.status',
  },
  {
    filePath: 'src/app/api/me/password/route.ts',
    helper: 'externalError',
    codeExpression: "'EXTERNAL_PASSWORD_CHANGE_FAILED'",
    messageExpression:
      "(error as Error).name === 'NotAuthorizedException' ? '現在のパスワードが正しくありません' : 'パスワードの変更に失敗しました'",
    statusExpression: '400',
  },
];

// Existing wire-visible details are debt, not an approved public contract. This baseline must not grow.
const allowedRawErrorDetailsUsages: RawErrorDetailsUsage[] = [
  {
    filePath: 'src/app/api/billing-candidates/close/route.ts',
    helper: 'error',
    codeExpression: "'BILLING_CLOSE_BLOCKED'",
    detailsExpression: '{ summary: result.summary, blockingCount: result.blockingCount, }',
  },
  {
    filePath: 'src/app/api/billing-candidates/close/route.ts',
    helper: 'error',
    codeExpression: "'BILLING_CLOSE_STALE_CANDIDATES'",
    detailsExpression:
      '{ billing_month: parsedBillingMonth.start.toISOString(), billing_domain: billingDomain, conflictCount: 1, }',
  },
  {
    filePath: 'src/app/api/billing-candidates/export/route.ts',
    helper: 'error',
    codeExpression: "'CLAIMS_EXPORT_FAILED'",
    detailsExpression: '{ code: cause.code }',
  },
  {
    filePath: 'src/app/api/billing-candidates/export/route.ts',
    helper: 'error',
    codeExpression: "'CLAIMS_EXPORT_SITE_UNRESOLVED'",
    detailsExpression:
      '{ reason: siteResolution.reason, missing_count: siteResolution.missingCount, site_count: siteResolution.siteCount, }',
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    helper: 'error',
    codeExpression: "'AMBIGUOUS_ACTIVE_CYCLE'",
    detailsExpression: '{ case_ids: Array.from(new Set(cycles.map((cycle) => cycle.case_id))) }',
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    helper: 'error',
    codeExpression: "'EPRESCRIPTION_CASE_CONFLICT'",
    detailsExpression: '{ existing_case_id: existing.cycle.case_id }',
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    helper: 'error',
    codeExpression: "'EPRESCRIPTION_CASE_CONFLICT'",
    detailsExpression: '{ existing_case_id: existingByRequestId.cycle.case_id }',
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    helper: 'error',
    codeExpression: "'EPRESCRIPTION_CASE_CONFLICT'",
    detailsExpression: '{ existing_case_id: replayed.cycle.case_id }',
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    helper: 'error',
    codeExpression: "'EPRESCRIPTION_CONFIGURATION_ERROR'",
    detailsExpression: '{ retriable: false }',
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    helper: 'error',
    codeExpression: "'EPRESCRIPTION_UPSTREAM_FAILURE'",
    detailsExpression: '{ retriable: cause.retriable, upstream_status: cause.status ?? null, }',
  },
  {
    filePath: 'src/app/api/patients/[id]/prescriptions/e-prescription/route.ts',
    helper: 'error',
    codeExpression: "'EPRESCRIPTION_UPSTREAM_UNAUTHORIZED'",
    detailsExpression: '{ retriable: false, upstream_status: cause.status ?? null }',
  },
  {
    filePath: 'src/app/api/visit-records/[id]/handoff/extract/route.ts',
    helper: 'error',
    codeExpression: "'extraction_failed'",
    detailsExpression: "{ extraction: { status: 'failed', retryable: true }, }",
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

function collectErrorHelperBindings(
  sourceFile: ts.SourceFile,
  importedHelperName: RawErrorHelperName,
): ErrorHelperBindings {
  const helperNames = new Set<string>();
  const namespaceNames = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== '@/lib/api/response') continue;

    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaceNames.add(bindings.name.text);
      continue;
    }
    if (!ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === importedHelperName) helperNames.add(element.name.text);
    }
  }

  return { helperNames, namespaceNames };
}

function normalizedExpressionText(sourceFile: ts.SourceFile, node: ts.Node): string {
  return node.getText(sourceFile).replace(/\s+/g, ' ').trim();
}

function findErrorUsages(filePath: string, importedHelperName: RawErrorHelperName): RawErrorUsages {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const bindings = collectErrorHelperBindings(sourceFile, importedHelperName);
  const usages: RawErrorUsages = {
    literal: [],
    dynamic: [],
    nonliteralMessage: [],
    details: [],
    namespaceImports: [...bindings.namespaceNames].map((namespaceName) => ({
      filePath: relative(process.cwd(), filePath),
      namespaceName,
    })),
  };
  if (bindings.helperNames.size === 0) return usages;

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      bindings.helperNames.has(node.expression.text)
    ) {
      const [codeArgument, messageArgument, statusArgument, detailsArgument] = node.arguments;
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
          codeExpression: normalizedExpressionText(sourceFile, codeArgument),
          statusExpression: statusArgument
            ? normalizedExpressionText(sourceFile, statusArgument)
            : null,
        });
      }

      if (codeArgument && messageArgument && !ts.isStringLiteralLike(messageArgument)) {
        usages.nonliteralMessage.push({
          filePath: relative(process.cwd(), filePath),
          helper: importedHelperName,
          codeExpression: normalizedExpressionText(sourceFile, codeArgument),
          messageExpression: normalizedExpressionText(sourceFile, messageArgument),
          statusExpression: statusArgument
            ? normalizedExpressionText(sourceFile, statusArgument)
            : null,
        });
      }

      if (codeArgument && detailsArgument) {
        usages.details.push({
          filePath: relative(process.cwd(), filePath),
          helper: importedHelperName,
          codeExpression: normalizedExpressionText(sourceFile, codeArgument),
          detailsExpression: normalizedExpressionText(sourceFile, detailsArgument),
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
    nonliteralMessage: usages
      .flatMap((usage) => usage.nonliteralMessage)
      .sort((left, right) =>
        `${left.filePath}:${left.helper}:${left.codeExpression}:${left.messageExpression}:${left.statusExpression}`.localeCompare(
          `${right.filePath}:${right.helper}:${right.codeExpression}:${right.messageExpression}:${right.statusExpression}`,
        ),
      ),
    details: usages
      .flatMap((usage) => usage.details)
      .sort((left, right) =>
        `${left.filePath}:${left.helper}:${left.codeExpression}:${left.detailsExpression}`.localeCompare(
          `${right.filePath}:${right.helper}:${right.codeExpression}:${right.detailsExpression}`,
        ),
      ),
    namespaceImports: usages
      .flatMap((usage) => usage.namespaceImports)
      .sort((left, right) =>
        `${left.filePath}:${left.namespaceName}`.localeCompare(
          `${right.filePath}:${right.namespaceName}`,
        ),
      ),
  };
}

describe('raw API error usage', () => {
  it('detects namespace imports that would bypass direct named-helper scanning', () => {
    const sourceFile = ts.createSourceFile(
      'namespace-import-fixture.ts',
      [
        "import * as apiResponse from '@/lib/api/response';",
        "import { error as rawError } from '@/lib/api/response';",
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );

    const bindings = collectErrorHelperBindings(sourceFile, 'error');

    expect([...bindings.helperNames]).toEqual(['rawError']);
    expect([...bindings.namespaceNames]).toEqual(['apiResponse']);
  });

  it('keeps direct localized raw-error bypasses at zero', () => {
    expect(collectSortedErrorUsages('localizedError')).toEqual({
      literal: [],
      dynamic: [],
      nonliteralMessage: [],
      details: [],
      namespaceImports: [],
    });
  });

  it('keeps code, message, and details debt exact with one registered 422 bypass', () => {
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
    expect(rawUsages.nonliteralMessage).toEqual(allowedRawNonliteralMessageUsages);
    expect(rawUsages.details).toEqual(allowedRawErrorDetailsUsages);
    expect(rawUsages.namespaceImports).toEqual([]);
    expect(externalUsages.literal).toEqual(allowedExternalLiteralErrorUsages);
    expect(externalUsages.dynamic).toEqual([]);
    expect(externalUsages.nonliteralMessage).toEqual(allowedExternalNonliteralMessageUsages);
    expect(externalUsages.details).toEqual([]);
    expect(externalUsages.namespaceImports).toEqual([]);
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
