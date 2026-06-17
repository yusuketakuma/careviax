import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';

type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export type ReadinessCheck = {
  name: string;
  status: CheckStatus;
  message: string;
  remediation?: string;
};

export type CommandState = {
  found: boolean;
  version?: string;
};

export type ReadinessInput = {
  commands: {
    aws: CommandState;
    docker: CommandState;
    node: CommandState;
    pnpm: CommandState;
  };
  files: {
    dockerfile: boolean;
    dockerignore: boolean;
    nextConfig: string | null;
    costScenarios: boolean;
    operationsDoc: boolean;
    standaloneServer: boolean;
    standaloneEnvFiles: string[];
  };
  env: Record<string, string | undefined>;
  liveAws?: {
    attempted: boolean;
    ok: boolean;
    message: string;
  };
};

export type ReadinessReport = {
  generatedAt: string;
  summary: Record<CheckStatus, number>;
  checks: ReadinessCheck[];
};

type CliArgs = {
  liveAws: boolean;
  strict: boolean;
  json: boolean;
};

function readArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    liveAws: false,
    strict: false,
    json: false,
  };

  for (const arg of argv) {
    if (arg === '--live-aws') args.liveAws = true;
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
  pnpm aws:deploy:readiness
  pnpm aws:deploy:readiness -- --live-aws
  pnpm aws:deploy:readiness -- --strict --json

Options:
  --live-aws  Run aws sts get-caller-identity to verify configured credentials
  --strict    Exit non-zero on any fail or warning
  --json      Print machine-readable JSON
`);
}

function add(
  checks: ReadinessCheck[],
  status: CheckStatus,
  name: string,
  message: string,
  remediation?: string,
) {
  checks.push({ name, status, message, remediation });
}

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function hasAuthSecret(env: Record<string, string | undefined>): boolean {
  return isSet(env.NEXTAUTH_SECRET) || isSet(env.AUTH_SECRET);
}

export function evaluateReadiness(input: ReadinessInput, now = new Date()): ReadinessReport {
  const checks: ReadinessCheck[] = [];

  add(
    checks,
    input.commands.aws.found ? 'pass' : 'fail',
    'aws-cli',
    input.commands.aws.found
      ? `AWS CLI is installed: ${input.commands.aws.version ?? 'version unknown'}`
      : 'AWS CLI is not installed.',
    input.commands.aws.found ? undefined : 'Install AWS CLI v2 before live account checks.',
  );
  add(
    checks,
    input.commands.docker.found ? 'pass' : 'warn',
    'docker',
    input.commands.docker.found
      ? `Docker is available: ${input.commands.docker.version ?? 'version unknown'}`
      : 'Docker is not installed or not on PATH.',
    input.commands.docker.found
      ? undefined
      : 'Install Docker or build/push the image from the GitHub Actions ECR workflow.',
  );
  add(
    checks,
    input.commands.node.found ? 'pass' : 'fail',
    'node',
    input.commands.node.found
      ? `Node is available: ${input.commands.node.version ?? 'version unknown'}`
      : 'Node is not available.',
  );
  add(
    checks,
    input.commands.pnpm.found ? 'pass' : 'fail',
    'pnpm',
    input.commands.pnpm.found
      ? `pnpm is available: ${input.commands.pnpm.version ?? 'version unknown'}`
      : 'pnpm is not available.',
  );

  add(
    checks,
    input.files.dockerfile ? 'pass' : 'fail',
    'dockerfile',
    input.files.dockerfile ? 'Production Dockerfile is present.' : 'Dockerfile is missing.',
  );
  add(
    checks,
    input.files.dockerignore ? 'pass' : 'warn',
    'dockerignore',
    input.files.dockerignore
      ? '.dockerignore is present.'
      : '.dockerignore is missing; image context may include local artifacts.',
  );
  const hasStandaloneOutput =
    input.files.nextConfig?.includes("output: 'standalone'") ||
    input.files.nextConfig?.includes('output: "standalone"');
  add(
    checks,
    hasStandaloneOutput ? 'pass' : 'fail',
    'next-standalone-config',
    input.files.nextConfig
      ? 'Next.js standalone output is enabled.'
      : 'next.config.ts could not be read.',
    hasStandaloneOutput
      ? undefined
      : 'Set output: "standalone" before building AWS container images.',
  );
  add(
    checks,
    input.files.standaloneServer ? 'pass' : 'warn',
    'next-standalone-artifact',
    input.files.standaloneServer
      ? '.next/standalone/server.js exists from a recent build.'
      : '.next/standalone/server.js is missing.',
    input.files.standaloneServer
      ? undefined
      : 'Run pnpm build before building or smoke-testing the Docker image.',
  );
  add(
    checks,
    input.files.standaloneEnvFiles.length === 0 ? 'pass' : 'fail',
    'next-standalone-secret-files',
    input.files.standaloneEnvFiles.length === 0
      ? 'No .env files are present inside .next/standalone.'
      : `.next/standalone contains environment files: ${input.files.standaloneEnvFiles.join(', ')}`,
    input.files.standaloneEnvFiles.length === 0
      ? undefined
      : 'Remove .env files from .next/standalone before packaging or building runtime images.',
  );
  add(
    checks,
    input.files.costScenarios ? 'pass' : 'fail',
    'cost-scenarios',
    input.files.costScenarios
      ? 'Cost scenario config is present.'
      : 'tools/aws-cost-minimal-scenarios.json is missing.',
  );
  add(
    checks,
    input.files.operationsDoc ? 'pass' : 'warn',
    'aws-operations-doc',
    input.files.operationsDoc
      ? 'AWS low-cost operations doc is present.'
      : 'AWS low-cost operations doc is missing.',
  );

  const requiredEnv = [
    'AWS_REGION',
    'DATABASE_URL',
    'NEXTAUTH_URL',
    'NEXT_PUBLIC_APP_URL',
    'ENCRYPTION_KEY',
    'JWT_SIGNING_SECRET',
  ];
  const missingEnv = requiredEnv.filter((key) => !isSet(input.env[key]));
  if (!hasAuthSecret(input.env)) missingEnv.push('NEXTAUTH_SECRET or AUTH_SECRET');

  add(
    checks,
    missingEnv.length === 0 ? 'pass' : 'warn',
    'production-env',
    missingEnv.length === 0
      ? 'Core production environment variables are present.'
      : `Core production environment variables are not fully configured: ${missingEnv.join(', ')}`,
    missingEnv.length === 0
      ? undefined
      : 'Set these in the target AWS runtime or Secrets Manager before deployment.',
  );

  if (input.liveAws?.attempted) {
    add(
      checks,
      input.liveAws.ok ? 'pass' : 'fail',
      'aws-credentials',
      input.liveAws.message,
      input.liveAws.ok ? undefined : 'Configure AWS credentials, then rerun with --live-aws.',
    );
  } else {
    add(
      checks,
      'skip',
      'aws-credentials',
      'Live AWS credential check was skipped. Rerun with --live-aws to call STS.',
    );
  }

  const summary = checks.reduce<Record<CheckStatus, number>>(
    (counts, check) => {
      counts[check.status] += 1;
      return counts;
    },
    { pass: 0, warn: 0, fail: 0, skip: 0 },
  );

  return {
    generatedAt: now.toISOString(),
    summary,
    checks,
  };
}

function commandVersion(command: string, args: string[]): CommandState {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return { found: true, version: output };
  } catch {
    return { found: false };
  }
}

function readTextIfExists(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
}

function listStandaloneEnvFiles() {
  const directory = '.next/standalone';
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name === '.env' || name.startsWith('.env.'));
}

function runLiveAwsCheck(): ReadinessInput['liveAws'] {
  try {
    execFileSync('aws', ['sts', 'get-caller-identity', '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AWS_REGION: process.env.AWS_REGION ?? 'ap-northeast-1' },
      timeout: 15_000,
    });
    return {
      attempted: true,
      ok: true,
      message: 'AWS credentials are configured and STS caller identity succeeded.',
    };
  } catch (error) {
    const message = extractCommandErrorMessage(error);
    return {
      attempted: true,
      ok: false,
      message: `AWS credential check failed: ${message}`,
    };
  }
}

function extractCommandErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'stderr' in error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    const text = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr;
    const firstLine = text
      ?.split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '');
    if (firstLine) return firstLine;
  }

  if (error instanceof Error) return error.message.split('\n')[0] ?? error.message;
  return String(error).split('\n')[0] ?? 'unknown error';
}

function collectInput(args: CliArgs): ReadinessInput {
  return {
    commands: {
      aws: commandVersion('aws', ['--version']),
      docker: commandVersion('docker', ['--version']),
      node: commandVersion('node', ['--version']),
      pnpm: commandVersion('pnpm', ['--version']),
    },
    files: {
      dockerfile: existsSync('Dockerfile'),
      dockerignore: existsSync('.dockerignore'),
      nextConfig: readTextIfExists('next.config.ts'),
      costScenarios: existsSync('tools/aws-cost-minimal-scenarios.json'),
      operationsDoc: existsSync('docs/operations/aws-cost-minimal-deployment.md'),
      standaloneServer: existsSync('.next/standalone/server.js'),
      standaloneEnvFiles: listStandaloneEnvFiles(),
    },
    env: process.env,
    liveAws: args.liveAws
      ? runLiveAwsCheck()
      : { attempted: false, ok: false, message: 'not attempted' },
  };
}

function printReport(report: ReadinessReport) {
  console.log(`# AWS deployment readiness (${report.generatedAt})`);
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
  const report = evaluateReadiness(collectInput(args));

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  const shouldFail = args.strict
    ? report.summary.fail > 0 || report.summary.warn > 0
    : report.summary.fail > 0;
  if (shouldFail) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
