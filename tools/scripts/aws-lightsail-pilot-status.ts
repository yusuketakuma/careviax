import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { DEFAULT_LIGHTSAIL_PILOT_OPTIONS, type PlanOptions } from './aws-lightsail-pilot-plan';

type CheckStatus = 'pass' | 'warn' | 'fail';
type AwsErrorKind = 'missing' | 'auth' | 'other';

type AwsError = {
  kind: AwsErrorKind;
  message: string;
};

type CommandResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: AwsError;
    };

export type SanitizedInstance = {
  name?: string;
  state?: string;
  publicIpAddress?: string;
  privateIpAddress?: string;
  isStaticIp?: boolean;
  blueprintId?: string;
  bundleId?: string;
  availabilityZone?: string;
};

export type SanitizedStaticIp = {
  name?: string;
  ipAddress?: string;
  isAttached?: boolean;
  attachedTo?: string;
};

export type SanitizedDatabase = {
  name?: string;
  state?: string;
  publiclyAccessible?: boolean;
  bundleId?: string;
  blueprintId?: string;
  endpointAddress?: string;
  endpointPort?: number;
};

export type SanitizedPortState = {
  fromPort?: number;
  toPort?: number;
  protocol?: string;
  state?: string;
};

export type LightsailPilotStatusInput = {
  region: string;
  instanceName: string;
  staticIpName: string;
  databaseName: string;
  instance: CommandResult<SanitizedInstance>;
  staticIp: CommandResult<SanitizedStaticIp>;
  database: CommandResult<SanitizedDatabase>;
  portStates: CommandResult<SanitizedPortState[]>;
};

export type StatusCheck = {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
  remediation?: string;
};

export type LightsailPilotStatusReport = {
  generatedAt: string;
  region: string;
  resourceNames: {
    instance: string;
    staticIp: string;
    database: string;
  };
  summary: Record<CheckStatus, number>;
  checks: StatusCheck[];
};

type CliArgs = {
  json: boolean;
  strict: boolean;
  options: PlanOptions;
};

function readArgs(argv: string[]): CliArgs {
  const options = { ...DEFAULT_LIGHTSAIL_PILOT_OPTIONS };
  const args: CliArgs = {
    json: false,
    strict: false,
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
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--region') options.region = next();
    else if (arg === '--prefix') {
      options.prefix = next();
      options.instanceName = `${options.prefix}-app`;
      options.staticIpName = `${options.prefix}-ip`;
      options.databaseName = `${options.prefix}-db`;
    } else if (arg === '--instance-name') options.instanceName = next();
    else if (arg === '--static-ip-name') options.staticIpName = next();
    else if (arg === '--database-name') options.databaseName = next();
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
  pnpm aws:lightsail:status
  pnpm aws:lightsail:status -- --json
  pnpm aws:lightsail:status -- --strict

Options:
  --region <region>          Defaults to ap-northeast-1
  --prefix <name>            Defaults to ph-os-pilot
  --instance-name <name>     Defaults to <prefix>-app
  --static-ip-name <name>    Defaults to <prefix>-ip
  --database-name <name>     Defaults to <prefix>-db
  --strict                   Exit non-zero on any warning or failure
  --json                     Print machine-readable JSON
`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordProp(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const prop = value[key];
  return isRecord(prop) ? prop : {};
}

function stringProp(value: Record<string, unknown>, key: string): string | undefined {
  const prop = value[key];
  return typeof prop === 'string' && prop.trim() !== '' ? prop : undefined;
}

function booleanProp(value: Record<string, unknown>, key: string): boolean | undefined {
  const prop = value[key];
  return typeof prop === 'boolean' ? prop : undefined;
}

function numberProp(value: Record<string, unknown>, key: string): number | undefined {
  const prop = value[key];
  return typeof prop === 'number' && Number.isFinite(prop) ? prop : undefined;
}

function classifyAwsError(error: unknown): AwsError {
  const candidate = error as { stderr?: unknown; message?: unknown };
  const stderr =
    typeof candidate.stderr === 'string'
      ? candidate.stderr
      : Buffer.isBuffer(candidate.stderr)
        ? candidate.stderr.toString('utf8')
        : '';
  const message = stderr.trim() || (typeof candidate.message === 'string' ? candidate.message : '');
  const normalized = message || 'AWS CLI command failed';

  if (
    /NoCredentials|Unable to locate credentials|ExpiredToken|InvalidClientTokenId|AccessDenied/i.test(
      normalized,
    )
  ) {
    return { kind: 'auth', message: normalized };
  }
  if (/NotFound|not found|does not exist|cannot be found/i.test(normalized)) {
    return { kind: 'missing', message: normalized };
  }

  return { kind: 'other', message: normalized };
}

function awsJson(args: string[]): CommandResult<unknown> {
  try {
    const stdout = execFileSync('aws', [...args, '--output', 'json', '--no-cli-pager'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        AWS_PAGER: '',
        AWS_REGION: process.env.AWS_REGION ?? 'ap-northeast-1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, data: JSON.parse(stdout) };
  } catch (error) {
    return { ok: false, error: classifyAwsError(error) };
  }
}

function mapResult<T>(
  result: CommandResult<unknown>,
  mapper: (value: unknown) => T,
): CommandResult<T> {
  return result.ok ? { ok: true, data: mapper(result.data) } : result;
}

function sanitizeInstance(value: unknown): SanitizedInstance {
  const root = isRecord(value) ? value : {};
  const instance = recordProp(root, 'instance');
  const state = recordProp(instance, 'state');
  const location = recordProp(instance, 'location');

  return {
    name: stringProp(instance, 'name'),
    state: stringProp(state, 'name'),
    publicIpAddress: stringProp(instance, 'publicIpAddress'),
    privateIpAddress: stringProp(instance, 'privateIpAddress'),
    isStaticIp: booleanProp(instance, 'isStaticIp'),
    blueprintId: stringProp(instance, 'blueprintId'),
    bundleId: stringProp(instance, 'bundleId'),
    availabilityZone: stringProp(location, 'availabilityZone'),
  };
}

function sanitizeStaticIp(value: unknown): SanitizedStaticIp {
  const root = isRecord(value) ? value : {};
  const staticIp = recordProp(root, 'staticIp');

  return {
    name: stringProp(staticIp, 'name'),
    ipAddress: stringProp(staticIp, 'ipAddress'),
    isAttached: booleanProp(staticIp, 'isAttached'),
    attachedTo: stringProp(staticIp, 'attachedTo'),
  };
}

function sanitizeDatabase(value: unknown): SanitizedDatabase {
  const root = isRecord(value) ? value : {};
  const database = recordProp(root, 'relationalDatabase');
  const endpoint = recordProp(database, 'masterEndpoint');

  return {
    name: stringProp(database, 'name'),
    state: stringProp(database, 'state'),
    publiclyAccessible: booleanProp(database, 'publiclyAccessible'),
    bundleId: stringProp(database, 'relationalDatabaseBundleId'),
    blueprintId: stringProp(database, 'relationalDatabaseBlueprintId'),
    endpointAddress: stringProp(endpoint, 'address'),
    endpointPort: numberProp(endpoint, 'port'),
  };
}

function sanitizePortStates(value: unknown): SanitizedPortState[] {
  const root = isRecord(value) ? value : {};
  const portStates = root.portStates;
  if (!Array.isArray(portStates)) return [];

  return portStates.filter(isRecord).map((portState) => ({
    fromPort: numberProp(portState, 'fromPort'),
    toPort: numberProp(portState, 'toPort'),
    protocol: stringProp(portState, 'protocol'),
    state: stringProp(portState, 'state'),
  }));
}

function add(
  checks: StatusCheck[],
  status: CheckStatus,
  name: string,
  message: string,
  detail?: string,
  remediation?: string,
) {
  checks.push({ name, status, message, detail, remediation });
}

function errorStatus(error: AwsError): CheckStatus {
  return error.kind === 'auth' || error.kind === 'other' ? 'fail' : 'warn';
}

function errorRemediation(error: AwsError, resourceName: string): string {
  if (error.kind === 'auth') return 'Configure AWS credentials and rerun the status check.';
  if (error.kind === 'missing')
    return `Create ${resourceName} with pnpm aws:lightsail:plan output.`;
  return 'Inspect the AWS CLI error and rerun after resolving the account or service issue.';
}

function hasOpenTcpPort(ports: SanitizedPortState[], port: number): boolean {
  return ports.some(
    (item) =>
      item.protocol === 'tcp' &&
      item.fromPort === port &&
      item.toPort === port &&
      item.state === 'open',
  );
}

export function evaluateLightsailPilotStatus(
  input: LightsailPilotStatusInput,
  now = new Date(),
): LightsailPilotStatusReport {
  const checks: StatusCheck[] = [];

  if (input.instance.ok) {
    const instance = input.instance.data;
    const running = instance.state === 'running';
    add(
      checks,
      running ? 'pass' : 'warn',
      'instance',
      running
        ? `Instance ${input.instanceName} is running.`
        : `Instance ${input.instanceName} is present but state is ${instance.state ?? 'unknown'}.`,
      `blueprint=${instance.blueprintId ?? 'unknown'}, bundle=${instance.bundleId ?? 'unknown'}, staticIp=${String(
        instance.isStaticIp,
      )}`,
      running ? undefined : 'Wait for provisioning to finish or inspect the instance events.',
    );
  } else {
    add(
      checks,
      errorStatus(input.instance.error),
      'instance',
      `Instance ${input.instanceName} could not be read: ${input.instance.error.message}`,
      undefined,
      errorRemediation(input.instance.error, input.instanceName),
    );
  }

  if (input.staticIp.ok) {
    const staticIp = input.staticIp.data;
    const attached = staticIp.isAttached === true && staticIp.attachedTo === input.instanceName;
    add(
      checks,
      attached ? 'pass' : 'warn',
      'static-ip',
      attached
        ? `Static IP ${input.staticIpName} is attached to ${input.instanceName}.`
        : `Static IP ${input.staticIpName} is not attached to ${input.instanceName}.`,
      `ip=${staticIp.ipAddress ?? 'unknown'}, attachedTo=${staticIp.attachedTo ?? 'none'}`,
      attached ? undefined : 'Attach the static IP before DNS cutover.',
    );
  } else {
    add(
      checks,
      errorStatus(input.staticIp.error),
      'static-ip',
      `Static IP ${input.staticIpName} could not be read: ${input.staticIp.error.message}`,
      undefined,
      errorRemediation(input.staticIp.error, input.staticIpName),
    );
  }

  if (input.database.ok) {
    const database = input.database.data;
    const available = database.state === 'available';
    const privateDb = database.publiclyAccessible === false;
    add(
      checks,
      available && privateDb ? 'pass' : privateDb ? 'warn' : 'fail',
      'database',
      available && privateDb
        ? `Database ${input.databaseName} is available and non-public.`
        : `Database ${input.databaseName} state/public access is not production-ready.`,
      `state=${database.state ?? 'unknown'}, publiclyAccessible=${String(
        database.publiclyAccessible,
      )}, bundle=${database.bundleId ?? 'unknown'}, endpoint=${database.endpointAddress ?? 'unknown'}:${
        database.endpointPort ?? 'unknown'
      }`,
      available && privateDb
        ? undefined
        : 'Keep the database non-public and wait for the database state to become available.',
    );
  } else {
    add(
      checks,
      errorStatus(input.database.error),
      'database',
      `Database ${input.databaseName} could not be read: ${input.database.error.message}`,
      undefined,
      errorRemediation(input.database.error, input.databaseName),
    );
  }

  if (input.portStates.ok) {
    const ports = input.portStates.data;
    const httpOpen = hasOpenTcpPort(ports, 80);
    const httpsOpen = hasOpenTcpPort(ports, 443);
    add(
      checks,
      httpOpen && httpsOpen ? 'pass' : 'warn',
      'public-ports',
      httpOpen && httpsOpen
        ? 'HTTP and HTTPS are open on the pilot instance.'
        : 'HTTP and HTTPS are not both open on the pilot instance.',
      `http=${httpOpen ? 'open' : 'not-open'}, https=${httpsOpen ? 'open' : 'not-open'}`,
      httpOpen && httpsOpen
        ? undefined
        : 'Run the generated open-instance-public-ports commands before public smoke tests.',
    );
  } else {
    add(
      checks,
      errorStatus(input.portStates.error),
      'public-ports',
      `Instance port states could not be read: ${input.portStates.error.message}`,
      undefined,
      errorRemediation(input.portStates.error, input.instanceName),
    );
  }

  const summary = checks.reduce<Record<CheckStatus, number>>(
    (counts, check) => {
      counts[check.status] += 1;
      return counts;
    },
    { pass: 0, warn: 0, fail: 0 },
  );

  return {
    generatedAt: now.toISOString(),
    region: input.region,
    resourceNames: {
      instance: input.instanceName,
      staticIp: input.staticIpName,
      database: input.databaseName,
    },
    summary,
    checks,
  };
}

export function collectLightsailPilotStatus(options: PlanOptions): LightsailPilotStatusInput {
  const regionArgs = ['--region', options.region];

  return {
    region: options.region,
    instanceName: options.instanceName,
    staticIpName: options.staticIpName,
    databaseName: options.databaseName,
    instance: mapResult(
      awsJson([
        'lightsail',
        'get-instance',
        ...regionArgs,
        '--instance-name',
        options.instanceName,
      ]),
      sanitizeInstance,
    ),
    staticIp: mapResult(
      awsJson([
        'lightsail',
        'get-static-ip',
        ...regionArgs,
        '--static-ip-name',
        options.staticIpName,
      ]),
      sanitizeStaticIp,
    ),
    database: mapResult(
      awsJson([
        'lightsail',
        'get-relational-database',
        ...regionArgs,
        '--relational-database-name',
        options.databaseName,
      ]),
      sanitizeDatabase,
    ),
    portStates: mapResult(
      awsJson([
        'lightsail',
        'get-instance-port-states',
        ...regionArgs,
        '--instance-name',
        options.instanceName,
      ]),
      sanitizePortStates,
    ),
  };
}

function printText(report: LightsailPilotStatusReport) {
  console.log(`# PH-OS Lightsail pilot status (${report.generatedAt})`);
  console.log(`region: ${report.region}`);
  console.log(
    `resources: instance=${report.resourceNames.instance}, staticIp=${report.resourceNames.staticIp}, database=${report.resourceNames.database}`,
  );
  console.log(
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
  );

  for (const check of report.checks) {
    console.log(`- [${check.status.toUpperCase()}] ${check.name}: ${check.message}`);
    if (check.detail) console.log(`  detail: ${check.detail}`);
    if (check.remediation) console.log(`  fix: ${check.remediation}`);
  }
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const report = evaluateLightsailPilotStatus(collectLightsailPilotStatus(args.options));

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printText(report);

  const shouldFail = args.strict && (report.summary.fail > 0 || report.summary.warn > 0);
  if (shouldFail) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
