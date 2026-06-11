import { DynamoDBClient, type DynamoDBClient as AwsDynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import {
  SecretsManagerClient,
  type SecretsManagerClient as AwsSecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

import { phosAwsClientConfig, withPhosAwsClientTimeout } from './aws-client-timeout';

const DEFAULT_AWS_REGION = 'ap-northeast-1';

const defaultDynamoClients = new Map<string, Pick<AwsDynamoDBClient, 'send'>>();
const defaultS3Clients = new Map<string, S3Client>();
const defaultSecretsManagerClients = new Map<string, Pick<AwsSecretsManagerClient, 'send'>>();

export function phosAwsRegion(): string {
  return process.env.AWS_REGION ?? DEFAULT_AWS_REGION;
}

export function getDefaultPhosDynamoClient(
  region: string = phosAwsRegion(),
): Pick<AwsDynamoDBClient, 'send'> {
  const cached = defaultDynamoClients.get(region);
  if (cached) return cached;

  const client = withPhosAwsClientTimeout(new DynamoDBClient({ region, ...phosAwsClientConfig() }));
  defaultDynamoClients.set(region, client);
  return client;
}

export function getDefaultPhosS3Client(region: string = phosAwsRegion()): S3Client {
  const cached = defaultS3Clients.get(region);
  if (cached) return cached;

  const client = withPhosAwsClientTimeout(new S3Client({ region, ...phosAwsClientConfig() }));
  defaultS3Clients.set(region, client);
  return client;
}

export function getDefaultPhosSecretsManagerClient(
  region: string = phosAwsRegion(),
): Pick<AwsSecretsManagerClient, 'send'> {
  const cached = defaultSecretsManagerClients.get(region);
  if (cached) return cached;

  const client = withPhosAwsClientTimeout(
    new SecretsManagerClient({ region, ...phosAwsClientConfig() }),
  );
  defaultSecretsManagerClients.set(region, client);
  return client;
}
