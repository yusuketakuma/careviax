import { readFileSync } from 'node:fs';
import process from 'node:process';

type DeploymentCommand = {
  id: string;
  description: string;
  command: string;
  mutates: boolean;
};

type DeploymentPhase = {
  id: string;
  title: string;
  commands: DeploymentCommand[];
};

export type AwsPilotDeploymentPlanOptions = {
  region: string;
  prefix: string;
  availabilityZone: string;
  repositoryName: string;
  githubRepository: string;
  githubSubject: string;
  existingGithubOidcProviderArn?: string;
  ecrStackName: string;
  githubOidcStackName: string;
  lightsailStackName: string;
  databaseBundleId: string;
};

export type AwsPilotDeploymentPlan = {
  scenario: 'lightsail-pilot-encrypted-db';
  region: string;
  estimatedMonthlyUsd: number | null;
  requiredEnvironment: string[];
  assumptions: string[];
  phases: DeploymentPhase[];
};

type CliArgs = {
  json: boolean;
  shell: boolean;
  options: AwsPilotDeploymentPlanOptions;
};

export const DEFAULT_AWS_PILOT_DEPLOYMENT_PLAN_OPTIONS: AwsPilotDeploymentPlanOptions = {
  region: 'ap-northeast-1',
  prefix: 'ph-os-pilot',
  availabilityZone: 'ap-northeast-1a',
  repositoryName: 'ph-os/app',
  githubRepository: 'yusuketakuma/careviax',
  githubSubject: 'repo:yusuketakuma/careviax:environment:production',
  ecrStackName: 'ph-os-pilot-ecr',
  githubOidcStackName: 'ph-os-github-ecr-oidc',
  lightsailStackName: 'ph-os-pilot',
  databaseBundleId: 'small_2_0',
};

function readArgs(argv: string[]): CliArgs {
  const options = { ...DEFAULT_AWS_PILOT_DEPLOYMENT_PLAN_OPTIONS };
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
    else if (arg === '--prefix') {
      options.prefix = next();
      options.lightsailStackName = options.prefix;
    } else if (arg === '--availability-zone') options.availabilityZone = next();
    else if (arg === '--repository-name') options.repositoryName = next();
    else if (arg === '--github-repository') {
      options.githubRepository = next();
      options.githubSubject = `repo:${options.githubRepository}:environment:production`;
    } else if (arg === '--github-subject') options.githubSubject = next();
    else if (arg === '--existing-github-oidc-provider-arn') {
      options.existingGithubOidcProviderArn = next();
    } else if (arg === '--ecr-stack-name') options.ecrStackName = next();
    else if (arg === '--github-oidc-stack-name') options.githubOidcStackName = next();
    else if (arg === '--lightsail-stack-name') options.lightsailStackName = next();
    else if (arg === '--database-bundle-id') options.databaseBundleId = next();
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
  pnpm aws:pilot:plan
  pnpm aws:pilot:plan -- --shell
  pnpm aws:pilot:plan -- --json

Options:
  --region <region>                              Defaults to ap-northeast-1
  --prefix <name>                                Defaults to ph-os-pilot
  --availability-zone <az>                       Defaults to ap-northeast-1a
  --repository-name <name>                       Defaults to ph-os/app
  --github-repository <owner/repo>               Defaults to yusuketakuma/careviax
  --github-subject <sub>                         Defaults to repo:<owner/repo>:environment:production
  --existing-github-oidc-provider-arn <arn>      Reuse an existing GitHub OIDC provider
  --ecr-stack-name <name>                        Defaults to ph-os-pilot-ecr
  --github-oidc-stack-name <name>                Defaults to ph-os-github-ecr-oidc
  --lightsail-stack-name <name>                  Defaults to ph-os-pilot
  --database-bundle-id <id>                      Defaults to small_2_0
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
): DeploymentCommand {
  return {
    id,
    description,
    command: commandText,
    mutates,
  };
}

function readLightsailPilotEstimate(): number | null {
  try {
    const text = readFileSync('tools/aws-cost-minimal-scenarios.json', 'utf8');
    const parsed = JSON.parse(text) as {
      scenarios?: Array<{ id?: string; items?: Array<{ monthlyUsd?: number }> }>;
    };
    const scenario = parsed.scenarios?.find((item) => item.id === 'lightsail-pilot-encrypted-db');
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

function githubOidcParameterOverrides(options: AwsPilotDeploymentPlanOptions): string[] {
  const overrides = [
    `GitHubRepository=${options.githubRepository}`,
    `GitHubSubject=${options.githubSubject}`,
    `RepositoryName=${options.repositoryName}`,
  ];

  if (options.existingGithubOidcProviderArn) {
    overrides.push(`ExistingGitHubOidcProviderArn=${options.existingGithubOidcProviderArn}`);
  }

  return overrides;
}

export function createAwsPilotDeploymentPlan(
  options: AwsPilotDeploymentPlanOptions = DEFAULT_AWS_PILOT_DEPLOYMENT_PLAN_OPTIONS,
): AwsPilotDeploymentPlan {
  const ecrRepositoryUriQuery = shellSingleQuote(
    'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue | [0]',
  );
  const oidcRoleArnQuery = shellSingleQuote(
    'Stacks[0].Outputs[?OutputKey==`RoleArn`].OutputValue | [0]',
  );
  const staticIpQuery = shellSingleQuote(
    'Stacks[0].Outputs[?OutputKey==`StaticIpAddress`].OutputValue | [0]',
  );

  const phases: DeploymentPhase[] = [
    {
      id: 'local-preflight',
      title: 'Local and live-read AWS validation before any mutation',
      commands: [
        command(
          'cost-estimate',
          'Print the current low-cost AWS estimate.',
          'pnpm aws:cost:estimate',
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
          'github-oidc-template-live',
          'Validate the GitHub OIDC role template locally and with CloudFormation.',
          'pnpm aws:github-oidc:template:validate -- --live-aws --strict',
        ),
        command(
          'lightsail-template-live',
          'Validate the Lightsail pilot template locally and with CloudFormation.',
          'pnpm aws:lightsail:template:validate -- --live-aws --strict',
        ),
      ],
    },
    {
      id: 'foundation-stacks',
      title: 'Create the image repository and short-lived GitHub Actions role',
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
          'deploy-github-oidc-role',
          'Create or update the GitHub Actions OIDC role that can push only to the configured ECR repository.',
          [
            'aws cloudformation deploy',
            `  --region ${q(options.region)}`,
            `  --stack-name ${q(options.githubOidcStackName)}`,
            '  --template-file tools/infra/github-actions-ecr-oidc-role-template.yaml',
            '  --capabilities CAPABILITY_NAMED_IAM',
            '  --parameter-overrides',
            ...githubOidcParameterOverrides(options).map((item) => `    ${item}`),
          ].join(' \\\n'),
          true,
        ),
        command(
          'read-ecr-repository-uri',
          'Read the ECR repository URI for image tagging and workflow verification.',
          `aws cloudformation describe-stacks --region ${q(options.region)} --stack-name ${q(
            options.ecrStackName,
          )} --query ${ecrRepositoryUriQuery} --output text`,
        ),
        command(
          'read-github-role-arn',
          'Read the role ARN and store it as the GitHub production environment secret AWS_ROLE_TO_ASSUME.',
          `aws cloudformation describe-stacks --region ${q(options.region)} --stack-name ${q(
            options.githubOidcStackName,
          )} --query ${oidcRoleArnQuery} --output text`,
        ),
      ],
    },
    {
      id: 'image-publish',
      title: 'Build and publish the PH-OS image from GitHub Actions',
      commands: [
        command(
          'set-github-role-secret',
          'Set the workflow role ARN in the GitHub production environment before running the image workflow.',
          [
            `role_arn="$(aws cloudformation describe-stacks --region ${q(
              options.region,
            )} --stack-name ${q(options.githubOidcStackName)} --query ${oidcRoleArnQuery} --output text)"`,
            `gh secret set AWS_ROLE_TO_ASSUME --repo ${q(
              options.githubRepository,
            )} --env production --body "$role_arn"`,
          ].join('\n'),
          true,
        ),
        command(
          'run-image-workflow',
          'Trigger the manual image build/push workflow after setting production NEXT_PUBLIC inputs.',
          [
            'gh workflow run aws-container-image.yml',
            `  --repo ${q(options.githubRepository)}`,
            '  --ref main',
            `  -f aws_region=${options.region}`,
            `  -f ecr_repository=${options.repositoryName}`,
            '  -f image_tag=pilot',
            '  -f next_public_app_url=https://example.invalid',
            '  -f next_public_cognito_user_pool_id=ap-northeast-1_placeholder',
            '  -f next_public_cognito_client_id=placeholder-client-id',
          ].join(' \\\n'),
          true,
        ),
      ],
    },
    {
      id: 'lightsail-stack',
      title: 'Create the lowest-cost Lightsail pilot stack',
      commands: [
        command(
          'deploy-lightsail-pilot',
          'Create or update one Lightsail app instance, static IP, and non-public encrypted managed PostgreSQL database.',
          [
            'aws cloudformation deploy',
            `  --region ${q(options.region)}`,
            `  --stack-name ${q(options.lightsailStackName)}`,
            '  --template-file tools/infra/lightsail-pilot-template.yaml',
            '  --parameter-overrides',
            `    Prefix=${options.prefix}`,
            `    AvailabilityZone=${options.availabilityZone}`,
            '    InstanceBundleId="$PHOS_LIGHTSAIL_INSTANCE_BUNDLE_ID"',
            '    DatabaseBlueprintId="$PHOS_LIGHTSAIL_DB_BLUEPRINT_ID"',
            `    DatabaseBundleId=${options.databaseBundleId}`,
            '    MasterUserPassword="$PHOS_DB_MASTER_PASSWORD"',
          ].join(' \\\n'),
          true,
        ),
        command(
          'read-static-ip',
          'Read the pilot static IP for DNS, runtime start, and smoke checks.',
          `aws cloudformation describe-stacks --region ${q(options.region)} --stack-name ${q(
            options.lightsailStackName,
          )} --query ${staticIpQuery} --output text`,
        ),
        command(
          'lightsail-status',
          'Verify instance, static IP, database privacy, and public HTTP/HTTPS port state.',
          `pnpm aws:lightsail:status -- --strict --json --region ${q(options.region)} --prefix ${q(
            options.prefix,
          )}`,
        ),
      ],
    },
    {
      id: 'runtime-start',
      title: 'Start the approved image and prove public liveness',
      commands: [
        command(
          'validate-runtime-env',
          'Validate the untracked runtime env file before uploading secrets or starting the container.',
          'pnpm aws:lightsail:runtime-env:validate -- --env-file <UNTRACKED_ENV_FILE> --strict',
        ),
        command(
          'generate-runtime-plan',
          'Generate reviewed SSH commands for env upload, ECR login, container restart, and public health.',
          [
            'pnpm aws:lightsail:runtime:plan',
            '  -- --host <STATIC_IP_OR_DOMAIN>',
            '  --image <ECR_REPOSITORY_URI>:pilot',
            '  --env-file <UNTRACKED_ENV_FILE>',
            `  --region ${q(options.region)}`,
          ].join(' \\\n'),
        ),
        command(
          'public-health-smoke',
          'Prove the same public health endpoint users will hit.',
          'pnpm perf:smoke -- --base-url http://<STATIC_IP_OR_DOMAIN> --path /api/health --requests 5 --concurrency 1 --target-ms 5000',
        ),
      ],
    },
  ];

  return {
    scenario: 'lightsail-pilot-encrypted-db',
    region: options.region,
    estimatedMonthlyUsd: readLightsailPilotEstimate(),
    requiredEnvironment: [
      'AWS credentials or aws login session',
      'PHOS_LIGHTSAIL_INSTANCE_BUNDLE_ID',
      'PHOS_LIGHTSAIL_DB_BLUEPRINT_ID',
      'PHOS_DB_MASTER_PASSWORD',
      'GitHub CLI authenticated for yusuketakuma/careviax when using gh commands',
      'Approved untracked runtime env file based on tools/infra/lightsail-runtime-env.example',
    ],
    assumptions: [
      'All commands are generated only; this script never provisions AWS or GitHub resources.',
      'The pilot topology is single-instance and not high availability.',
      'Run the live validation phase before any command marked MUTATES.',
      'Replace placeholder NEXT_PUBLIC workflow inputs before publishing a real image.',
      'Lightsail is the lowest fixed-cost pilot path, but PH-OS runtimes that call DynamoDB, Secrets Manager, S3, or SES should use a role-capable runtime such as ECS/Fargate or an approved short-lived credential source.',
    ],
    phases,
  };
}

export function formatAwsPilotDeploymentPlanAsShell(plan: AwsPilotDeploymentPlan): string {
  const lines = [
    `# PH-OS AWS pilot deployment plan`,
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

function printText(plan: AwsPilotDeploymentPlan) {
  console.log(formatAwsPilotDeploymentPlanAsShell(plan));
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const plan = createAwsPilotDeploymentPlan(args.options);

  if (args.json) console.log(JSON.stringify(plan, null, 2));
  else printText(plan);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
