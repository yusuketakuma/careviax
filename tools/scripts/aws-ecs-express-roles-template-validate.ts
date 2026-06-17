import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

type Check = {
  name: string;
  status: CheckStatus;
  message: string;
  remediation?: string;
};

export type EcsExpressRolesTemplateValidationReport = {
  generatedAt: string;
  templatePath: string;
  summary: Record<CheckStatus, number>;
  checks: Check[];
};

type CliArgs = {
  templatePath: string;
  region: string;
  liveAws: boolean;
  strict: boolean;
  json: boolean;
};

const DEFAULT_TEMPLATE_PATH = 'tools/infra/ecs-express-roles-template.yaml';

function readArgs(argv: string[], env: Record<string, string | undefined> = process.env): CliArgs {
  const args: CliArgs = {
    templatePath: DEFAULT_TEMPLATE_PATH,
    region: env.AWS_REGION ?? 'ap-northeast-1',
    liveAws: false,
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

    if (arg === '--template') args.templatePath = next();
    else if (arg === '--region') args.region = next();
    else if (arg === '--live-aws') args.liveAws = true;
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
  pnpm aws:ecs-express:roles:validate
  pnpm aws:ecs-express:roles:validate -- --json
  pnpm aws:ecs-express:roles:validate -- --live-aws --strict

Options:
  --template <path>  Defaults to ${DEFAULT_TEMPLATE_PATH}
  --region <region>  Defaults to AWS_REGION or ap-northeast-1
  --live-aws         Also run aws cloudformation validate-template
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

function hasAll(template: string, fragments: string[]): boolean {
  return fragments.every((fragment) => template.includes(fragment));
}

function truncate(value: string, maxLength = 1000) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function runAwsValidateTemplate(templatePath: string, region: string): Check {
  const result = spawnSync(
    'aws',
    [
      'cloudformation',
      'validate-template',
      '--region',
      region,
      '--template-body',
      `file://${templatePath}`,
      '--output',
      'json',
      '--no-cli-pager',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, AWS_PAGER: '', AWS_REGION: region },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const error = result.error as NodeJS.ErrnoException | undefined;
  if (error?.code === 'ENOENT') {
    return {
      name: 'aws-validate-template',
      status: 'fail',
      message: 'AWS CLI is not installed.',
      remediation: 'Install AWS CLI v2 before live CloudFormation validation.',
    };
  }

  if (result.status === 0) {
    return {
      name: 'aws-validate-template',
      status: 'pass',
      message: 'AWS CloudFormation validate-template accepted the ECS Express roles template.',
    };
  }

  return {
    name: 'aws-validate-template',
    status: 'fail',
    message: truncate(
      result.stderr || result.stdout || 'aws cloudformation validate-template failed',
    ),
    remediation: 'Fix the CloudFormation template or configure AWS credentials, then rerun.',
  };
}

export function validateEcsExpressRolesTemplate(input: {
  templatePath?: string;
  templateText?: string;
  liveAws?: boolean;
  region?: string;
  now?: Date;
}): EcsExpressRolesTemplateValidationReport {
  const templatePath = input.templatePath ?? DEFAULT_TEMPLATE_PATH;
  const templateText =
    input.templateText ?? (existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '');
  const checks: Check[] = [];

  add(
    checks,
    hasAll(templateText, [
      'EcsTaskExecutionRole:',
      'EcsInfrastructureRole:',
      'EcsAppTaskRole:',
      'AWS::IAM::Role',
    ])
      ? 'pass'
      : 'fail',
    'required-roles',
    'Template declares ECS task execution, ECS Express infrastructure, and PH-OS app task roles.',
    'Create the three IAM roles required for ECS Express and PH-OS runtime AWS API access.',
  );

  add(
    checks,
    hasAll(templateText, [
      'Service: ecs-tasks.amazonaws.com',
      'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
    ])
      ? 'pass'
      : 'fail',
    'task-execution-role',
    'Task execution role trusts ECS tasks and uses the AWS managed execution policy.',
    'Trust ecs-tasks.amazonaws.com and attach AmazonECSTaskExecutionRolePolicy.',
  );

  add(
    checks,
    hasAll(templateText, [
      'Service: ecs.amazonaws.com',
      'arn:aws:iam::aws:policy/AmazonECSInfrastructureRoleforExpressGatewayServices',
    ])
      ? 'pass'
      : 'fail',
    'infrastructure-role',
    'Infrastructure role trusts ECS and uses the ECS Express Gateway Services managed policy.',
    'Trust ecs.amazonaws.com and attach AmazonECSInfrastructureRoleforExpressGatewayServices.',
  );

  add(
    checks,
    hasAll(templateText, [
      'EcsAppTaskRole:',
      'Attach least-privilege app policies before enabling AWS API-backed runtime features',
      'AppTaskRoleArn:',
    ])
      ? 'pass'
      : 'fail',
    'app-task-role-handoff',
    'Application task role is output separately for least-privilege runtime policy attachment.',
    'Output the app task role ARN and do not mix app runtime permissions into the execution role.',
  );

  add(
    checks,
    templateText.includes('AWS_SECRET_ACCESS_KEY') ||
      templateText.includes('AWS_ACCESS_KEY_ID') ||
      templateText.includes('Resource: "*"') ||
      templateText.includes("Resource: '*'")
      ? 'fail'
      : 'pass',
    'no-static-keys-or-wildcard-resources',
    'Template does not embed static AWS keys or wildcard runtime resource permissions.',
    'Remove static credentials and avoid broad wildcard runtime permissions.',
  );

  if (!templateText) {
    add(
      checks,
      'fail',
      'template-file',
      `Template file is missing or empty: ${templatePath}`,
      'Create the ECS Express roles CloudFormation template.',
    );
  }

  if (input.liveAws) {
    checks.push(runAwsValidateTemplate(templatePath, input.region ?? 'ap-northeast-1'));
  } else {
    add(
      checks,
      'skip',
      'aws-validate-template',
      'Live AWS CloudFormation validation was skipped.',
      'Rerun with --live-aws after configuring AWS credentials.',
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
    generatedAt: (input.now ?? new Date()).toISOString(),
    templatePath,
    summary,
    checks,
  };
}

function printReport(report: EcsExpressRolesTemplateValidationReport) {
  console.log(`# ECS Express roles template validation (${report.generatedAt})`);
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
  const report = validateEcsExpressRolesTemplate({
    templatePath: args.templatePath,
    liveAws: args.liveAws,
    region: args.region,
  });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);

  const shouldFail =
    report.summary.fail > 0 ||
    (args.strict && (report.summary.warn > 0 || report.summary.skip > 0));
  if (shouldFail) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
