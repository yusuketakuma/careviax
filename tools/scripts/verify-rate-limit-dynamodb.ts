import { signAwsJsonRequest, type AwsCredentials } from '@/lib/aws/sigv4';

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

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function resolveCredentials(): AwsCredentials {
  return {
    accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };
}

async function callDynamo(args: {
  region: string;
  target: string;
  body: Record<string, unknown>;
  credentials: AwsCredentials;
}) {
  const body = JSON.stringify(args.body);
  const signed = await signAwsJsonRequest({
    service: 'dynamodb',
    region: args.region,
    target: `DynamoDB_20120810.${args.target}`,
    body,
    credentials: args.credentials,
  });
  const response = await fetch(`https://${signed.host}/`, {
    method: 'POST',
    headers: signed.headers,
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as DynamoResponse & {
    __type?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(`${args.target} failed: ${response.status} ${payload.message ?? payload.__type ?? ''}`);
  }
  return payload;
}

async function main() {
  const tableName = requireEnv('RATE_LIMIT_DDB_TABLE_NAME');
  const region = process.env.RATE_LIMIT_DDB_REGION ?? requireEnv('AWS_REGION');
  const credentials = resolveCredentials();
  const testKey = process.env.RATE_LIMIT_VERIFY_WRITE_KEY ?? '__ph_os_rate_limit_preflight__';
  const now = Date.now();
  const resetAt = now + 60_000;
  const expiresAt = Math.ceil(resetAt / 1000) + 300;

  const table = await callDynamo({
    region,
    target: 'DescribeTable',
    credentials,
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
  if (!attributes.some((attribute) => attribute.AttributeName === 'pk' && attribute.AttributeType === 'S')) {
    throw new Error('Rate-limit table pk attribute must be a string');
  }

  const ttl = await callDynamo({
    region,
    target: 'DescribeTimeToLive',
    credentials,
    body: { TableName: tableName },
  });
  if (
    ttl.TimeToLiveDescription?.AttributeName !== 'expires_at' ||
    ttl.TimeToLiveDescription?.TimeToLiveStatus !== 'ENABLED'
  ) {
    throw new Error('Rate-limit table TTL must be enabled on expires_at');
  }

  await callDynamo({
    region,
    target: 'UpdateItem',
    credentials,
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
    body: {
      TableName: tableName,
      Key: { pk: { S: testKey } },
    },
  });

  console.log(
    JSON.stringify({
      ok: true,
      tableName,
      region,
      ttl: 'expires_at',
      writePath: 'verified',
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
