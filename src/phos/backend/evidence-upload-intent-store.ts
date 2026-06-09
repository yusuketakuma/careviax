import {
  GetItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue,
  type DynamoDBClient,
  type TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import { ActionCode, type EvidenceUploadRequest } from '@/phos/contracts/phos_contracts';
import { buildDynamoCardAuditEventPut } from './card-audit-events';
import {
  dynamoKey,
  fromDynamoAttributeValue,
  toDynamoAttributeValue,
} from './dynamodb-attribute-values';
import { evidenceSk, tenantPk } from './dynamodb-keys';
import { phosCoreTableName } from './dynamo-cards-repository';
import { PhosDomainError } from './cards-repository';
import { isDynamoTransactionConflict } from './dynamodb-transaction-errors';
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

type EvidenceIntentMatch = 'MATCH' | 'MISSING' | 'CONFLICT';

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

function stringAttr(item: Record<string, AttributeValue>, key: string): string | undefined {
  const value = item[key];
  if (!value) return undefined;
  const parsed = fromDynamoAttributeValue(value);
  return typeof parsed === 'string' ? parsed : undefined;
}

function numberAttr(item: Record<string, AttributeValue>, key: string): number | undefined {
  const value = item[key];
  if (!value) return undefined;
  const parsed = fromDynamoAttributeValue(value);
  return typeof parsed === 'number' ? parsed : undefined;
}

function idempotencyConflict(intent: EvidenceUploadIntent, reason: string): PhosDomainError {
  return new PhosDomainError({
    status: 409,
    error_code: 'IDEMPOTENCY_CONFLICT',
    message_key: 'api.error.idempotency_conflict',
    details: {
      idempotency_key: intent.idempotency_key,
      evidence_id: intent.evidence_id,
      reason,
    },
  });
}

function compareExistingIntent(
  item: Record<string, AttributeValue> | null,
  intent: EvidenceUploadIntent,
): EvidenceIntentMatch {
  if (!item) return 'MISSING';
  const existing = {
    idempotency_key: stringAttr(item, 'idempotency_key'),
    evidence_id: stringAttr(item, 'evidence_id'),
    card_id: stringAttr(item, 'card_id'),
    evidence_type: stringAttr(item, 'evidence_type'),
    s3_key: stringAttr(item, 's3_key'),
    mime_type: stringAttr(item, 'mime_type'),
    sha256: stringAttr(item, 'sha256'),
    size_bytes: numberAttr(item, 'size_bytes'),
    upload_status: stringAttr(item, 'upload_status'),
  };
  if (existing.upload_status !== 'PRESIGNED') return 'CONFLICT';
  return existing.idempotency_key === intent.idempotency_key &&
    existing.evidence_id === intent.evidence_id &&
    existing.card_id === intent.card_id &&
    existing.evidence_type === intent.evidence_type &&
    existing.s3_key === intent.s3_key &&
    existing.mime_type === intent.mime_type &&
    existing.sha256 === intent.sha256 &&
    existing.size_bytes === intent.size_bytes
    ? 'MATCH'
    : 'CONFLICT';
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
  async function readExistingIntent(ctx: TenantContext, intent: EvidenceUploadIntent) {
    const result = await input.client.send(
      new GetItemCommand({
        TableName: phosCoreTableName(),
        Key: dynamoKey(tenantPk(ctx), evidenceSk(intent.evidence_id)),
      }),
    );
    return (result.Item ?? null) as Record<string, AttributeValue> | null;
  }

  async function assertReplayableOrMissing(ctx: TenantContext, intent: EvidenceUploadIntent) {
    const match = compareExistingIntent(await readExistingIntent(ctx, intent), intent);
    if (match === 'MATCH') return true;
    if (match === 'CONFLICT')
      throw idempotencyConflict(intent, 'existing_evidence_intent_mismatch');
    return false;
  }

  return {
    async recordUploadIntent(ctx, intent) {
      if (await assertReplayableOrMissing(ctx, intent)) return;
      const committed_at = (input.now?.() ?? new Date()).toISOString();
      try {
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
      } catch (error) {
        if (!isDynamoTransactionConflict(error)) throw error;
        if (await assertReplayableOrMissing(ctx, intent)) return;
        throw idempotencyConflict(intent, 'concurrent_evidence_intent_conflict');
      }
    },
  };
}
