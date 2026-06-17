import { readFileSync } from 'node:fs';
import process from 'node:process';

type PlanCommand = {
  id: string;
  description: string;
  command: string;
  mutates: boolean;
};

type PlanPhase = {
  id: string;
  title: string;
  commands: PlanCommand[];
};

export type EcsExpressPlanOptions = {
  region: string;
  prefix: string;
  repositoryName: string;
  ecrStackName: string;
  rolesStackName: string;
  runtimePolicyStackName: string;
  serviceName: string;
  cluster: string;
  serviceInputPath: string;
};

export type EcsExpressPlan = {
  scenario: 'ecs-express-role-capable-minimum';
  region: string;
  estimatedMonthlyUsd: number | null;
  requiredEnvironment: string[];
  assumptions: string[];
  phases: PlanPhase[];
};

type CliArgs = {
  json: boolean;
  shell: boolean;
  options: EcsExpressPlanOptions;
};

const DEFAULT_SERVICE_INPUT_PATH = 'tmp/ecs-express-service-input.json';

export const DEFAULT_ECS_EXPRESS_PLAN_OPTIONS: EcsExpressPlanOptions = {
  region: 'ap-northeast-1',
  prefix: 'ph-os-ecs-express',
  repositoryName: 'ph-os/app',
  ecrStackName: 'ph-os-pilot-ecr',
  rolesStackName: 'ph-os-ecs-express-roles',
  runtimePolicyStackName: 'ph-os-ecs-express-runtime-policy',
  serviceName: 'ph-os-ecs-express',
  cluster: 'default',
  serviceInputPath: DEFAULT_SERVICE_INPUT_PATH,
};

function readArgs(argv: string[]): CliArgs {
  const options = { ...DEFAULT_ECS_EXPRESS_PLAN_OPTIONS };
  const args: CliArgs = {
    json: false,
    shell: false,
    options,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };

    if (arg === '--json') args.json = true;
    else if (arg === '--shell') args.shell = true;
    else if (arg === '--region') options.region = next();
    else if (arg === '--prefix') options.prefix = next();
    else if (arg === '--repository-name') options.repositoryName = next();
    else if (arg === '--ecr-stack-name') options.ecrStackName = next();
    else if (arg === '--roles-stack-name') options.rolesStackName = next();
    else if (arg === '--runtime-policy-stack-name') options.runtimePolicyStackName = next();
    else if (arg === '--service-name') options.serviceName = next();
    else if (arg === '--cluster') options.cluster = next();
    else if (arg === '--service-input') options.serviceInputPath = next();
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
  pnpm aws:ecs-express:plan
  pnpm aws:ecs-express:plan -- --shell
  pnpm aws:ecs-express:plan -- --json

Options:
  --region <region>             Defaults to ap-northeast-1
  --prefix <name>               Defaults to ph-os-ecs-express
  --repository-name <name>      Defaults to ph-os/app
  --ecr-stack-name <name>       Defaults to ph-os-pilot-ecr
  --roles-stack-name <name>     Defaults to ph-os-ecs-express-roles
  --runtime-policy-stack-name <name>
                                  Defaults to ph-os-ecs-express-runtime-policy
  --service-name <name>         Defaults to ph-os-ecs-express
  --cluster <name>              Defaults to default
  --service-input <path>        Defaults to ${DEFAULT_SERVICE_INPUT_PATH}
`);
}

function q(value: string): string {
  return JSON.stringify(value);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function command(
  id: string,
  description: string,
  commandText: string,
  mutates = false,
): PlanCommand {
  return { id, description, command: commandText, mutates };
}

function stackOutputCommand(region: string, stackName: string, outputKey: string): string {
  return `aws cloudformation describe-stacks --region ${q(region)} --stack-name ${q(
    stackName,
  )} --query ${shellSingleQuote(
    `Stacks[0].Outputs[?OutputKey==\`${outputKey}\`].OutputValue | [0]`,
  )} --output text`;
}

function readEcsExpressEstimate(): number | null {
  try {
    const text = readFileSync('tools/aws-cost-minimal-scenarios.json', 'utf8');
    const parsed = JSON.parse(text) as {
      scenarios?: Array<{ id?: string; items?: Array<{ monthlyUsd?: number }> }>;
    };
    const scenario = parsed.scenarios?.find(
      (item) => item.id === 'ecs-express-role-capable-minimum',
    );
    if (!scenario?.items) return null;
    return Number(
      scenario.items
        .reduce((total, item) => {
          const monthlyUsd = item.monthlyUsd ?? 0;
          return total + (Number.isFinite(monthlyUsd) ? monthlyUsd : 0);
        }, 0)
        .toFixed(2),
    );
  } catch {
    return null;
  }
}

export function createEcsExpressPlan(
  options: EcsExpressPlanOptions = DEFAULT_ECS_EXPRESS_PLAN_OPTIONS,
): EcsExpressPlan {
  const roleOutputNames = [
    'TaskExecutionRoleName',
    'TaskExecutionRoleArn',
    'InfrastructureRoleArn',
    'AppTaskRoleName',
    'AppTaskRoleArn',
  ] as const;
  const serviceUrl = `https://${options.serviceName}.ecs.${options.region}.on.aws`;
  const serviceArnPlaceholder = `<SERVICE_ARN_FROM_CREATE_OUTPUT>`;
  const validateInputCommand = [
    'node -e',
    shellSingleQuote(
      [
        "const fs=require('fs');",
        `const p=${JSON.stringify(options.serviceInputPath)};`,
        "const s=fs.readFileSync(p,'utf8');",
        'JSON.parse(s);',
        "if (s.includes('<') || s.includes('example.invalid')) {",
        'console.error(`Fill placeholders in ${p} before creating ECS Express service`);',
        'process.exit(1);',
        '}',
      ].join(' '),
    ),
  ].join(' ');

  const phases: PlanPhase[] = [
    {
      id: 'local-preflight',
      title: 'Local and live-read AWS validation before any ECS Express mutation',
      commands: [
        command(
          'cost-estimate-ecs-express',
          'Print the current ECS Express/Fargate role-capable estimate.',
          'pnpm aws:cost:estimate -- --scenario ecs-express-role-capable-minimum',
        ),
        command(
          'deployment-readiness-live',
          'Verify local deployment artifacts and prove AWS account identity with STS.',
          'pnpm aws:deploy:readiness -- --live-aws --strict',
        ),
        command(
          'ecr-template-live',
          'Validate the ECR repository template locally and with CloudFormation.',
          'pnpm aws:ecr:template:validate -- --live-aws --strict',
        ),
        command(
          'ecs-express-roles-template-live',
          'Validate the ECS Express IAM roles template locally and with CloudFormation.',
          'pnpm aws:ecs-express:roles:validate -- --live-aws --strict',
        ),
        command(
          'ecs-express-runtime-policy-template-live',
          'Validate the ECS Express runtime policy template locally and with CloudFormation.',
          'pnpm aws:ecs-express:runtime-policy:validate -- --live-aws --strict',
        ),
      ],
    },
    {
      id: 'foundation-stacks',
      title: 'Create the image repository and ECS Express IAM roles',
      commands: [
        command(
          'deploy-ecr-repository',
          'Create or update the private ECR repository with scan-on-push and lifecycle cleanup.',
          [
            'aws cloudformation deploy',
            `  --region ${q(options.region)}`,
            `  --stack-name ${q(options.ecrStackName)}`,
            '  --template-file tools/infra/ecr-repository-template.yaml',
            '  --parameter-overrides',
            `    RepositoryName=${options.repositoryName}`,
          ].join(' \\\n'),
          true,
        ),
        command(
          'deploy-ecs-express-roles',
          'Create or update ECS Express execution, infrastructure, and app task roles.',
          [
            'aws cloudformation deploy',
            `  --region ${q(options.region)}`,
            `  --stack-name ${q(options.rolesStackName)}`,
            '  --template-file tools/infra/ecs-express-roles-template.yaml',
            '  --capabilities CAPABILITY_NAMED_IAM',
            '  --parameter-overrides',
            `    Prefix=${options.prefix}`,
          ].join(' \\\n'),
          true,
        ),
        command(
          'read-ecr-repository-uri',
          'Read the ECR repository URI for image tagging and service input.',
          stackOutputCommand(options.region, options.ecrStackName, 'RepositoryUri'),
        ),
        ...roleOutputNames.map((outputName) =>
          command(
            `read-${outputName.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`).slice(1)}`,
            `Read ${outputName} for the ECS Express service input.`,
            stackOutputCommand(options.region, options.rolesStackName, outputName),
          ),
        ),
        command(
          'deploy-ecs-express-runtime-policy',
          'Attach least-privilege runtime policies to the ECS execution and app task roles.',
          [
            `task_execution_role_name="$(${stackOutputCommand(
              options.region,
              options.rolesStackName,
              'TaskExecutionRoleName',
            )})"`,
            `app_task_role_name="$(${stackOutputCommand(
              options.region,
              options.rolesStackName,
              'AppTaskRoleName',
            )})"`,
            [
              'aws cloudformation deploy',
              `  --region ${q(options.region)}`,
              `  --stack-name ${q(options.runtimePolicyStackName)}`,
              '  --template-file tools/infra/ecs-express-runtime-policy-template.yaml',
              '  --parameter-overrides',
              `    Prefix=${options.prefix}`,
              '    TaskExecutionRoleName="$task_execution_role_name"',
              '    AppTaskRoleName="$app_task_role_name"',
              '    SecretResourceArns="$PHOS_ECS_SECRET_ARNS"',
              '    SecretsKmsKeyArn="$PHOS_SECRETS_KMS_KEY_ARN"',
              '    DynamoRateLimitTableArn="$PHOS_RATE_LIMIT_TABLE_ARN"',
              '    EvidenceBucketName="$PHOS_EVIDENCE_BUCKET_NAME"',
              '    EvidenceKmsKeyArn="$PHOS_EVIDENCE_KMS_KEY_ARN"',
              '    SesIdentityArn="$PHOS_SES_IDENTITY_ARN"',
            ].join(' \\\n'),
          ].join('\n'),
          true,
        ),
      ],
    },
    {
      id: 'service-input',
      title: 'Prepare an untracked ECS Express service input file',
      commands: [
        command(
          'prepare-service-input',
          'Copy the reviewed example input to an ignored local file, then fill role ARNs, image URI, and Secrets Manager ARNs.',
          [
            'mkdir -p tmp',
            `test ! -e ${q(options.serviceInputPath)}`,
            `cp tools/infra/ecs-express-service-input.example.json ${q(options.serviceInputPath)}`,
            `chmod 0600 ${q(options.serviceInputPath)}`,
            `printf '%s\\n' 'Edit ${options.serviceInputPath}; keep secret values in Secrets Manager and only reference ARNs.'`,
          ].join(' && '),
          true,
        ),
        command(
          'validate-service-input',
          'Validate that the service input is JSON and no placeholder markers remain.',
          validateInputCommand,
        ),
      ],
    },
    {
      id: 'ecs-express-service',
      title: 'Create and verify the ECS Express service',
      commands: [
        command(
          'create-ecs-express-service',
          'Create the ECS Express service from the reviewed input JSON.',
          [
            'aws ecs create-express-gateway-service',
            `  --region ${q(options.region)}`,
            `  --cli-input-json file://${options.serviceInputPath}`,
            '  --monitor-resources DEPLOYMENT',
            '  --monitor-mode TEXT-ONLY',
          ].join(' \\\n'),
          true,
        ),
        command(
          'describe-ecs-express-service',
          'Read the ECS Express service status and URL after creation.',
          `aws ecs describe-express-gateway-service --region ${q(
            options.region,
          )} --service-arn ${q(serviceArnPlaceholder)} --output json`,
        ),
        command(
          'monitor-ecs-express-service',
          'Monitor ECS Express resource state without creating or updating resources.',
          `aws ecs monitor-express-gateway-service --region ${q(
            options.region,
          )} --service-arn ${q(serviceArnPlaceholder)} --monitor-mode TEXT-ONLY`,
        ),
        command(
          'public-health-smoke',
          'Prove the same HTTPS health endpoint users will hit.',
          `pnpm perf:smoke -- --base-url ${serviceUrl} --path /api/health --requests 5 --concurrency 1 --target-ms 5000`,
        ),
      ],
    },
  ];

  return {
    scenario: 'ecs-express-role-capable-minimum',
    region: options.region,
    estimatedMonthlyUsd: readEcsExpressEstimate(),
    requiredEnvironment: [
      'AWS credentials or aws login session',
      'Approved ECR image URI for PH-OS',
      'Least-privilege policies attached to the ECS app task role before enabling AWS API-backed runtime features',
      'PHOS_ECS_SECRET_ARNS as comma-separated exact Secrets Manager ARNs',
      'PHOS_SECRETS_KMS_KEY_ARN',
      'PHOS_RATE_LIMIT_TABLE_ARN',
      'PHOS_EVIDENCE_BUCKET_NAME',
      'PHOS_EVIDENCE_KMS_KEY_ARN',
      'PHOS_SES_IDENTITY_ARN',
      `Untracked ECS Express input file at ${options.serviceInputPath}`,
    ],
    assumptions: [
      'All commands are generated only; this script never provisions AWS resources.',
      'The role-capable minimum uses one 256 CPU-unit / 512 MiB task and caps scaling at one task until production sizing is approved.',
      'Runtime secret values stay in Secrets Manager; the ECS service input contains only secret ARNs.',
      'Run live validation before any command marked MUTATES.',
    ],
    phases,
  };
}

export function formatEcsExpressPlanAsShell(plan: EcsExpressPlan): string {
  const lines = [
    '# PH-OS AWS ECS Express role-capable deployment plan',
    `# scenario: ${plan.scenario}`,
    `# region: ${plan.region}`,
    `# estimated_monthly_usd: ${plan.estimatedMonthlyUsd ?? 'unknown'}`,
    '',
    '# Required environment / external state:',
    ...plan.requiredEnvironment.map((item) => `# - ${item}`),
    '',
    '# Assumptions:',
    ...plan.assumptions.map((item) => `# - ${item}`),
  ];

  for (const phase of plan.phases) {
    lines.push('', `## ${phase.title}`);
    for (const item of phase.commands) {
      lines.push('', `# ${item.mutates ? 'MUTATES' : 'READS'} ${item.id}: ${item.description}`);
      lines.push(item.command);
    }
  }

  return lines.join('\n');
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const plan = createEcsExpressPlan(args.options);

  if (args.json) console.log(JSON.stringify(plan, null, 2));
  else console.log(formatEcsExpressPlanAsShell(plan));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
