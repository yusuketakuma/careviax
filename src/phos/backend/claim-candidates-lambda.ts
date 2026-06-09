import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  type AttributeValue,
  type DynamoDBClient as AwsDynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  ClaimCandidateStatus,
  type ClaimCandidateMutationResponse,
} from '@/phos/contracts/phos_contracts';
import { buildExcludedClaimCandidateResponse } from '@/phos/domain/claim/claimCandidateLifecycle';
import { claimCandidateStatusGsiSk } from './dynamodb-keys';
import {
  createClaimCandidateSearchHandler,
  createExcludeClaimCandidateHandler,
} from './claim-candidates-handlers';
import type { PhosClaimCandidatesRepository } from './claim-candidates-repository';
import {
  createDynamoClaimCandidatesRepository,
  type DynamoClaimCandidateQueryOutput,
  type DynamoClaimCandidatesClient,
} from './dynamo-claim-candidates-repository';
import { decodeDynamoCursor, encodeDynamoCursor } from './dynamodb-cursor';
import {
  dynamoKey,
  fromDynamoAttributeValue,
  toDynamoAttributeValue,
} from './dynamodb-attribute-values';
import {
  createLambdaObservabilitySink,
  type PhosLambdaRuntimeDependencies,
} from './lambda-observability';
import { withTenantContext } from './lambda-handler';
import { rethrowDynamoTransactionConflict } from './dynamodb-transaction-errors';
import { PhosDomainError } from './cards-repository';

type DynamoItem = Record<string, AttributeValue>;

type ClaimCandidatesLambdaDependencies = PhosLambdaRuntimeDependencies & {
  repository?: PhosClaimCandidatesRepository;
  dynamo_client?: Pick<AwsDynamoDBClient, 'send'>;
  store_client?: DynamoClaimCandidatesClient;
};

function objectAttr(item: DynamoItem, key: string): Record<string, unknown> {
  const value = item[key];
  if (!value) throw new Error(`Missing DynamoDB map attribute: ${key}`);
  const parsed = fromDynamoAttributeValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`DynamoDB attribute is not an object: ${key}`);
  }
  return parsed as Record<string, unknown>;
}

function numberAttr(item: DynamoItem, key: string): number | undefined {
  const value = item[key];
  if (!value) return undefined;
  const parsed = fromDynamoAttributeValue(value);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

function toCandidate(item: DynamoItem) {
  const candidate = objectAttr(item, 'claim_candidate');
  return {
    ...candidate,
    server_version: numberAttr(item, 'server_version') ?? Number(candidate.server_version ?? 1),
  } as ClaimCandidateMutationResponse['candidate'];
}

export function createDynamoClaimCandidatesClient(input: {
  client: Pick<AwsDynamoDBClient, 'send'>;
}): DynamoClaimCandidatesClient {
  return {
    async getIdempotency(query) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: dynamoKey(query.partition_key, query.sort_key),
        }),
      );
      return (result.Item ?? null) as DynamoItem | null;
    },
    async queryClaimCandidates(query): Promise<DynamoClaimCandidateQueryOutput> {
      const result = await input.client.send(
        new QueryCommand({
          TableName: query.table_name,
          IndexName: query.index_name,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': query.index_name === 'GSI2' ? 'GSI2PK' : 'GSI1PK' },
          ExpressionAttributeValues: { ':pk': { S: query.partition_key } },
          Limit: query.limit,
          ExclusiveStartKey: decodeDynamoCursor(query.cursor),
          ScanIndexForward: true,
        }),
      );
      return {
        items: (result.Items ?? []) as DynamoItem[],
        next_cursor: encodeDynamoCursor(result.LastEvaluatedKey),
      };
    },
    async excludeClaimCandidate(command): Promise<ClaimCandidateMutationResponse> {
      const current = await input.client.send(
        new GetItemCommand({
          TableName: command.table_name,
          Key: dynamoKey(command.partition_key, command.sort_key),
        }),
      );
      if (!current.Item) {
        throw new PhosDomainError({
          status: 404,
          error_code: 'NOT_FOUND',
          message_key: 'api.error.claim_candidate_not_found',
          details: { candidate_id: command.candidate_id },
        });
      }
      const response = buildExcludedClaimCandidateResponse({
        candidate: toCandidate(current.Item as DynamoItem),
        command: {
          reason_code: command.reason_code,
          ...(command.reason_note ? { reason_note: command.reason_note } : {}),
          idempotency_key: command.idempotency_sort_key,
          client_version: command.client_version,
        },
        now: command.updated_at,
      });
      const statusGsiPk = `${command.partition_key}#CLAIM_CANDIDATE_STATUS#${response.candidate.status}`;
      const statusGsiSk = claimCandidateStatusGsiSk({
        billing_month: response.candidate.billing_month,
        priority_rank: response.candidate.priority_rank,
        candidate_id: response.candidate.candidate_id,
      });

      try {
        await input.client.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              {
                Put: {
                  TableName: command.table_name,
                  Item: {
                    PK: { S: command.partition_key },
                    SK: { S: command.idempotency_sort_key },
                    request_fingerprint: { S: command.request_fingerprint },
                    response_json: { S: JSON.stringify(response) },
                    created_at: { S: command.updated_at },
                  },
                  ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
                },
              },
              {
                Update: {
                  TableName: command.table_name,
                  Key: dynamoKey(command.partition_key, `CARD#${response.candidate.card_id}`),
                  UpdateExpression:
                    'SET unresolved_claim_candidate_count = unresolved_claim_candidate_count - :one, updated_at = :updated_at',
                  ConditionExpression:
                    'attribute_exists(unresolved_claim_candidate_count) AND unresolved_claim_candidate_count > :zero',
                  ExpressionAttributeValues: {
                    ':one': { N: '1' },
                    ':zero': { N: '0' },
                    ':updated_at': { S: command.updated_at },
                  },
                },
              },
              {
                Update: {
                  TableName: command.table_name,
                  Key: dynamoKey(command.partition_key, command.sort_key),
                  UpdateExpression:
                    'SET claim_candidate = :candidate, server_version = :version, updated_at = :updated_at, #gsi1pk = :status_gsi_pk, #gsi1sk = :status_gsi_sk',
                  ConditionExpression:
                    'server_version = :client_version AND claim_candidate.#status <> :approved AND claim_candidate.#status <> :excluded',
                  ExpressionAttributeNames: {
                    '#status': 'status',
                    '#gsi1pk': 'GSI1PK',
                    '#gsi1sk': 'GSI1SK',
                  },
                  ExpressionAttributeValues: {
                    ':candidate': toDynamoAttributeValue(response.candidate),
                    ':version': { N: String(response.server_version) },
                    ':updated_at': { S: command.updated_at },
                    ':client_version': { N: String(command.client_version) },
                    ':approved': { S: ClaimCandidateStatus.APPROVED },
                    ':excluded': { S: ClaimCandidateStatus.EXCLUDED },
                    ':status_gsi_pk': { S: statusGsiPk },
                    ':status_gsi_sk': { S: statusGsiSk },
                  },
                },
              },
            ],
          }),
        );
      } catch (error) {
        rethrowDynamoTransactionConflict(error, {
          resource: 'claim_candidate_exclusion',
          candidate_id: response.candidate.candidate_id,
          expected_server_version: command.client_version,
        });
      }
      return response;
    },
  };
}

export function createClaimCandidatesRepository(
  deps: ClaimCandidatesLambdaDependencies = {},
): PhosClaimCandidatesRepository {
  if (deps.repository) return deps.repository;
  const dynamoClient = deps.dynamo_client ?? new DynamoDBClient({});
  const storeClient =
    deps.store_client ?? createDynamoClaimCandidatesClient({ client: dynamoClient });
  return createDynamoClaimCandidatesRepository(storeClient, { now: deps.now });
}

export function createClaimCandidateSearchLambdaHandler(
  deps: ClaimCandidatesLambdaDependencies = {},
) {
  return withTenantContext(
    createClaimCandidateSearchHandler(createClaimCandidatesRepository(deps)),
    {
      observability: createLambdaObservabilitySink(deps),
      now: deps.now,
    },
  );
}

export const claimCandidateSearchHandler = createClaimCandidateSearchLambdaHandler();

export function createExcludeClaimCandidateLambdaHandler(
  deps: ClaimCandidatesLambdaDependencies = {},
) {
  return withTenantContext(
    createExcludeClaimCandidateHandler(createClaimCandidatesRepository(deps)),
    {
      observability: createLambdaObservabilitySink(deps),
      now: deps.now,
    },
  );
}

export const excludeClaimCandidateHandler = createExcludeClaimCandidateLambdaHandler();
