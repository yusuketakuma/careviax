import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { UserRole } from '../../src/phos/contracts/phos_contracts';
import { buildPhosApiGatewayLambdaTemplate } from '../../src/phos/infra/api-gateway-lambda-template';
import { PHOS_API_ROUTES } from '../../src/phos/infra/api-gateway-routes';
import { normalizePositiveTimeoutMs } from '../../src/lib/utils/timeout';
import { verifyCognitoPreTokenGenerationLiveProof } from './verify-phos-cognito-token-trigger';
import { getScriptCognitoClient } from './cognito-client';

type CheckStatus = 'passed' | 'failed' | 'missing' | 'skipped';

type ReadinessCheck = {
  name: string;
  status: CheckStatus;
  detail: string;
};

export type PhosBackendLiveReadinessReport = {
  ok: boolean;
  generated_at: string;
  strict: boolean;
  checks: ReadinessCheck[];
  missing_inputs: string[];
  next_actions: string[];
};

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

const DEFAULT_API_SMOKE_TIMEOUT_MS = 10_000;
const MAX_API_SMOKE_TIMEOUT_MS = 60_000;

const REQUIRED_COGNITO_ENV = [
  'AWS_REGION',
  'PHOS_COGNITO_USER_POOL_ID',
  'PHOS_COGNITO_PRE_TOKEN_GENERATION_FUNCTION_ARN',
] as const;

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

function readEnv(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function readApiSmokeTimeoutMs(env: Env): number {
  return normalizePositiveTimeoutMs(env.PHOS_BACKEND_LIVE_SMOKE_TIMEOUT_MS, {
    fallbackMs: DEFAULT_API_SMOKE_TIMEOUT_MS,
    maxMs: MAX_API_SMOKE_TIMEOUT_MS,
  });
}

function maybeUnrefTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
}

export function createApiSmokeAbort(timeoutMs: number) {
  const controller = new AbortController();
  let timed_out = false;
  const timeout = setTimeout(() => {
    timed_out = true;
    controller.abort(new Error('PHOS_BACKEND_LIVE_SMOKE_TIMEOUT'));
  }, timeoutMs);
  maybeUnrefTimeout(timeout);
  return {
    signal: controller.signal,
    didTimeout: () => timed_out,
    clear: () => clearTimeout(timeout),
  };
}

async function fetchApiSmokeWithTimeout(input: {
  fetchImpl: FetchLike;
  smokeUrl: URL;
  accessToken: string;
  timeoutMs: number;
}): Promise<{ response?: Response; timed_out: boolean }> {
  const abort = createApiSmokeAbort(input.timeoutMs);

  try {
    const response = await input.fetchImpl(input.smokeUrl, {
      credentials: 'omit',
      headers: { Authorization: `Bearer ${input.accessToken}` },
      redirect: 'error',
      signal: abort.signal,
    });
    return { response, timed_out: false };
  } catch (error) {
    if (abort.didTimeout()) return { timed_out: true };
    throw error;
  } finally {
    abort.clear();
  }
}

function buildApiSmokeUrl(apiBaseUrl: string): URL | Error {
  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    return new Error('PHOS_API_BASE_URL must be an absolute http(s) URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return new Error('PHOS_API_BASE_URL must use http(s).');
  }
  const localHttpHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (url.protocol === 'http:' && !localHttpHosts.has(url.hostname)) {
    return new Error('PHOS_API_BASE_URL must use https outside local development.');
  }
  if (url.username || url.password || url.search || url.hash) {
    return new Error('PHOS_API_BASE_URL must not include credentials, query, or fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/cards`;
  return url;
}

function getMissingEnv(env: Env, names: readonly string[]) {
  return names.filter((name) => !readEnv(env, name));
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  if (!payload) {
    throw new Error('token is not a JWT');
  }
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
}

function normalizeScopeClaim(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
  }
  return [];
}

function readTokenScopes(payload: Record<string, unknown>): string[] {
  return [...new Set([...normalizeScopeClaim(payload.scope), ...normalizeScopeClaim(payload.scp)])];
}

function requiredReadinessScopes(): string[] {
  const smokeRoute = PHOS_API_ROUTES.find((route) => route.route_key === 'GET /cards');
  if (!smokeRoute) throw new Error('PH-OS readiness smoke route is not registered: GET /cards');
  return [...smokeRoute.required_scopes];
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && Object.values(UserRole).includes(value as UserRole);
}

function hasAudience(payload: Record<string, unknown>, expected: string): boolean {
  const aud = payload.aud;
  const clientId = payload.client_id;
  if (typeof aud === 'string' && aud === expected) return true;
  if (Array.isArray(aud) && aud.includes(expected)) return true;
  return typeof clientId === 'string' && clientId === expected;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNested(value: unknown, keys: string[]): unknown {
  return keys.reduce<unknown>((current, key) => {
    if (Array.isArray(current)) {
      const index = Number(key);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    return asRecord(current)[key];
  }, value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function hasProperty(value: unknown, key: string): boolean {
  return !!value && typeof value === 'object' && key in value;
}

export function evaluateAccessTokenReadiness(
  token: string,
  expected: { now?: Date; issuer?: string; audience?: string } = {},
): ReadinessCheck {
  try {
    const payload = decodeJwtPayload(token);
    const missing = ['tenant_id', 'role', 'sub'].filter((claim) => {
      const value = payload[claim];
      return typeof value !== 'string' || !value.trim();
    });
    if (!isUserRole(payload.role)) {
      missing.push('valid role');
    }
    const scopes = readTokenScopes(payload);
    const missingScopes = requiredReadinessScopes().filter((scope) => !scopes.includes(scope));
    if (scopes.length === 0) {
      missing.push('scope|scp');
    } else if (missingScopes.length > 0) {
      missing.push(`scope includes ${missingScopes.join(' ')}`);
    }
    if (payload.token_use !== 'access') {
      missing.push('token_use=access');
    }
    if (expected.issuer && payload.iss !== expected.issuer) {
      missing.push('iss');
    }
    if (expected.audience && !hasAudience(payload, expected.audience)) {
      missing.push('aud|client_id');
    }
    const nowSeconds = Math.floor((expected.now ?? new Date()).getTime() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
      missing.push('valid exp');
    }
    if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) {
      missing.push('valid nbf');
    }
    if (typeof payload.iat === 'number' && payload.iat > nowSeconds + 300) {
      missing.push('valid iat');
    }
    if (missing.length > 0) {
      return {
        name: 'access_token_claims',
        status: 'failed',
        detail: `JWT does not satisfy required PH-OS access-token proof: ${missing.join(', ')}`,
      };
    }
    return {
      name: 'access_token_claims',
      status: 'passed',
      detail: 'JWT includes tenant_id, role, sub, and scope/scp claims.',
    };
  } catch (error) {
    return {
      name: 'access_token_claims',
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function evaluateLocalTemplateReadiness(): ReadinessCheck {
  const template = buildPhosApiGatewayLambdaTemplate();
  const resources = template.Resources;
  const failures: string[] = [];
  const stageProperties = asRecord(resources.PhosHttpApiStage?.Properties);
  const defaultRouteSettings = asRecord(stageProperties.DefaultRouteSettings);
  const accessLogSettings = asRecord(stageProperties.AccessLogSettings);
  const accessLogFormat = asString(accessLogSettings.Format);

  if (resources.PhosHttpApi?.Type !== 'AWS::ApiGatewayV2::Api') {
    failures.push('PhosHttpApi HTTP API resource');
  }
  if (resources.PhosJwtAuthorizer?.Type !== 'AWS::ApiGatewayV2::Authorizer') {
    failures.push('PhosJwtAuthorizer JWT authorizer resource');
  }
  if (resources.PhosRestApi || resources.PhosRestApiStage) {
    failures.push('HTTP API/JWT canonical template without REST API stage resources');
  }
  if (resources.PhosHttpApiStage?.Type !== 'AWS::ApiGatewayV2::Stage') {
    failures.push('PhosHttpApiStage HTTP API stage resource');
  }
  if (stageProperties.AutoDeploy !== true) {
    failures.push('HTTP API stage auto deploy');
  }
  if (
    stageProperties.TracingEnabled !== undefined ||
    hasProperty(stageProperties, 'MethodSettings')
  ) {
    failures.push('HTTP API stage avoids unsupported REST-only tracing/execution-log properties');
  }
  if (defaultRouteSettings.DetailedMetricsEnabled !== true) {
    failures.push('HTTP API detailed metrics');
  }
  if (
    !accessLogFormat.includes('"request_id":"$context.requestId"') ||
    !accessLogFormat.includes('"tenant_id":"$context.authorizer.claims.tenant_id"') ||
    !accessLogFormat.includes('"user_id":"$context.authorizer.claims.sub"') ||
    !accessLogFormat.includes('"route_key":"$context.routeKey"') ||
    !accessLogFormat.includes('"integration_error":"$context.integrationErrorMessage"') ||
    accessLogFormat.includes('"requestId"') ||
    accessLogFormat.includes('"routeKey"') ||
    accessLogFormat.includes('"integrationError"') ||
    !accessLogFormat.includes('$context.requestId') ||
    !accessLogFormat.includes('$context.authorizer.claims.tenant_id') ||
    !accessLogFormat.includes('$context.authorizer.claims.sub') ||
    !accessLogFormat.includes('$context.routeKey') ||
    /patient|patient_name|drug|medication|report_body|photo|sha256|file_name/i.test(accessLogFormat)
  ) {
    failures.push('PHI-minimized HTTP API access log format');
  }
  if (!resources.PhosCognitoPreTokenGenerationFunction) {
    failures.push('Cognito Pre Token Generation Lambda');
  }
  if (!template.Outputs?.PhosCognitoPreTokenGenerationFunctionArn) {
    failures.push('Cognito trigger function ARN output');
  }
  if (
    readNested(resources.PhosCoreDynamoDbTable?.Properties, ['SSESpecification', 'SSEType']) !==
      'KMS' ||
    readNested(resources.PhosSecurityEventTable?.Properties, ['SSESpecification', 'SSEType']) !==
      'KMS'
  ) {
    failures.push('DynamoDB SSE-KMS tables');
  }
  if (
    readNested(resources.PhosEvidenceBucket?.Properties, [
      'BucketEncryption',
      'ServerSideEncryptionConfiguration',
      '0',
      'ServerSideEncryptionByDefault',
      'SSEAlgorithm',
    ]) !== 'aws:kms'
  ) {
    failures.push('evidence bucket SSE-KMS default');
  }
  if (resources.PhosApiAccessLogGroup?.Properties?.RetentionInDays !== 365) {
    failures.push('HTTP API access log 365 day retention');
  }
  for (const [logicalId, resource] of Object.entries(resources)) {
    if (
      resource.Type === 'AWS::Lambda::Function' &&
      readNested(resource.Properties, ['TracingConfig', 'Mode']) !== 'Active'
    ) {
      failures.push(`${logicalId} Lambda active tracing`);
    }
  }

  return failures.length > 0
    ? {
        name: 'local_template_contract',
        status: 'failed',
        detail: `Missing or invalid local deployment contract: ${failures.join(', ')}`,
      }
    : {
        name: 'local_template_contract',
        status: 'passed',
        detail:
          'Template emits canonical HTTP API/JWT authorizer, PHI-minimized access logs, Lambda active tracing, Cognito trigger output, Dynamo/S3 SSE-KMS, and 365 day access-log retention.',
      };
}

export function evaluateLegacyNextApiBoundaryReadiness(env: Env): ReadinessCheck {
  const isProduction =
    readEnv(env, 'APP_ENV') === 'production' ||
    readEnv(env, 'NEXT_PUBLIC_APP_ENV') === 'production' ||
    readEnv(env, 'NODE_ENV') === 'production';

  if (isProduction && isTruthyEnv(env.PHOS_ENABLE_LEGACY_FILE_API)) {
    return {
      name: 'legacy_next_file_api_boundary',
      status: 'failed',
      detail:
        'PHOS_ENABLE_LEGACY_FILE_API must not be true for PH-OS production; legacy /api/files/* must stay disabled beside API Gateway /evidence/presign-upload.',
    };
  }

  return {
    name: 'legacy_next_file_api_boundary',
    status: 'passed',
    detail:
      'Legacy Next.js /api/files/* cannot be explicitly enabled for PH-OS production readiness.',
  };
}

export async function buildPhosBackendLiveReadinessReport(
  input: {
    env?: Env;
    strict?: boolean;
    now?: Date;
    fetch?: FetchLike;
  } = {},
): Promise<PhosBackendLiveReadinessReport> {
  const env = input.env ?? process.env;
  const checks: ReadinessCheck[] = [
    evaluateLocalTemplateReadiness(),
    evaluateLegacyNextApiBoundaryReadiness(env),
  ];
  const missingInputs = new Set<string>();
  const missingCognitoEnv = getMissingEnv(env, REQUIRED_COGNITO_ENV);

  for (const name of missingCognitoEnv) {
    missingInputs.add(name);
  }
  const jwtIssuer = readEnv(env, 'PHOS_JWT_ISSUER');
  const jwtAudience = readEnv(env, 'PHOS_JWT_AUDIENCE');
  if (!jwtIssuer) missingInputs.add('PHOS_JWT_ISSUER');
  if (!jwtAudience) missingInputs.add('PHOS_JWT_AUDIENCE');

  if (missingCognitoEnv.length > 0) {
    checks.push({
      name: 'cognito_trigger_live_attachment',
      status: 'missing',
      detail: `Set ${missingCognitoEnv.join(', ')} to verify the deployed Cognito User Pool trigger attachment.`,
    });
  } else {
    try {
      const proof = await verifyCognitoPreTokenGenerationLiveProof({
        user_pool_id: readEnv(env, 'PHOS_COGNITO_USER_POOL_ID') ?? '',
        expected_lambda_arn: readEnv(env, 'PHOS_COGNITO_PRE_TOKEN_GENERATION_FUNCTION_ARN') ?? '',
        client: getScriptCognitoClient(readEnv(env, 'AWS_REGION') ?? ''),
      });
      checks.push({
        name: 'cognito_trigger_live_attachment',
        status: 'passed',
        detail: `User Pool ${proof.user_pool_id} uses ${proof.lambda_version} trigger ${proof.pre_token_generation_lambda_arn}.`,
      });
    } catch (error) {
      checks.push({
        name: 'cognito_trigger_live_attachment',
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const accessToken = readEnv(env, 'PHOS_COGNITO_ACCESS_TOKEN');
  if (accessToken) {
    checks.push(
      evaluateAccessTokenReadiness(accessToken, {
        now: input.now,
        issuer: jwtIssuer ?? undefined,
        audience: jwtAudience ?? undefined,
      }),
    );
  } else {
    missingInputs.add('PHOS_COGNITO_ACCESS_TOKEN');
    checks.push({
      name: 'access_token_claims',
      status: 'missing',
      detail:
        'Set PHOS_COGNITO_ACCESS_TOKEN to prove tenant_id, role, sub, and scope/scp are in the access token.',
    });
  }

  const apiBaseUrl = readEnv(env, 'PHOS_API_BASE_URL');
  if (!apiBaseUrl || !accessToken) {
    if (!apiBaseUrl) {
      missingInputs.add('PHOS_API_BASE_URL');
    }
    checks.push({
      name: 'api_gateway_lambda_smoke',
      status: 'missing',
      detail:
        'Set PHOS_API_BASE_URL and PHOS_COGNITO_ACCESS_TOKEN to run a read-only GET /cards smoke request.',
    });
  } else {
    const smokeUrl = buildApiSmokeUrl(apiBaseUrl);
    if (smokeUrl instanceof Error) {
      checks.push({
        name: 'api_gateway_lambda_smoke',
        status: 'failed',
        detail: smokeUrl.message,
      });
    } else {
      const smokeTimeoutMs = readApiSmokeTimeoutMs(env);
      try {
        const result = await fetchApiSmokeWithTimeout({
          fetchImpl: input.fetch ?? fetch,
          smokeUrl,
          accessToken,
          timeoutMs: smokeTimeoutMs,
        });
        if (result.timed_out) {
          checks.push({
            name: 'api_gateway_lambda_smoke',
            status: 'failed',
            detail: `GET /cards request timed out after ${smokeTimeoutMs} ms.`,
          });
          return buildReport({ checks, missingInputs, strict: input.strict, now: input.now });
        }
        const response = result.response;
        if (!response) throw new Error('GET /cards request returned no response.');
        checks.push({
          name: 'api_gateway_lambda_smoke',
          status: response.status >= 200 && response.status < 300 ? 'passed' : 'failed',
          detail: `GET /cards returned HTTP ${response.status}.`,
        });
      } catch (error) {
        checks.push({
          name: 'api_gateway_lambda_smoke',
          status: 'failed',
          detail: `GET /cards request failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }
  }

  const strict = input.strict ?? false;
  return buildReport({ checks, missingInputs, strict, now: input.now });
}

function buildReport(input: {
  checks: ReadinessCheck[];
  missingInputs: Set<string>;
  strict: boolean | undefined;
  now: Date | undefined;
}): PhosBackendLiveReadinessReport {
  const strict = input.strict ?? false;
  const ok = input.checks.every(
    (check) => check.status === 'passed' || (!strict && check.status === 'missing'),
  );
  const nextActions = Array.from(input.missingInputs).map(
    (name) => `Set ${name} for live PH-OS backend proof.`,
  );

  return {
    ok,
    generated_at: (input.now ?? new Date()).toISOString(),
    strict,
    checks: input.checks,
    missing_inputs: Array.from(input.missingInputs).sort(),
    next_actions: nextActions.sort(),
  };
}

async function main() {
  const strict = process.argv.includes('--strict');
  const report = await buildPhosBackendLiveReadinessReport({ strict });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
