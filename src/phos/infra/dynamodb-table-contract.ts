export const PHOS_DYNAMODB_TABLE_NAME_PARAMETER = 'PhosDynamoDbTableName';

export const PHOS_DYNAMODB_TABLE_CONTRACT = {
  table_name_parameter: PHOS_DYNAMODB_TABLE_NAME_PARAMETER,
  primary_key: {
    partition_key: 'PK',
    sort_key: 'SK',
  },
  global_secondary_indexes: {
    GSI1: {
      partition_key: 'GSI1PK',
      sort_key: 'GSI1SK',
      query_shapes: ['board cards by tenant board queue'],
    },
    GSI2: {
      partition_key: 'GSI2PK',
      sort_key: 'GSI2SK',
      query_shapes: ['cards by assignee status and due date'],
    },
    GSI3: {
      partition_key: 'GSI3PK',
      sort_key: 'GSI3SK',
      query_shapes: ['cards by patient timeline'],
    },
    GSI4: {
      partition_key: 'GSI4PK',
      sort_key: 'GSI4SK',
      query_shapes: ['cards by visit packet'],
    },
    GSI5: {
      partition_key: 'GSI5PK',
      sort_key: 'GSI5SK',
      query_shapes: ['handoffs by assignee/status'],
    },
    GSI6: {
      partition_key: 'GSI6PK',
      sort_key: 'GSI6SK',
      query_shapes: ['report deliveries by status/staleness'],
    },
    GSI7: {
      partition_key: 'GSI7PK',
      sort_key: 'GSI7SK',
      query_shapes: ['claim candidates by status/month/priority'],
    },
    GSI8: {
      partition_key: 'GSI8PK',
      sort_key: null,
      query_shapes: ['claim candidates by card'],
    },
  },
  required_entity_attributes: [
    'entity_type',
    'tenant_id',
    'server_version',
    'created_at',
    'updated_at',
  ],
  ttl_attribute: null,
  billing_mode: 'PAY_PER_REQUEST',
} as const;

export type PhosDynamoDbGlobalSecondaryIndexName =
  keyof typeof PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes;
