import type {
  MarkReportActionDoneRequest,
  RegisterReportReplyRequest,
  ReportDeliveryMutationResponse,
  ReportDeliveryView,
} from '@/phos/contracts/phos_contracts';
import type {
  IdempotentReportDeliveryLookup,
  ReportDeliveryLifecycleStore,
  ReportDeliveryTransitionCommitInput,
} from './report-delivery-lifecycle-repository';
import {
  assertTenantPk,
  reportDeliveryIdempotencySk,
  reportDeliverySk,
  reportDeliveryStatusGsiPk,
  reportDeliveryStatusGsiSk,
  tenantPk,
} from './dynamodb-keys';
import type { DynamoGetInput } from './dynamo-cards-repository';
import { phosCoreTableName } from './dynamo-cards-repository';
import type { DynamoCardAuditEvent } from './card-audit-events';
import type { TenantContext } from './tenant-context';

export type DynamoReportDeliveryIdempotencyRecord = {
  actor_user_id?: string;
  request_fingerprint: string;
  response?: ReportDeliveryMutationResponse;
};

export type DynamoReportDeliveryTransitionTransaction = {
  table_name: string;
  partition_key: string;
  delivery_sort_key: string;
  status_gsi_pk: string;
  status_gsi_sk: string;
  idempotency_sort_key: string;
  idempotency_key: string;
  expected_server_version: number;
  actor_user_id: string;
  request_fingerprint: string;
  command: RegisterReportReplyRequest | MarkReportActionDoneRequest;
  response: ReportDeliveryMutationResponse;
  audit_event: DynamoCardAuditEvent;
};

export type DynamoReportDeliveryLifecycleClient<TDeliveryItem, TIdempotencyItem> = {
  getReportDelivery(input: DynamoGetInput): Promise<TDeliveryItem | null>;
  getIdempotency(input: DynamoGetInput): Promise<TIdempotencyItem | null>;
  transactCommitReportDeliveryTransition(
    input: DynamoReportDeliveryTransitionTransaction,
  ): Promise<void>;
};

export type DynamoReportDeliveryLifecycleMapper<TDeliveryItem, TIdempotencyItem> = {
  toReportDeliveryView(item: TDeliveryItem): ReportDeliveryView;
  toIdempotencyRecord(item: TIdempotencyItem): DynamoReportDeliveryIdempotencyRecord;
};

function reportDeliveryAuditSummary(delivery: ReportDeliveryView) {
  return {
    delivery_id: delivery.delivery_id,
    card_id: delivery.card_id,
    report_id: delivery.report_id,
    status: delivery.status,
    stale_minutes: delivery.stale_minutes,
    reply_received_at: delivery.reply_received_at ?? null,
    action_done_at: delivery.action_done_at ?? null,
    action_done_by_user_id: delivery.action_done_by_user_id ?? null,
    source_ref_count: delivery.source_refs.length,
    server_version: delivery.server_version,
  };
}

function reportDeliveryEventType(mutation_key: string): string {
  if (mutation_key.startsWith('MARK_REPORT_ACTION_DONE:')) return 'REPORT_ACTION_DONE';
  return 'REPORT_REPLY_REGISTERED';
}

export function createDynamoReportDeliveryLifecycleStore<TDeliveryItem, TIdempotencyItem>(
  client: DynamoReportDeliveryLifecycleClient<TDeliveryItem, TIdempotencyItem>,
  mapper: DynamoReportDeliveryLifecycleMapper<TDeliveryItem, TIdempotencyItem>,
  search: ReportDeliveryLifecycleStore['searchReportDeliveries'],
): ReportDeliveryLifecycleStore {
  return {
    searchReportDeliveries: search,
    async getIdempotentMutation(
      ctx,
      mutation_key,
      idempotency_key,
      request_fingerprint,
    ): Promise<IdempotentReportDeliveryLookup> {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);

      const item = await client.getIdempotency({
        table_name: phosCoreTableName(),
        partition_key,
        sort_key: reportDeliveryIdempotencySk({ mutation_key, idempotency_key }),
      });
      if (!item) return { status: 'MISS' };

      const record = mapper.toIdempotencyRecord(item);
      if (
        record.request_fingerprint !== request_fingerprint ||
        record.actor_user_id !== ctx.user_id ||
        !record.response
      ) {
        return {
          status: 'CONFLICT',
          existing_request_fingerprint: record.request_fingerprint,
        };
      }
      return { status: 'MATCH', response: record.response };
    },

    async loadReportDelivery(ctx: TenantContext, delivery_id: string) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);

      const item = await client.getReportDelivery({
        table_name: phosCoreTableName(),
        partition_key,
        sort_key: reportDeliverySk(delivery_id),
      });
      return item ? mapper.toReportDeliveryView(item) : null;
    },

    async commitReportDeliveryTransition(
      ctx: TenantContext,
      input: ReportDeliveryTransitionCommitInput,
    ) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      const delivery = input.response.delivery;

      await client.transactCommitReportDeliveryTransition({
        table_name: phosCoreTableName(),
        partition_key,
        delivery_sort_key: reportDeliverySk(input.delivery_id),
        status_gsi_pk: reportDeliveryStatusGsiPk(ctx, delivery.status),
        status_gsi_sk: reportDeliveryStatusGsiSk({
          stale_minutes: delivery.stale_minutes,
          sent_at: delivery.sent_at,
          delivery_id: delivery.delivery_id,
        }),
        idempotency_sort_key: reportDeliveryIdempotencySk({
          mutation_key: input.mutation_key,
          idempotency_key: input.command.idempotency_key,
        }),
        idempotency_key: input.command.idempotency_key,
        expected_server_version: input.previous_delivery.server_version,
        actor_user_id: ctx.user_id,
        request_fingerprint: input.request_fingerprint,
        command: input.command,
        response: input.response,
        audit_event: {
          event_id: `${reportDeliveryEventType(input.mutation_key)}#${
            input.command.idempotency_key
          }`,
          event_type: reportDeliveryEventType(input.mutation_key),
          card_id: delivery.card_id,
          actor_user_id: ctx.user_id,
          request_id: ctx.request_id,
          correlation_id: ctx.correlation_id,
          before_json: reportDeliveryAuditSummary(input.previous_delivery),
          after_json: reportDeliveryAuditSummary(delivery),
          subject_json: {
            delivery_id: input.delivery_id,
            mutation_key: input.mutation_key,
            side_effect_types: input.response.side_effects.map((effect) => effect.type),
          },
        },
      });
      return input.response;
    },
  };
}
