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

export type RdsBackupTemplateValidationReport = {
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

const DEFAULT_TEMPLATE_PATH = 'tools/infra/rds-aws-backup-template.yaml';

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
  pnpm aws:rds-backup:template:validate
  pnpm aws:rds-backup:template:validate -- --json
  pnpm aws:rds-backup:template:validate -- --live-aws --strict

Options:
  --template <path>  Defaults to tools/infra/rds-aws-backup-template.yaml
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

function hasAny(template: string, fragments: string[]): boolean {
  return fragments.some((fragment) => template.includes(fragment));
}

function hasSensitiveLiteral(template: string): boolean {
  return /AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|DATABASE_URL=|NEXTAUTH_SECRET=|JWT_SIGNING_SECRET=|ENCRYPTION_KEY=|PHOS_DB_MASTER_PASSWORD/.test(
    template,
  );
}

function validateTemplateText(
  template: string,
  templatePath: string,
  now = new Date(),
): RdsBackupTemplateValidationReport {
  const checks: Check[] = [];

  add(
    checks,
    hasAll(template, [
      'AWS::Backup::BackupVault',
      'AWS::Backup::BackupPlan',
      'AWS::Backup::BackupSelection',
      'AWS::KMS::Key',
      'AWS::IAM::Role',
    ])
      ? 'pass'
      : 'fail',
    'resource-types',
    'Template declares a backup vault, backup plan, backup selection, KMS key, and AWS Backup service role.',
    'Add the missing AWS Backup/KMS/IAM resources before deployment.',
  );

  add(
    checks,
    hasAll(template, [
      'RdsDbInstanceArn:',
      'Resources:\n          - !Ref RdsDbInstanceArn',
      'AWSBackupServiceRolePolicyForBackup',
    ])
      ? 'pass'
      : 'fail',
    'explicit-rds-selection',
    'The RDS DB instance ARN is an explicit backup selection target.',
    'Require an explicit RdsDbInstanceArn parameter and do not rely on broad tag-only selection.',
  );

  add(
    checks,
    hasAll(template, ['EnableContinuousBackup: true', 'DeleteAfterDays: !Ref BackupRetentionDays'])
      ? 'pass'
      : 'fail',
    'continuous-pitr',
    'Backup plan enables continuous RDS PITR with retention controlled by BackupRetentionDays.',
    'Enable continuous backup and wire lifecycle retention to BackupRetentionDays.',
  );

  add(
    checks,
    hasAll(template, [
      'BackupRetentionDays:',
      'Default: 35',
      'DailyBackupScheduleExpression:',
      'RuleName: rds-daily-recovery-point',
    ])
      ? 'pass'
      : 'fail',
    'retention-and-daily-recovery-point',
    'Template keeps a 35-day default retention and a scheduled daily recovery point.',
    'Keep PH-OS RDS retention at 35 days unless architecture review approves a narrower window.',
  );

  add(
    checks,
    hasAll(template, ['DeletionPolicy: Retain', 'UpdateReplacePolicy: Retain']) ? 'pass' : 'fail',
    'retain-critical-resources',
    'Backup vault and KMS key resources are retained on stack replacement/deletion.',
    'Use Retain on backup vault and KMS key resources.',
  );

  add(
    checks,
    hasAll(template, ['EnableCrossRegionCopy:', "Default: 'false'", 'UseCrossRegionCopy'])
      ? 'pass'
      : 'fail',
    'cross-region-copy-default-off',
    'Cross-region backup copy is available but disabled by default for PHI locality.',
    'Default cross-region copy to false and require an explicit destination vault ARN.',
  );

  add(
    checks,
    hasAll(template, [
      'EnableVaultLockComplianceMode:',
      "Default: 'false'",
      'UseVaultLock',
      'ChangeableForDays',
    ])
      ? 'pass'
      : 'fail',
    'vault-lock-guarded',
    'Vault Lock compliance mode is guarded and defaults off.',
    'Do not enable irreversible Vault Lock compliance mode without explicit approval.',
  );

  add(
    checks,
    hasAll(template, [
      'EnableRestoreTesting:',
      "Default: 'false'",
      'AWS::Backup::RestoreTestingPlan',
      'AWS::Backup::RestoreTestingSelection',
    ])
      ? 'pass'
      : 'fail',
    'restore-testing-optional',
    'Restore testing resources are defined and gated behind an explicit parameter.',
    'Add AWS Backup restore testing resources and keep them opt-in until cost and drill windows are approved.',
  );

  add(
    checks,
    !hasAny(template, [
      'backup:StartRestoreJob',
      'backup:DeleteRecoveryPoint',
      'rds:DeleteDBInstance',
      'secretsmanager:PutSecretValue',
      'rds:DeleteDBCluster',
    ])
      ? 'pass'
      : 'fail',
    'no-dangerous-application-permissions',
    'Template does not grant destructive restore/delete/secret-write permissions.',
    'Keep restore/cutover/delete permissions out of application runtime infrastructure.',
  );

  add(
    checks,
    !hasSensitiveLiteral(template) ? 'pass' : 'fail',
    'no-secret-literals',
    'Template does not contain known runtime secret literals.',
    'Use parameters, Secrets Manager, or external deployment-time wiring for secrets.',
  );

  const summary = checks.reduce<Record<CheckStatus, number>>(
    (counts, check) => {
      counts[check.status] += 1;
      return counts;
    },
    { pass: 0, warn: 0, fail: 0, skip: 0 },
  );

  return {
    generatedAt: now.toISOString(),
    templatePath,
    summary,
    checks,
  };
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
      message: 'AWS CloudFormation validate-template accepted the template.',
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

export function validateRdsBackupTemplate(input: {
  templatePath?: string;
  templateText?: string;
  liveAws?: boolean;
  region?: string;
  now?: Date;
}): RdsBackupTemplateValidationReport {
  const templatePath = input.templatePath ?? DEFAULT_TEMPLATE_PATH;
  const templateText =
    input.templateText ?? (existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '');
  const report = validateTemplateText(templateText, templatePath, input.now ?? new Date());

  if (!templateText) {
    add(
      report.checks,
      'fail',
      'template-file',
      `Template file is missing or empty: ${templatePath}`,
      'Create the RDS AWS Backup CloudFormation template.',
    );
  }

  if (input.liveAws) {
    report.checks.push(
      runAwsValidateTemplate(
        templatePath,
        input.region ?? process.env.AWS_REGION ?? 'ap-northeast-1',
      ),
    );
  } else {
    report.checks.push({
      name: 'aws-validate-template',
      status: 'skip',
      message: 'Live AWS CloudFormation validation skipped. Rerun with --live-aws.',
    });
  }

  report.summary = report.checks.reduce<Record<CheckStatus, number>>(
    (counts, check) => {
      counts[check.status] += 1;
      return counts;
    },
    { pass: 0, warn: 0, fail: 0, skip: 0 },
  );

  return report;
}

function printText(report: RdsBackupTemplateValidationReport) {
  console.log(`# PH-OS RDS AWS Backup template validation (${report.generatedAt})`);
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
  const report = validateRdsBackupTemplate({
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
