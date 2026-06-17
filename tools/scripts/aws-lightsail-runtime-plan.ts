import process from 'node:process';

type RuntimeCommand = {
  id: string;
  description: string;
  command: string;
  mutates: boolean;
};

export type LightsailRuntimePlan = {
  host: string;
  sshUser: string;
  image: string;
  envFile: string;
  commands: RuntimeCommand[];
  warnings: string[];
};

type CliArgs = {
  json: boolean;
  shell: boolean;
  host: string;
  sshUser: string;
  image: string;
  envFile: string;
  region: string;
};

const DEFAULT_HOST = '<STATIC_IP_OR_DOMAIN>';
const DEFAULT_IMAGE = '${PHOS_CONTAINER_IMAGE}';
const DEFAULT_ENV_FILE = '.env.production.aws';

function readArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    json: false,
    shell: false,
    host: DEFAULT_HOST,
    sshUser: 'ec2-user',
    image: process.env.PHOS_CONTAINER_IMAGE ?? DEFAULT_IMAGE,
    envFile: DEFAULT_ENV_FILE,
    region: process.env.AWS_REGION ?? 'ap-northeast-1',
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
    else if (arg === '--host') args.host = next();
    else if (arg === '--ssh-user') args.sshUser = next();
    else if (arg === '--image') args.image = next();
    else if (arg === '--env-file') args.envFile = next();
    else if (arg === '--region') args.region = next();
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
  pnpm aws:lightsail:runtime:plan
  pnpm aws:lightsail:runtime:plan -- --host <STATIC_IP_OR_DOMAIN> --image <IMAGE> --env-file <UNTRACKED_ENV_FILE>
  pnpm aws:lightsail:runtime:plan -- --json

Options:
  --host <host>       Static IP or domain. Defaults to <STATIC_IP_OR_DOMAIN>
  --ssh-user <user>   Defaults to ec2-user for Amazon Linux 2023
  --image <image>     Container image to run. Defaults to PHOS_CONTAINER_IMAGE or placeholder
  --env-file <path>   Local untracked runtime env file. Defaults to .env.production.aws
  --region <region>   AWS region for optional ECR login. Defaults to AWS_REGION or ap-northeast-1
  --shell             Print copyable shell plan
  --json              Print machine-readable JSON
`);
}

function q(value: string): string {
  return JSON.stringify(value);
}

function command(
  id: string,
  description: string,
  commandText: string,
  mutates = false,
): RuntimeCommand {
  return {
    id,
    description,
    command: commandText,
    mutates,
  };
}

export function createLightsailRuntimePlan(input: {
  host?: string;
  sshUser?: string;
  image?: string;
  envFile?: string;
  region?: string;
}): LightsailRuntimePlan {
  const host = input.host ?? DEFAULT_HOST;
  const sshUser = input.sshUser ?? 'ec2-user';
  const image = input.image ?? DEFAULT_IMAGE;
  const envFile = input.envFile ?? DEFAULT_ENV_FILE;
  const region = input.region ?? process.env.AWS_REGION ?? 'ap-northeast-1';
  const target = `${sshUser}@${host}`;
  const registry = image.split('/')[0] ?? '';
  const isPrivateEcrImage = /\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com$/.test(registry);
  const remoteScript = [
    'set -euo pipefail',
    `IMAGE=${q(image)}`,
    'sudo install -d -m 0700 /opt/phos',
    'sudo install -m 0600 /tmp/phos.env /opt/phos/.env',
    'rm -f /tmp/phos.env',
    'sudo docker pull "$IMAGE"',
    'sudo docker rm -f ph-os 2>/dev/null || true',
    [
      'sudo docker run -d',
      '--restart unless-stopped',
      '--name ph-os',
      '--env-file /opt/phos/.env',
      '-p 80:3000',
      '"$IMAGE"',
    ].join(' '),
    'for attempt in $(seq 1 30); do curl -fsS http://127.0.0.1/api/health && exit 0; sleep 2; done',
    'sudo docker logs --tail 100 ph-os',
    'exit 1',
  ].join('\n');

  const commands: RuntimeCommand[] = [
    command(
      'prepare-env',
      'Create an untracked runtime env file from the example and fill it from approved secrets.',
      `test ! -e ${q(envFile)} || { echo ${q(
        `${envFile} already exists; refusing to overwrite secrets.`,
      )}; exit 1; }\ncp tools/infra/lightsail-runtime-env.example ${q(envFile)}\nchmod 0600 ${q(envFile)}\n# Edit ${envFile}; do not commit it.`,
      true,
    ),
    command(
      'validate-env',
      'Validate the untracked runtime env file before uploading secrets or starting the container.',
      `pnpm aws:lightsail:runtime-env:validate -- --env-file ${q(envFile)} --strict`,
    ),
    command(
      'copy-env',
      'Upload the untracked runtime env file to the Lightsail instance without printing secret values.',
      `scp -p ${q(envFile)} ${q(`${target}:/tmp/phos.env`)}`,
      true,
    ),
    ...(isPrivateEcrImage
      ? [
          command(
            'ecr-docker-login',
            'Authenticate Docker on the Lightsail host to the private ECR registry using a short-lived password.',
            `aws ecr get-login-password --region ${q(region)} | ssh ${q(
              target,
            )} ${q(`sudo docker login --username AWS --password-stdin ${registry}`)}`,
            true,
          ),
        ]
      : []),
    command(
      'start-container',
      'Install the env file, pull the approved image, restart the PH-OS container, and run local health.',
      `ssh ${q(target)} 'bash -s' <<'PHOS_REMOTE'\n${remoteScript}\nPHOS_REMOTE`,
      true,
    ),
    command(
      'public-health',
      'Verify the public health endpoint through the static IP or domain.',
      `pnpm perf:smoke -- --base-url ${q(`http://${host}`)} --path /api/health --requests 5 --concurrency 1 --target-ms 5000`,
    ),
  ];

  return {
    host,
    sshUser,
    image,
    envFile,
    commands,
    warnings: [
      'This plan is non-executing; review every MUTATES command before running it.',
      'The env file contains secrets. Keep it untracked, chmod 0600, and upload it only to the approved host.',
      'Do not store long-lived AWS access keys on the Lightsail instance.',
      isPrivateEcrImage
        ? 'Private ECR image detected; run the generated ecr-docker-login command before start-container.'
        : 'For private registries, authenticate Docker on the host using the registry-approved short-lived mechanism before start-container.',
    ],
  };
}

function printShell(plan: LightsailRuntimePlan) {
  console.log(`# PH-OS Lightsail runtime plan (${plan.host})`);
  console.log(`# ssh user: ${plan.sshUser}`);
  console.log(`# image: ${plan.image}`);
  console.log(`# env file: ${plan.envFile}`);
  console.log('');
  for (const warning of plan.warnings) {
    console.log(`# WARNING: ${warning}`);
  }
  console.log('');
  console.log('set -euo pipefail');

  for (const item of plan.commands) {
    console.log('');
    console.log(`# ${item.mutates ? 'MUTATES ' : ''}${item.id}: ${item.description}`);
    console.log(item.command);
  }
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const plan = createLightsailRuntimePlan(args);

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  printShell(plan);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
