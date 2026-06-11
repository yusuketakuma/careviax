import { signAwsJsonRequest, type AwsCredentials } from '@/lib/aws/sigv4';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

type DynamoAttributeValue = { S?: string; N?: string; BOOL?: boolean };

type DynamoResponse = {
  Table?: {
    TableStatus?: string;
    KeySchema?: Array<{ AttributeName?: string; KeyType?: string }>;
    AttributeDefinitions?: Array<{ AttributeName?: string; AttributeType?: string }>;
    BillingModeSummary?: { BillingMode?: string };
    SSEDescription?: { Status?: string };
  };
  TimeToLiveDescription?: {
    AttributeName?: string;
    TimeToLiveStatus?: string;
  };
  Attributes?: Record<string, DynamoAttributeValue>;
};

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

const WRITE_OPT_IN_ENV = 'RATE_LIMIT_DDB_VERIFY_WRITE';
const DEFAULT_DDB_VERIFY_TIMEOUT_MS = 5_000;
const MAX_DDB_VERIFY_TIMEOUT_MS = 30_000;

function requireEnv(env: Env, name: string) {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

function normalizePositiveInteger(
  value: string | undefined,
  options: {
    fallback: number;
    max: number;
  },
) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return options.fallback;
  return Math.min(parsed, options.max);
}

function maybeUnrefTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
}

function resolveDynamoVerifyTimeoutMs(env: Env) {
  return normalizePositiveInteger(
    env.RATE_LIMIT_DDB_VERIFY_TIMEOUT_MS ?? env.PHOS_AWS_CLIENT_TIMEOUT_MS,
    {
      fallback: DEFAULT_DDB_VERIFY_TIMEOUT_MS,
      max: MAX_DDB_VERIFY_TIMEOUT_MS,
    },
  );
}

function createDynamoVerifyAbort(env: Env) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveDynamoVerifyTimeoutMs(env));
  maybeUnrefTimeout(timeout);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function resolveCredentials(env: Env): AwsCredentials {
  return {
    accessKeyId: requireEnv(env, 'AWS_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv(env, 'AWS_SECRET_ACCESS_KEY'),
    sessionToken: env.AWS_SESSION_TOKEN,
  };
}

async function callDynamo(args: {
  region: string;
  target: string;
  body: Record<string, unknown>;
  credentials: AwsCredentials;
  env: Env;
  fetch: FetchLike;
}) {
  const body = JSON.stringify(args.body);
  const signed = await signAwsJsonRequest({
    service: 'dynamodb',
    region: args.region,
    target: `DynamoDB_20120810.${args.target}`,
    body,
    credentials: args.credentials,
  });
  const abort = createDynamoVerifyAbort(args.env);
  let response: Response;
  try {
    response = await args.fetch(`https://${signed.host}/`, {
      method: 'POST',
      headers: signed.headers,
      body,
      signal: abort.signal,
    });
  } finally {
    abort.clear();
  }
  const payload = (await response.json().catch(() => ({}))) as DynamoResponse & {
    __type?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(
      `${args.target} failed: ${response.status} ${payload.message ?? payload.__type ?? ''}`,
    );
  }
  return payload;
}

export async function verifyRateLimitDynamoDb(
  input: {
    env?: Env;
    fetch?: FetchLike;
    now?: number;
  } = {},
) {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetch ?? fetch;
  const tableName = requireEnv(env, 'RATE_LIMIT_DDB_TABLE_NAME');
  const region = env.RATE_LIMIT_DDB_REGION ?? requireEnv(env, 'AWS_REGION');
  const credentials = resolveCredentials(env);
  const testKey = env.RATE_LIMIT_VERIFY_WRITE_KEY ?? '__ph_os_rate_limit_preflight__';
  const now = input.now ?? Date.now();
  const resetAt = now + 60_000;
  const expiresAt = Math.ceil(resetAt / 1000) + 300;
  const verifyWrite = isTruthyEnv(env[WRITE_OPT_IN_ENV]);

  const table = await callDynamo({
    region,
    target: 'DescribeTable',
    credentials,
    env,
    fetch: fetchImpl,
    body: { TableName: tableName },
  });
  const keySchema = table.Table?.KeySchema ?? [];
  const attributes = table.Table?.AttributeDefinitions ?? [];
  if (table.Table?.TableStatus !== 'ACTIVE') {
    throw new Error(`Rate-limit table is not ACTIVE: ${table.Table?.TableStatus ?? 'unknown'}`);
  }
  if (!keySchema.some((key) => key.AttributeName === 'pk' && key.KeyType === 'HASH')) {
    throw new Error('Rate-limit table must use pk as the HASH key');
  }
  if (
    !attributes.some(
      (attribute) => attribute.AttributeName === 'pk' && attribute.AttributeType === 'S',
    )
  ) {
    throw new Error('Rate-limit table pk attribute must be a string');
  }

  const ttl = await callDynamo({
    region,
    target: 'DescribeTimeToLive',
    credentials,
    env,
    fetch: fetchImpl,
    body: { TableName: tableName },
  });
  if (
    ttl.TimeToLiveDescription?.AttributeName !== 'expires_at' ||
    ttl.TimeToLiveDescription?.TimeToLiveStatus !== 'ENABLED'
  ) {
    throw new Error('Rate-limit table TTL must be enabled on expires_at');
  }

  if (verifyWrite) {
    await callDynamo({
      region,
      target: 'UpdateItem',
      credentials,
      env,
      fetch: fetchImpl,
      body: {
        TableName: tableName,
        Key: { pk: { S: testKey } },
        UpdateExpression:
          'ADD hit_count :inc SET reset_at = :reset_at, expires_at = :expires_at, updated_at = :updated_at, created_at = if_not_exists(created_at, :created_at)',
        ExpressionAttributeValues: {
          ':inc': { N: '1' },
          ':reset_at': { N: String(resetAt) },
          ':expires_at': { N: String(expiresAt) },
          ':updated_at': { S: new Date(now).toISOString() },
          ':created_at': { S: new Date(now).toISOString() },
        },
        ReturnValues: 'UPDATED_NEW',
      },
    });

    await callDynamo({
      region,
      target: 'DeleteItem',
      credentials,
      env,
      fetch: fetchImpl,
      body: {
        TableName: tableName,
        Key: { pk: { S: testKey } },
      },
    });
  }

  return {
    ok: true,
    tableName,
    region,
    ttl: 'expires_at',
    writePath: verifyWrite ? 'verified' : 'skipped',
    writeOptIn: WRITE_OPT_IN_ENV,
  };
}

async function main() {
  console.log(JSON.stringify(await verifyRateLimitDynamoDb()));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
