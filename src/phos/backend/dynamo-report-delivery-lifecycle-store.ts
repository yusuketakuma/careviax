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
import { PHOS_CORE_TABLE } from './dynamo-cards-repository';
import type { TenantContext } from './tenant-context';

export type DynamoReportDeliveryIdempotencyRecord = {
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
  request_fingerprint: string;
  command: RegisterReportReplyRequest | MarkReportActionDoneRequest;
  response: ReportDeliveryMutationResponse;
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
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: reportDeliveryIdempotencySk({ mutation_key, idempotency_key }),
      });
      if (!item) return { status: 'MISS' };

      const record = mapper.toIdempotencyRecord(item);
      if (record.request_fingerprint !== request_fingerprint || !record.response) {
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
        table_name: PHOS_CORE_TABLE,
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
        table_name: PHOS_CORE_TABLE,
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
        request_fingerprint: input.request_fingerprint,
        command: input.command,
        response: input.response,
      });
      return input.response;
    },
  };
}
