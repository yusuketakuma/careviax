import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
  type DynamoDBClient as AwsDynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { createDynamoVisitModeRepository } from './dynamo-visit-mode-repository';
import type {
  DynamoVisitModeClient,
  DynamoVisitStepCommitTransaction,
} from './dynamo-visit-mode-repository';
import { dynamoKey, toDynamoAttributeValue } from './dynamodb-attribute-values';
import { createVisitModeLifecycleRepository } from './visit-mode-lifecycle-repository';
import { createGetVisitModeHandler, createUpdateVisitStepHandler } from './visit-mode-handlers';
import type { PhosVisitModeRepository } from './visit-mode-repository';
import {
  createLambdaObservabilitySink,
  type PhosLambdaRuntimeDependencies,
} from './lambda-observability';
import { withTenantContext } from './lambda-handler';
import {
  createS3EvidenceObjectVerifier,
  type EvidenceObjectVerifier,
} from './evidence-upload-verification';
import { rethrowDynamoTransactionConflict } from './dynamodb-transaction-errors';
import { phosAwsClientConfig, withPhosAwsClientTimeout } from './aws-client-timeout';

type VisitModeLambdaDependencies = PhosLambdaRuntimeDependencies & {
  repository?: PhosVisitModeRepository;
  dynamo_client?: Pick<AwsDynamoDBClient, 'send'>;
  store_client?: DynamoVisitModeClient;
  s3_client?: S3Client;
  evidence_bucket?: string;
  evidence_object_verifier?: EvidenceObjectVerifier;
};

export function createDynamoVisitModeClient(input: {
  client: Pick<AwsDynamoDBClient, 'send'>;
}): DynamoVisitModeClient {
  return {
    async getVisitPacket(query) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: dynamoKey(query.partition_key, query.sort_key),
        }),
      );
      return result.Item ?? null;
    },

    async getIdempotency(query) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: dynamoKey(query.partition_key, query.sort_key),
        }),
      );
      return result.Item ?? null;
    },

    async getEvidenceIntent(query) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: dynamoKey(query.partition_key, query.sort_key),
        }),
      );
      return result.Item ?? null;
    },

    async transactCommitVisitStep(transaction: DynamoVisitStepCommitTransaction) {
      const evidenceUpdate =
        transaction.verified_evidence && transaction.evidence_sort_key
          ? [
              {
                Update: {
                  TableName: transaction.table_name,
                  Key: dynamoKey(transaction.partition_key, transaction.evidence_sort_key),
                  UpdateExpression: `SET upload_status = :verified, packet_id = :packet_id, visit_step = :visit_step, verified_at = :updated_at, updated_at = :updated_at${
                    transaction.verified_evidence.s3_version_id
                      ? ', s3_version_id = :s3_version_id'
                      : ''
                  } REMOVE ttl_epoch_seconds`,
                  ConditionExpression:
                    'card_id = :card_id AND s3_key = :s3_key AND upload_status = :presigned AND expires_at > :updated_at',
                  ExpressionAttributeValues: {
                    ':verified': { S: 'VERIFIED' },
                    ':presigned': { S: 'PRESIGNED' },
                    ':packet_id': { S: transaction.response.packet_id },
                    ':visit_step': { S: 'EVIDENCE_UPLOAD' },
                    ':updated_at': { S: transaction.committed_at },
                    ':card_id': { S: transaction.verified_evidence.card_id },
                    ':s3_key': { S: transaction.verified_evidence.s3_key },
                    ...(transaction.verified_evidence.s3_version_id
                      ? {
                          ':s3_version_id': { S: transaction.verified_evidence.s3_version_id },
                        }
                      : {}),
                  },
                },
              },
            ]
          : [];
      try {
        await input.client.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              ...evidenceUpdate,
              {
                Update: {
                  TableName: transaction.table_name,
                  Key: dynamoKey(transaction.partition_key, transaction.visit_packet_sort_key),
                  UpdateExpression:
                    'SET visit_mode = :visit_mode, server_version = :next_version, updated_at = :updated_at',
                  ConditionExpression: 'server_version = :expected_version',
                  ExpressionAttributeValues: {
                    ':visit_mode': toDynamoAttributeValue(transaction.response),
                    ':next_version': { N: String(transaction.response.server_version) },
                    ':updated_at': { S: transaction.committed_at },
                    ':expected_version': { N: String(transaction.expected_server_version) },
                  },
                },
              },
              {
                Put: {
                  TableName: transaction.table_name,
                  Item: {
                    ...dynamoKey(transaction.partition_key, transaction.idempotency_sort_key),
                    actor_user_id: { S: transaction.actor_user_id },
                    request_fingerprint: { S: transaction.request_fingerprint },
                    response: { S: JSON.stringify(transaction.response) },
                    created_at: { S: transaction.committed_at },
                  },
                  ConditionExpression:
                    'attribute_not_exists(PK) OR (request_fingerprint = :request_fingerprint AND actor_user_id = :actor_user_id)',
                  ExpressionAttributeValues: {
                    ':actor_user_id': { S: transaction.actor_user_id },
                    ':request_fingerprint': { S: transaction.request_fingerprint },
                  },
                },
              },
            ],
          }),
        );
      } catch (error) {
        rethrowDynamoTransactionConflict(error, {
          resource: 'visit_step',
          packet_id: transaction.response.packet_id,
          expected_server_version: transaction.expected_server_version,
        });
      }
    },
  };
}

function evidenceBucketName(deps: VisitModeLambdaDependencies): string | undefined {
  return (
    deps.evidence_bucket ??
    process.env.PHOS_EVIDENCE_BUCKET ??
    process.env.PHOS_EVIDENCE_BUCKET_NAME
  );
}

function createEvidenceObjectVerifier(
  deps: VisitModeLambdaDependencies,
): EvidenceObjectVerifier | undefined {
  if (deps.evidence_object_verifier) return deps.evidence_object_verifier;
  const bucket = evidenceBucketName(deps);
  if (!bucket) return undefined;
  return createS3EvidenceObjectVerifier({
    client: deps.s3_client ?? withPhosAwsClientTimeout(new S3Client(phosAwsClientConfig())),
    bucket,
  });
}

export function createVisitModeRepository(
  deps: VisitModeLambdaDependencies = {},
): PhosVisitModeRepository {
  if (deps.repository) return deps.repository;
  const dynamoClient =
    deps.dynamo_client ?? withPhosAwsClientTimeout(new DynamoDBClient(phosAwsClientConfig()));
  const storeClient = deps.store_client ?? createDynamoVisitModeClient({ client: dynamoClient });
  return createVisitModeLifecycleRepository(
    createDynamoVisitModeRepository(storeClient, {
      now: deps.now,
      evidence_object_verifier: createEvidenceObjectVerifier(deps),
    }),
  );
}

function createLazyVisitModeRepository(
  deps: VisitModeLambdaDependencies = {},
): PhosVisitModeRepository {
  let repository: PhosVisitModeRepository | undefined;
  return {
    getVisitMode(ctx, packet_id) {
      repository ??= createVisitModeRepository(deps);
      return repository.getVisitMode(ctx, packet_id);
    },
    updateVisitStep(ctx, packet_id, step, request) {
      repository ??= createVisitModeRepository(deps);
      return repository.updateVisitStep(ctx, packet_id, step, request);
    },
  };
}

export function createGetVisitModeLambdaHandler(deps: VisitModeLambdaDependencies = {}) {
  const repository = deps.repository
    ? createVisitModeRepository(deps)
    : createLazyVisitModeRepository(deps);
  return withTenantContext(createGetVisitModeHandler(repository), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

export function createUpdateVisitStepLambdaHandler(deps: VisitModeLambdaDependencies = {}) {
  const repository = deps.repository
    ? createVisitModeRepository(deps)
    : createLazyVisitModeRepository(deps);
  return withTenantContext(createUpdateVisitStepHandler(repository), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

let defaultGetVisitModeHandler: ReturnType<typeof createGetVisitModeLambdaHandler> | undefined;
let defaultUpdateVisitStepHandler:
  | ReturnType<typeof createUpdateVisitStepLambdaHandler>
  | undefined;

export const getVisitModeHandler: ReturnType<typeof createGetVisitModeLambdaHandler> = (event) => {
  defaultGetVisitModeHandler ??= createGetVisitModeLambdaHandler();
  return defaultGetVisitModeHandler(event);
};

export const updateVisitStepHandler: ReturnType<typeof createUpdateVisitStepLambdaHandler> = (
  event,
) => {
  defaultUpdateVisitStepHandler ??= createUpdateVisitStepLambdaHandler();
  return defaultUpdateVisitStepHandler(event);
};
