import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { VisitModeView } from '@/phos/contracts/phos_contracts';
import { assertTenantPk, tenantPk, visitPacketSk, visitStepIdempotencySk } from './dynamodb-keys';
import type { DynamoGetInput } from './dynamo-cards-repository';
import { PHOS_CORE_TABLE } from './dynamo-cards-repository';
import { fromDynamoAttributeValue } from './dynamodb-attribute-values';
import type {
  IdempotentVisitStepLookup,
  VisitModeLifecycleStore,
  VisitStepCommitInput,
} from './visit-mode-lifecycle-repository';
import type { TenantContext } from './tenant-context';

type DynamoItem = Record<string, AttributeValue>;

export type DynamoVisitStepCommitTransaction = {
  table_name: string;
  partition_key: string;
  visit_packet_sort_key: string;
  idempotency_sort_key: string;
  expected_server_version: number;
  request_fingerprint: string;
  response: VisitModeView;
  committed_at: string;
};

export type DynamoVisitModeClient = {
  getVisitPacket(input: DynamoGetInput): Promise<DynamoItem | null>;
  getIdempotency(input: DynamoGetInput): Promise<DynamoItem | null>;
  transactCommitVisitStep(input: DynamoVisitStepCommitTransaction): Promise<void>;
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

function stringAttr(item: DynamoItem, key: string): string | undefined {
  const value = item[key];
  if (!value) return undefined;
  const parsed = fromDynamoAttributeValue(value);
  return typeof parsed === 'string' ? parsed : undefined;
}

function parseJsonAttr<T>(item: DynamoItem, key: string): T | undefined {
  const value = stringAttr(item, key);
  return value ? (JSON.parse(value) as T) : undefined;
}

function toVisitModeView(item: DynamoItem): VisitModeView {
  return objectAttr(item, 'visit_mode') as VisitModeView;
}

function toIdempotentLookup(
  item: DynamoItem | null,
  request_fingerprint: string,
): IdempotentVisitStepLookup {
  if (!item) return { status: 'MISS' };
  const existing = stringAttr(item, 'request_fingerprint');
  if (existing !== request_fingerprint) {
    return { status: 'CONFLICT', existing_request_fingerprint: existing ?? '' };
  }
  const response = parseJsonAttr<VisitModeView>(item, 'response');
  if (!response) return { status: 'CONFLICT', existing_request_fingerprint: existing ?? '' };
  return { status: 'MATCH', response };
}

export function createDynamoVisitModeRepository(
  client: DynamoVisitModeClient,
  options: { now?: () => Date } = {},
): VisitModeLifecycleStore {
  return {
    async getIdempotentVisitStep(ctx, mutation_key, idempotency_key, request_fingerprint) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      const [scope, packet_id, step] = mutation_key.split(':');
      if (scope !== 'VISIT_STEP' || !packet_id || !step) {
        throw new Error(`Invalid visit mutation key: ${mutation_key}`);
      }
      const item = await client.getIdempotency({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: visitStepIdempotencySk({ packet_id, step, idempotency_key }),
      });
      return toIdempotentLookup(item, request_fingerprint);
    },

    async loadVisitMode(ctx, packet_id) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      const item = await client.getVisitPacket({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: visitPacketSk(packet_id),
      });
      return item ? toVisitModeView(item) : null;
    },

    async commitVisitStep(ctx: TenantContext, input: VisitStepCommitInput) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      await client.transactCommitVisitStep({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        visit_packet_sort_key: visitPacketSk(input.packet_id),
        idempotency_sort_key: visitStepIdempotencySk({
          packet_id: input.packet_id,
          step: input.step,
          idempotency_key: input.command.idempotency_key,
        }),
        expected_server_version: input.previous_visit.server_version,
        request_fingerprint: input.request_fingerprint,
        response: input.response,
        committed_at: (options.now?.() ?? new Date()).toISOString(),
      });
      return input.response;
    },
  };
}
