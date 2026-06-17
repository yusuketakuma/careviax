import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import process from 'node:process';
import { parse } from 'dotenv';

type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

type Check = {
  name: string;
  status: CheckStatus;
  message: string;
  remediation?: string;
};

export type LightsailRuntimeEnvValidationReport = {
  generatedAt: string;
  envFile: string;
  summary: Record<CheckStatus, number>;
  checks: Check[];
};

type CliArgs = {
  envFile: string;
  strict: boolean;
  json: boolean;
};

const DEFAULT_ENV_FILE = '.env.production.aws';
const REQUIRED_KEYS = [
  'APP_ENV',
  'NEXT_PUBLIC_APP_ENV',
  'AWS_REGION',
  'PORT',
  'HOSTNAME',
  'DATABASE_URL',
  'DIRECT_URL',
  'NEXTAUTH_URL',
  'NEXT_PUBLIC_APP_URL',
  'ENCRYPTION_KEY',
  'JWT_SIGNING_SECRET',
  'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
  'NEXT_PUBLIC_COGNITO_CLIENT_ID',
  'COGNITO_CLIENT_SECRET',
  'S3_BUCKET_NAME',
  'SES_FROM_EMAIL',
  'PHOS_DISABLE_LEGACY_FILE_API',
  'RATE_LIMIT_STORE',
  'RATE_LIMIT_DDB_TABLE_NAME',
] as const;

function readArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    envFile: DEFAULT_ENV_FILE,
    strict: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };

    if (arg === '--env-file') args.envFile = next();
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--') continue;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  pnpm aws:lightsail:runtime-env:validate -- --env-file <UNTRACKED_ENV_FILE>
  pnpm aws:lightsail:runtime-env:validate -- --env-file <UNTRACKED_ENV_FILE> --json
  pnpm aws:lightsail:runtime-env:validate -- --env-file <UNTRACKED_ENV_FILE> --strict

Options:
  --env-file <path>  Defaults to .env.production.aws
  --strict           Exit non-zero on any warning or failure
  --json             Print machine-readable JSON
`);
}

function add(
  checks: Check[],
  status: CheckStatus,
  name: string,
  message: string,
  remediation?: string,
) {
  checks.push({
    name,
    status,
    message,
    remediation: status === 'pass' || status === 'skip' ? undefined : remediation,
  });
}

function isSet(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function hasAuthSecret(env: Record<string, string | undefined>): boolean {
  return isSet(env.NEXTAUTH_SECRET) || isSet(env.AUTH_SECRET);
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function hasPlaceholder(value: string | undefined): boolean {
  if (!isSet(value)) return false;
  const trimmed = value.trim();
  return /<[^>]+>|placeholder|example\.invalid/i.test(trimmed);
}

function isTrackedByGit(path: string): boolean {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

function credentialSource(env: Record<string, string | undefined>): 'container' | 'static' | null {
  if (
    isSet(env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) ||
    isSet(env.AWS_CONTAINER_CREDENTIALS_FULL_URI) ||
    isSet(env.AWS_ECS_CONTAINER_CREDENTIALS_RELATIVE_URI)
  ) {
    return 'container';
  }
  if (isSet(env.AWS_ACCESS_KEY_ID) || isSet(env.AWS_SECRET_ACCESS_KEY)) return 'static';
  return null;
}

function validateHttpsUrl(value: string | undefined): boolean {
  if (!isSet(value)) return false;
  const rawValue = value;
  try {
    const url = new URL(rawValue);
    return (
      url.protocol === 'https:' &&
      !['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname) &&
      !url.hostname.endsWith('.invalid')
    );
  } catch {
    return false;
  }
}

function validateDatabaseUrl(value: string | undefined): boolean {
  if (!isSet(value)) return false;
  const rawValue = value;
  try {
    const url = new URL(rawValue);
    return (
      ['postgresql:', 'postgres:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname) &&
      url.searchParams.get('sslmode') === 'require'
    );
  } catch {
    return false;
  }
}

function isBase64Encoded32Bytes(value: string | undefined): boolean {
  if (!isSet(value)) return false;
  const rawValue = value;
  try {
    return Buffer.from(rawValue, 'base64').length === 32;
  } catch {
    return false;
  }
}

function isStrongToken(value: string | undefined): boolean {
  return isSet(value) && value.trim().length >= 32 && !hasPlaceholder(value);
}

function fileModeStatus(path: string): Check {
  try {
    const mode = statSync(path).mode & 0o777;
    const groupOrOtherBits = mode & 0o077;
    if (groupOrOtherBits === 0) {
      return {
        name: 'file-permissions',
        status: 'pass',
        message: 'Runtime env file is readable only by the owner.',
      };
    }
    return {
      name: 'file-permissions',
      status: 'fail',
      message: 'Runtime env file is readable by group or other users.',
      remediation: `Run chmod 0600 ${path} before uploading it.`,
    };
  } catch {
    return {
      name: 'file-permissions',
      status: 'warn',
      message: 'Runtime env file permissions could not be inspected.',
      remediation: `Run chmod 0600 ${path} before uploading it.`,
    };
  }
}

export function validateLightsailRuntimeEnv(input: {
  envFile?: string;
  envText?: string;
  now?: Date;
}): LightsailRuntimeEnvValidationReport {
  const envFile = input.envFile ?? DEFAULT_ENV_FILE;
  const exists = input.envText !== undefined || existsSync(envFile);
  const envText = input.envText ?? (exists ? readFileSync(envFile, 'utf8') : '');
  const env = parse(envText) as Record<string, string | undefined>;
  const checks: Check[] = [];

  add(
    checks,
    exists ? 'pass' : 'fail',
    'env-file',
    exists ? 'Runtime env file is present.' : `Runtime env file is missing: ${envFile}`,
    exists
      ? undefined
      : 'Create it from tools/infra/lightsail-runtime-env.example and fill approved secrets.',
  );

  if (input.envText === undefined && exists) {
    add(
      checks,
      isTrackedByGit(envFile) ? 'fail' : 'pass',
      'env-file-untracked',
      isTrackedByGit(envFile)
        ? 'Runtime env file is tracked by git.'
        : 'Runtime env file is not tracked by git.',
      'Keep runtime secret env files untracked.',
    );
    checks.push(fileModeStatus(envFile));
  } else {
    add(checks, 'skip', 'env-file-untracked', 'Git tracking check skipped for in-memory env text.');
    add(
      checks,
      'skip',
      'file-permissions',
      'File permission check skipped for in-memory env text.',
    );
  }

  const missing = REQUIRED_KEYS.filter((key) => !isSet(env[key]));
  if (!hasAuthSecret(env)) missing.push('NEXTAUTH_SECRET' as (typeof REQUIRED_KEYS)[number]);
  add(
    checks,
    missing.length === 0 ? 'pass' : 'fail',
    'required-keys',
    missing.length === 0
      ? 'Required runtime keys are present.'
      : `Required runtime keys are missing: ${missing.join(', ')}`,
    'Fill every required runtime key before uploading the env file.',
  );

  const placeholderKeys = Object.keys(env).filter((key) => hasPlaceholder(env[key]));
  add(
    checks,
    placeholderKeys.length === 0 ? 'pass' : 'fail',
    'placeholder-values',
    placeholderKeys.length === 0
      ? 'No placeholder values were found.'
      : `Placeholder values remain in: ${placeholderKeys.join(', ')}`,
    'Replace placeholders with approved runtime values before deployment.',
  );

  add(
    checks,
    env.APP_ENV === 'production' && env.NEXT_PUBLIC_APP_ENV === 'production' ? 'pass' : 'fail',
    'production-mode',
    'Runtime env declares production mode for server and browser build.',
    'Set APP_ENV=production and NEXT_PUBLIC_APP_ENV=production for AWS runtime.',
  );

  add(
    checks,
    validateHttpsUrl(env.NEXTAUTH_URL) && validateHttpsUrl(env.NEXT_PUBLIC_APP_URL)
      ? 'pass'
      : 'fail',
    'public-https-urls',
    'NEXTAUTH_URL and NEXT_PUBLIC_APP_URL are HTTPS public URLs.',
    'Use the final HTTPS domain before handling production PHI.',
  );

  add(
    checks,
    validateDatabaseUrl(env.DATABASE_URL) && validateDatabaseUrl(env.DIRECT_URL) ? 'pass' : 'fail',
    'database-url-tls',
    'DATABASE_URL and DIRECT_URL are PostgreSQL URLs with sslmode=require.',
    'Use the managed PostgreSQL endpoint with sslmode=require.',
  );

  const authSecret = env.NEXTAUTH_SECRET ?? env.AUTH_SECRET;
  add(
    checks,
    isStrongToken(authSecret) &&
      isBase64Encoded32Bytes(env.ENCRYPTION_KEY) &&
      isStrongToken(env.JWT_SIGNING_SECRET)
      ? 'pass'
      : 'fail',
    'secret-shape',
    'Auth, encryption, and JWT secrets have production-safe shapes.',
    'Use openssl rand -hex 32 for auth/JWT secrets and openssl rand -base64 32 for ENCRYPTION_KEY.',
  );

  add(
    checks,
    env.PHOS_DISABLE_LEGACY_FILE_API === '1' ? 'pass' : 'fail',
    'legacy-file-api-disabled',
    'Legacy Next.js file APIs are disabled.',
    'Set PHOS_DISABLE_LEGACY_FILE_API=1 for PH-OS production.',
  );

  const source = credentialSource(env);
  const usesAwsRuntimeApis =
    env.RATE_LIMIT_STORE === 'dynamodb' ||
    isTruthy(env.SECRETS_MANAGER_ENABLED) ||
    isSet(env.SECRETS_MANAGER_SECRET_ID) ||
    isSet(env.SECRETS_MANAGER_SECRET_ARN);

  add(
    checks,
    env.RATE_LIMIT_STORE === 'dynamodb' && isSet(env.RATE_LIMIT_DDB_TABLE_NAME) ? 'pass' : 'fail',
    'dynamodb-rate-limit-config',
    'DynamoDB rate-limit store is configured for production fail-closed behavior.',
    'Set RATE_LIMIT_STORE=dynamodb and RATE_LIMIT_DDB_TABLE_NAME before production deployment.',
  );

  add(
    checks,
    !usesAwsRuntimeApis ? 'pass' : source === 'container' ? 'pass' : 'fail',
    'aws-runtime-credential-source',
    !usesAwsRuntimeApis
      ? 'Runtime env does not enable AWS APIs that require application credentials.'
      : source === 'container'
        ? 'Runtime env relies on a container/role credential source for AWS API calls.'
        : source === 'static'
          ? 'Runtime env contains static AWS access keys.'
          : 'Runtime env enables AWS APIs but has no supported credential source.',
    source === 'static'
      ? 'Do not persist long-lived AWS keys in the env file; use ECS task roles, EC2 instance profiles, or another approved short-lived credential source.'
      : 'DynamoDB/Secrets Manager need role/container credentials. Lightsail instances do not inject ECS task-role or EC2 instance-profile style credentials.',
  );

  const summary = checks.reduce<Record<CheckStatus, number>>(
    (counts, check) => {
      counts[check.status] += 1;
      return counts;
    },
    { pass: 0, warn: 0, fail: 0, skip: 0 },
  );

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    envFile,
    summary,
    checks,
  };
}

function printText(report: LightsailRuntimeEnvValidationReport) {
  console.log(`# PH-OS Lightsail runtime env validation (${report.generatedAt})`);
  console.log(`env file: ${report.envFile}`);
  console.log(
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.skip} skip`,
  );

  for (const check of report.checks) {
    console.log(`- [${check.status.toUpperCase()}] ${check.name}: ${check.message}`);
    if (check.remediation) console.log(`  fix: ${check.remediation}`);
  }
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const report = validateLightsailRuntimeEnv({ envFile: args.envFile });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printText(report);

  const shouldFail = report.summary.fail > 0 || (args.strict && report.summary.warn > 0);
  if (shouldFail) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
