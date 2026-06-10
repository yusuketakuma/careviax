import {
  DynamoDBClient,
  GetItemCommand,
  type DynamoDBClient as AwsDynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { createCapacityHandler } from './capacity-handlers';
import type { PhosCapacityRepository } from './capacity-repository';
import { createDynamoCapacityRepository } from './dynamo-capacity-repository';
import type { DynamoCapacityClient } from './dynamo-capacity-repository';
import { dynamoKey } from './dynamodb-attribute-values';
import {
  createLambdaObservabilitySink,
  type PhosLambdaRuntimeDependencies,
} from './lambda-observability';
import { withTenantContext } from './lambda-handler';
import { phosAwsClientConfig, withPhosAwsClientTimeout } from './aws-client-timeout';

type CapacityLambdaDependencies = PhosLambdaRuntimeDependencies & {
  repository?: PhosCapacityRepository;
  dynamo_client?: Pick<AwsDynamoDBClient, 'send'>;
  store_client?: DynamoCapacityClient;
};

export function createDynamoCapacityClient(input: {
  client: Pick<AwsDynamoDBClient, 'send'>;
}): DynamoCapacityClient {
  return {
    async getCapacitySnapshot(query) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: dynamoKey(query.partition_key, query.sort_key),
        }),
      );
      return result.Item ?? null;
    },
  };
}

export function createCapacityRepository(
  deps: CapacityLambdaDependencies = {},
): PhosCapacityRepository {
  if (deps.repository) return deps.repository;
  const dynamoClient =
    deps.dynamo_client ?? withPhosAwsClientTimeout(new DynamoDBClient(phosAwsClientConfig()));
  const storeClient = deps.store_client ?? createDynamoCapacityClient({ client: dynamoClient });
  return createDynamoCapacityRepository(storeClient, { now: deps.now });
}

function createLazyCapacityRepository(
  deps: CapacityLambdaDependencies = {},
): PhosCapacityRepository {
  let repository: PhosCapacityRepository | undefined;
  return {
    getCapacity(ctx, query) {
      repository ??= createCapacityRepository(deps);
      return repository.getCapacity(ctx, query);
    },
  };
}

export function createCapacityLambdaHandler(deps: CapacityLambdaDependencies = {}) {
  const repository = deps.repository
    ? createCapacityRepository(deps)
    : createLazyCapacityRepository(deps);
  return withTenantContext(createCapacityHandler(repository), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

let defaultCapacityHandler: ReturnType<typeof createCapacityLambdaHandler> | undefined;

export const capacityHandler: ReturnType<typeof createCapacityLambdaHandler> = (event) => {
  defaultCapacityHandler ??= createCapacityLambdaHandler();
  return defaultCapacityHandler(event);
};
