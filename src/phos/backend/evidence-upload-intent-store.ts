import {
  TransactWriteItemsCommand,
  type DynamoDBClient,
  type TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import { ActionCode, type EvidenceUploadRequest } from '@/phos/contracts/phos_contracts';
import { buildDynamoCardAuditEventPut } from './card-audit-events';
import { dynamoKey, toDynamoAttributeValue } from './dynamodb-attribute-values';
import { evidenceSk, tenantPk } from './dynamodb-keys';
import { phosCoreTableName } from './dynamo-cards-repository';
import type { TenantContext } from './tenant-context';

export type EvidenceUploadIntent = Pick<
  EvidenceUploadRequest,
  'card_id' | 'evidence_type' | 'mime_type' | 'sha256' | 'size_bytes'
> & {
  idempotency_key: string;
  evidence_id: string;
  s3_key: string;
  expires_in_seconds: number;
};

export type EvidenceUploadIntentStore = {
  recordUploadIntent(ctx: TenantContext, intent: EvidenceUploadIntent): Promise<void>;
};

export type DynamoEvidenceUploadIntentTransaction = {
  table_name: string;
  partition_key: string;
  evidence_sort_key: string;
  intent: EvidenceUploadIntent;
  actor_user_id: string;
  request_id: string;
  correlation_id: string;
};

function evidenceAuditSummary(intent: EvidenceUploadIntent) {
  return {
    evidence_id: intent.evidence_id,
    idempotency_key: intent.idempotency_key,
    card_id: intent.card_id,
    evidence_type: intent.evidence_type,
    s3_key: intent.s3_key,
    mime_type: intent.mime_type,
    sha256: intent.sha256,
    size_bytes: intent.size_bytes,
    expires_in_seconds: intent.expires_in_seconds,
    upload_status: 'PRESIGNED',
  };
}

export function buildDynamoEvidenceUploadIntentTransactWriteItems(
  input: DynamoEvidenceUploadIntentTransaction,
  committed_at: string,
): TransactWriteItem[] {
  return [
    {
      Put: {
        TableName: input.table_name,
        Item: {
          ...dynamoKey(input.partition_key, input.evidence_sort_key),
          entity_type: { S: 'EVIDENCE' },
          evidence_id: { S: input.intent.evidence_id },
          idempotency_key: { S: input.intent.idempotency_key },
          card_id: { S: input.intent.card_id },
          evidence_type: { S: input.intent.evidence_type },
          s3_key: { S: input.intent.s3_key },
          mime_type: { S: input.intent.mime_type },
          sha256: { S: input.intent.sha256 },
          size_bytes: { N: String(input.intent.size_bytes) },
          expires_in_seconds: { N: String(input.intent.expires_in_seconds) },
          upload_status: { S: 'PRESIGNED' },
          evidence: toDynamoAttributeValue(evidenceAuditSummary(input.intent)),
          created_by_user_id: { S: input.actor_user_id },
          created_at: { S: committed_at },
          updated_at: { S: committed_at },
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    },
    buildDynamoCardAuditEventPut({
      table_name: input.table_name,
      partition_key: input.partition_key,
      committed_at,
      event: {
        event_id: `EVIDENCE_PRESIGN_CREATED#${input.intent.evidence_id}`,
        event_type: 'EVIDENCE_PRESIGN_CREATED',
        card_id: input.intent.card_id,
        action_code: ActionCode.UPLOAD_EVIDENCE,
        actor_user_id: input.actor_user_id,
        request_id: input.request_id,
        correlation_id: input.correlation_id,
        before_json: null,
        after_json: evidenceAuditSummary(input.intent),
        subject_json: {
          evidence_id: input.intent.evidence_id,
          upload_status: 'PRESIGNED',
        },
      },
    }),
  ];
}

export function createDynamoEvidenceUploadIntentStore(input: {
  client: Pick<DynamoDBClient, 'send'>;
  now?: () => Date;
}): EvidenceUploadIntentStore {
  return {
    async recordUploadIntent(ctx, intent) {
      const committed_at = (input.now?.() ?? new Date()).toISOString();
      await input.client.send(
        new TransactWriteItemsCommand({
          TransactItems: buildDynamoEvidenceUploadIntentTransactWriteItems(
            {
              table_name: phosCoreTableName(),
              partition_key: tenantPk(ctx),
              evidence_sort_key: evidenceSk(intent.evidence_id),
              intent,
              actor_user_id: ctx.user_id,
              request_id: ctx.request_id,
              correlation_id: ctx.correlation_id,
            },
            committed_at,
          ),
        }),
      );
    },
  };
}
