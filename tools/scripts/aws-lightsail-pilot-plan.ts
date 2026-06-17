type PlanCommand = {
  id: string;
  description: string;
  command: string;
  mutates: boolean;
};

export type PlanOptions = {
  region: string;
  availabilityZone: string;
  prefix: string;
  instanceName: string;
  staticIpName: string;
  databaseName: string;
  masterDatabaseName: string;
  masterUsername: string;
  instanceBlueprintId: string;
  instanceBundleIdEnv: string;
  databaseBlueprintIdEnv: string;
  databaseBundleId: string;
  containerImageEnv: string;
  userDataPath: string;
};

type CliArgs = {
  json: boolean;
  shell: boolean;
  options: PlanOptions;
};

export type LightsailPilotPlan = {
  scenario: 'lightsail-pilot-encrypted-db';
  region: string;
  estimatedMonthlyUsd: number;
  requiredEnvironment: string[];
  discoveryCommands: PlanCommand[];
  provisioningCommands: PlanCommand[];
  postProvisionCommands: PlanCommand[];
  warnings: string[];
};

export const DEFAULT_LIGHTSAIL_PILOT_OPTIONS: PlanOptions = {
  region: 'ap-northeast-1',
  availabilityZone: 'ap-northeast-1a',
  prefix: 'ph-os-pilot',
  instanceName: 'ph-os-pilot-app',
  staticIpName: 'ph-os-pilot-ip',
  databaseName: 'ph-os-pilot-db',
  masterDatabaseName: 'ph_os',
  masterUsername: 'phosadmin',
  instanceBlueprintId: 'amazon_linux_2023',
  instanceBundleIdEnv: 'PHOS_LIGHTSAIL_INSTANCE_BUNDLE_ID',
  databaseBlueprintIdEnv: 'PHOS_LIGHTSAIL_DB_BLUEPRINT_ID',
  databaseBundleId: 'small_2_0',
  containerImageEnv: 'PHOS_CONTAINER_IMAGE',
  userDataPath: 'tools/infra/lightsail-pilot-user-data.sh',
};

function readArgs(argv: string[]): CliArgs {
  const options = { ...DEFAULT_LIGHTSAIL_PILOT_OPTIONS };
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
    else if (arg === '--availability-zone') options.availabilityZone = next();
    else if (arg === '--prefix') {
      options.prefix = next();
      options.instanceName = `${options.prefix}-app`;
      options.staticIpName = `${options.prefix}-ip`;
      options.databaseName = `${options.prefix}-db`;
    } else if (arg === '--instance-name') options.instanceName = next();
    else if (arg === '--static-ip-name') options.staticIpName = next();
    else if (arg === '--database-name') options.databaseName = next();
    else if (arg === '--database-bundle-id') options.databaseBundleId = next();
    else if (arg === '--instance-blueprint-id') options.instanceBlueprintId = next();
    else if (arg === '--user-data-path') options.userDataPath = next();
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
  pnpm aws:lightsail:plan
  pnpm aws:lightsail:plan -- --shell
  pnpm aws:lightsail:plan -- --json

Options:
  --region <region>                 Defaults to ap-northeast-1
  --availability-zone <az>           Defaults to ap-northeast-1a
  --prefix <name>                    Defaults to ph-os-pilot
  --instance-name <name>             Defaults to <prefix>-app
  --static-ip-name <name>            Defaults to <prefix>-ip
  --database-name <name>             Defaults to <prefix>-db
  --instance-blueprint-id <id>       Defaults to amazon_linux_2023
  --database-bundle-id <id>          Defaults to small_2_0
  --user-data-path <path>            Defaults to tools/infra/lightsail-pilot-user-data.sh
  --shell                            Print copyable shell plan
  --json                             Print machine-readable JSON
`);
}

function q(value: string): string {
  return JSON.stringify(value);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function envRef(name: string): string {
  return `"${'$'}{${name}}"`;
}

function command(
  id: string,
  description: string,
  commandText: string,
  mutates = false,
): PlanCommand {
  return {
    id,
    description,
    command: commandText,
    mutates,
  };
}

function tagArgs(options: PlanOptions): string {
  return [
    `key=Project,value=ph-os`,
    `key=Environment,value=pilot`,
    `key=ManagedBy,value=codex-plan`,
    `key=Name,value=${options.prefix}`,
  ].join(' ');
}

export function createLightsailPilotPlan(
  options: PlanOptions = DEFAULT_LIGHTSAIL_PILOT_OPTIONS,
): LightsailPilotPlan {
  const tags = tagArgs(options);
  const active = '`true`';
  const amazonLinux = '`amazon_linux`';
  const postgres = '`postgres`';
  const dbBundleId = `\`${options.databaseBundleId}\``;

  const discoveryCommands = [
    command(
      'discover-instance-blueprints',
      'List active Amazon Linux Lightsail blueprints before creating the instance.',
      `aws lightsail get-blueprints --region ${q(options.region)} --query ${shellSingleQuote(
        `blueprints[?contains(blueprintId, ${amazonLinux}) && isActive==${active}].[blueprintId,name]`,
      )} --output table`,
    ),
    command(
      'discover-instance-bundles',
      'List active Lightsail instance bundles and choose the smallest bundle that can run the app.',
      `aws lightsail get-bundles --region ${q(options.region)} --query ${shellSingleQuote(
        `bundles[?isActive==${active}].[bundleId,name,price,ramSizeInGb,cpuCount]`,
      )} --output table`,
    ),
    command(
      'discover-db-blueprints',
      'List PostgreSQL database blueprint IDs before creating the database.',
      `aws lightsail get-relational-database-blueprints --region ${q(
        options.region,
      )} --query ${shellSingleQuote(
        `blueprints[?engine==${postgres}].[blueprintId,engineVersion,isEngineDefault]`,
      )} --output table`,
    ),
    command(
      'discover-db-bundles',
      'Confirm the selected database bundle is active and encrypted.',
      `aws lightsail get-relational-database-bundles --region ${q(
        options.region,
      )} --query ${shellSingleQuote(
        `bundles[?bundleId==${dbBundleId}].[bundleId,name,price,ramSizeInGb,isEncrypted,isActive]`,
      )} --output table`,
    ),
  ];

  const provisioningCommands = [
    command(
      'create-database',
      'Create the encrypted Lightsail PostgreSQL database. The default small_2_0 bundle is the $30/month encrypted 2 GB plan shown in current AWS CLI examples.',
      [
        `aws lightsail create-relational-database`,
        `  --region ${q(options.region)}`,
        `  --relational-database-name ${q(options.databaseName)}`,
        `  --availability-zone ${q(options.availabilityZone)}`,
        `  --relational-database-blueprint-id ${envRef(options.databaseBlueprintIdEnv)}`,
        `  --relational-database-bundle-id ${q(options.databaseBundleId)}`,
        `  --master-database-name ${q(options.masterDatabaseName)}`,
        `  --master-username ${q(options.masterUsername)}`,
        `  --master-user-password "$PHOS_DB_MASTER_PASSWORD"`,
        `  --no-publicly-accessible`,
        `  --preferred-backup-window "17:00-17:30"`,
        `  --preferred-maintenance-window "sun:18:00-sun:18:30"`,
        `  --tags ${tags}`,
      ].join(' \\\n'),
      true,
    ),
    command(
      'create-instance',
      'Create the single pilot app instance. User data installs Docker only; app secrets are configured after creation.',
      [
        `aws lightsail create-instances`,
        `  --region ${q(options.region)}`,
        `  --instance-names ${q(options.instanceName)}`,
        `  --availability-zone ${q(options.availabilityZone)}`,
        `  --blueprint-id ${q(options.instanceBlueprintId)}`,
        `  --bundle-id ${envRef(options.instanceBundleIdEnv)}`,
        `  --user-data file://${options.userDataPath}`,
        `  --ip-address-type dualstack`,
        `  --tags ${tags}`,
      ].join(' \\\n'),
      true,
    ),
    command(
      'allocate-static-ip',
      'Allocate a stable public IP address for DNS cutover.',
      `aws lightsail allocate-static-ip --region ${q(options.region)} --static-ip-name ${q(
        options.staticIpName,
      )}`,
      true,
    ),
    command(
      'attach-static-ip',
      'Attach the static IP to the app instance.',
      `aws lightsail attach-static-ip --region ${q(options.region)} --static-ip-name ${q(
        options.staticIpName,
      )} --instance-name ${q(options.instanceName)}`,
      true,
    ),
    command(
      'open-http',
      'Open HTTP for first health check and certificate bootstrap.',
      `aws lightsail open-instance-public-ports --region ${q(options.region)} --instance-name ${q(
        options.instanceName,
      )} --port-info fromPort=80,toPort=80,protocol=tcp,cidrs=0.0.0.0/0,ipv6Cidrs=::/0`,
      true,
    ),
    command(
      'open-https',
      'Open HTTPS for production traffic.',
      `aws lightsail open-instance-public-ports --region ${q(options.region)} --instance-name ${q(
        options.instanceName,
      )} --port-info fromPort=443,toPort=443,protocol=tcp,cidrs=0.0.0.0/0,ipv6Cidrs=::/0`,
      true,
    ),
  ];

  const postProvisionCommands = [
    command(
      'get-database-endpoint',
      'Read the private database endpoint for DATABASE_URL construction.',
      `aws lightsail get-relational-database --region ${q(
        options.region,
      )} --relational-database-name ${q(
        options.databaseName,
      )} --query ${shellSingleQuote('relationalDatabase.masterEndpoint.address')} --output text`,
    ),
    command(
      'ssh-configure-runtime',
      'SSH to the instance, write /opt/phos/.env from approved secrets, pull the image, and start the container.',
      [
        `ssh ec2-user@<STATIC_IP>`,
        `# On the instance:`,
        `sudo install -d -m 0700 /opt/phos`,
        `sudo tee /opt/phos/.env >/dev/null <<'PHOS_ENV'`,
        `APP_ENV=production`,
        `NEXT_PUBLIC_APP_ENV=production`,
        `AWS_REGION=${options.region}`,
        `DATABASE_URL=postgresql://${options.masterUsername}:<PASSWORD>@<DB_ENDPOINT>:5432/${options.masterDatabaseName}?sslmode=require`,
        `DIRECT_URL=postgresql://${options.masterUsername}:<PASSWORD>@<DB_ENDPOINT>:5432/${options.masterDatabaseName}?sslmode=require`,
        `NEXTAUTH_URL=https://<DOMAIN>`,
        `NEXT_PUBLIC_APP_URL=https://<DOMAIN>`,
        `TRUST_PROXY_HEADERS=false`,
        `PHOS_DISABLE_LEGACY_FILE_API=1`,
        `RATE_LIMIT_STORE=dynamodb`,
        `RATE_LIMIT_DDB_TABLE_NAME=ph-os-rate-limit`,
        `PHOS_ENV`,
        `sudo docker run -d --restart unless-stopped --name ph-os --env-file /opt/phos/.env -p 80:3000 ${envRef(
          options.containerImageEnv,
        )}`,
      ].join('\n'),
      true,
    ),
  ];

  return {
    scenario: 'lightsail-pilot-encrypted-db',
    region: options.region,
    estimatedMonthlyUsd: 46.6,
    requiredEnvironment: [
      options.instanceBundleIdEnv,
      options.databaseBlueprintIdEnv,
      'PHOS_DB_MASTER_PASSWORD',
      options.containerImageEnv,
    ],
    discoveryCommands,
    provisioningCommands,
    postProvisionCommands,
    warnings: [
      'Provisioning commands are mutating and will create billable AWS resources.',
      'Run pnpm aws:deploy:readiness -- --live-aws before executing any mutating command.',
      'Do not run this pilot topology for HA production; it is intentionally single-instance and low-cost.',
      'Do not put PHI into the pilot until S3 Object Lock, backups, audit trails, and approved production secrets are configured.',
      'Keep the database non-public. The create command uses --no-publicly-accessible.',
    ],
  };
}

function printShell(plan: LightsailPilotPlan) {
  console.log(`# PH-OS Lightsail pilot plan (${plan.region})`);
  console.log(`# Estimated monthly cost: $${plan.estimatedMonthlyUsd.toFixed(2)}`);
  console.log(`# Required environment: ${plan.requiredEnvironment.join(', ')}`);
  console.log('');
  for (const warning of plan.warnings) {
    console.log(`# WARNING: ${warning}`);
  }
  console.log('');
  console.log('set -euo pipefail');
  console.log('');
  console.log('# 1. Discovery commands');
  for (const item of plan.discoveryCommands) {
    console.log(`\n# ${item.id}: ${item.description}`);
    console.log(item.command);
  }
  console.log('');
  console.log('# 2. Mutating provisioning commands. Review before running.');
  for (const item of plan.provisioningCommands) {
    console.log(`\n# MUTATES ${item.id}: ${item.description}`);
    console.log(item.command);
  }
  console.log('');
  console.log('# 3. Post-provision runtime configuration');
  for (const item of plan.postProvisionCommands) {
    console.log(`\n# ${item.id}: ${item.description}`);
    console.log(item.command);
  }
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const plan = createLightsailPilotPlan(args.options);

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
