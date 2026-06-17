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

export type AwsGithubOidcTemplateValidationReport = {
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

const DEFAULT_TEMPLATE_PATH = 'tools/infra/github-actions-ecr-oidc-role-template.yaml';

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
  pnpm aws:github-oidc:template:validate
  pnpm aws:github-oidc:template:validate -- --json
  pnpm aws:github-oidc:template:validate -- --live-aws --strict

Options:
  --template <path>  Defaults to tools/infra/github-actions-ecr-oidc-role-template.yaml
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

function hasRepositoryScopedPushStatement(template: string): boolean {
  return /Sid: EcrPushRepository[\s\S]*Resource: !Sub 'arn:\$\{AWS::Partition\}:ecr:\$\{AWS::Region\}:\$\{AWS::AccountId\}:repository\/\$\{RepositoryName\}'/.test(
    template,
  );
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
      message: 'AWS CloudFormation validate-template accepted the GitHub OIDC role template.',
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

export function validateAwsGithubOidcTemplate(input: {
  templatePath?: string;
  templateText?: string;
  liveAws?: boolean;
  region?: string;
  now?: Date;
}): AwsGithubOidcTemplateValidationReport {
  const templatePath = input.templatePath ?? DEFAULT_TEMPLATE_PATH;
  const templateText =
    input.templateText ?? (existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '');
  const checks: Check[] = [];

  add(
    checks,
    hasAll(templateText, [
      'AWS::IAM::OIDCProvider',
      'Url: https://token.actions.githubusercontent.com',
      'ClientIdList:',
      'sts.amazonaws.com',
    ])
      ? 'pass'
      : 'fail',
    'github-oidc-provider',
    'Template creates or accepts a GitHub Actions OIDC provider for sts.amazonaws.com.',
    'Add an AWS::IAM::OIDCProvider for token.actions.githubusercontent.com with sts.amazonaws.com audience.',
  );

  add(
    checks,
    hasAll(templateText, [
      'AWS::IAM::Role',
      'sts:AssumeRoleWithWebIdentity',
      'token.actions.githubusercontent.com:aud: sts.amazonaws.com',
      'token.actions.githubusercontent.com:sub: !Ref GitHubSubject',
    ])
      ? 'pass'
      : 'fail',
    'trust-policy-conditions',
    'Role trust policy is constrained by GitHub OIDC audience and subject claims.',
    'Require aud=sts.amazonaws.com and an exact token.actions.githubusercontent.com:sub condition.',
  );

  add(
    checks,
    templateText.includes('Default: repo:yusuketakuma/careviax:environment:production')
      ? 'pass'
      : 'fail',
    'production-environment-subject',
    'Default GitHub subject matches the manual workflow production environment.',
    'Set GitHubSubject to repo:yusuketakuma/careviax:environment:production or the approved production environment subject.',
  );

  add(
    checks,
    hasAll(templateText, [
      'Sid: EcrAuthorizationToken',
      'ecr:GetAuthorizationToken',
      "Resource: '*'",
    ])
      ? 'pass'
      : 'fail',
    'ecr-auth-token-scope',
    'ECR authorization token permission is present with AWS-required wildcard resource scope.',
    'Grant ecr:GetAuthorizationToken on * so Docker can authenticate to ECR.',
  );

  add(
    checks,
    hasAll(templateText, [
      'Sid: EcrPushRepository',
      'ecr:BatchCheckLayerAvailability',
      'ecr:InitiateLayerUpload',
      'ecr:UploadLayerPart',
      'ecr:CompleteLayerUpload',
      'ecr:PutImage',
    ]) && hasRepositoryScopedPushStatement(templateText)
      ? 'pass'
      : 'fail',
    'ecr-push-repository-scope',
    'ECR push permissions are limited to the configured repository ARN.',
    'Scope push permissions to arn:${AWS::Partition}:ecr:${AWS::Region}:${AWS::AccountId}:repository/${RepositoryName}.',
  );

  add(
    checks,
    templateText.includes('ecr:*') || templateText.includes('Resource: !Sub arn:')
      ? 'fail'
      : 'pass',
    'no-broad-ecr-wildcards',
    'Template does not use broad ECR action or malformed resource wildcards.',
    'Remove ecr:* and keep repository actions scoped to one ECR repository ARN.',
  );

  if (!templateText) {
    add(
      checks,
      'fail',
      'template-file',
      `Template file is missing or empty: ${templatePath}`,
      'Create the GitHub OIDC role CloudFormation template.',
    );
  }

  if (input.liveAws) {
    checks.push(
      runAwsValidateTemplate(
        templatePath,
        input.region ?? process.env.AWS_REGION ?? 'ap-northeast-1',
      ),
    );
  } else {
    checks.push({
      name: 'aws-validate-template',
      status: 'skip',
      message: 'Live AWS CloudFormation validation skipped. Rerun with --live-aws.',
    });
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

function printText(report: AwsGithubOidcTemplateValidationReport) {
  console.log(`# PH-OS GitHub OIDC ECR role template validation (${report.generatedAt})`);
  console.log(`template: ${report.templatePath}`);
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
  const report = validateAwsGithubOidcTemplate({
    templatePath: args.templatePath,
    liveAws: args.liveAws,
    region: args.region,
  });

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
