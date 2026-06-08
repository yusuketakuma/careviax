import type { ActionResponse } from '@/phos/contracts/phos_contracts';
import type {
  BlockerView,
  CurrentStep,
  NextActionView,
  ReportDeliveryView,
  SideEffect,
  TabKey,
  ToastTone,
} from '@/phos/contracts/phos_contracts';
import type { CardActionCommand } from './cards-repository';
import type { CardActionBlockerChanges, CardActionDisplayContext } from './card-action-projection';
import { projectCardActionResponse } from './card-action-projection';
import type {
  CardActionCommitInput,
  CardActionExecutionState,
  CardActionExecutionStore,
  IdempotentActionLookup,
} from './card-action-executor';
import {
  assertTenantPk,
  cardActionIdempotencySk,
  cardBlockerSk,
  cardSk,
  reportDeliverySk,
  reportDeliveryStatusGsiPk,
  reportDeliveryStatusGsiSk,
  tenantPk,
} from './dynamodb-keys';
import type { DynamoGetInput } from './dynamo-cards-repository';
import { PHOS_CORE_TABLE } from './dynamo-cards-repository';
import type { TenantContext } from './tenant-context';

export type DynamoActionCommitTransaction = {
  table_name: string;
  partition_key: string;
  card_sort_key: string;
  idempotency_sort_key: string;
  blocker_puts: { sort_key: string; blocker: BlockerView }[];
  blocker_resolutions: { sort_key: string; blocker_code: string }[];
  report_delivery_puts: {
    sort_key: string;
    status_gsi_pk: string;
    status_gsi_sk: string;
    delivery: ReportDeliveryView;
  }[];
  expected_server_version: number;
  request_fingerprint: string;
  command: CardActionCommand;
  transition: CardActionCommitInput['transition'];
  projected_response: ActionResponse;
};

export type DynamoActionCommitProjection = {
  server_version: number;
  next_action: NextActionView;
  current_step_override?: CurrentStep;
  blocker_changes?: CardActionBlockerChanges;
  report_delivery_puts?: ReportDeliveryView[];
  side_effects?: SideEffect[];
  visible_tabs?: TabKey[];
  toast?: { tone: ToastTone; message_key: string; params?: Record<string, string> };
  display_context: CardActionDisplayContext;
};

export type DynamoActionIdempotencyRecord = {
  request_fingerprint: string;
  response?: ActionResponse;
};

export type DynamoCardActionStoreClient<TStateItem, TIdempotencyItem> = {
  getActionState(input: DynamoGetInput): Promise<TStateItem | null>;
  getIdempotency(input: DynamoGetInput): Promise<TIdempotencyItem | null>;
  transactCommitAction(input: DynamoActionCommitTransaction): Promise<void>;
};

export type DynamoCardActionStoreMapper<TStateItem, TIdempotencyItem> = {
  toActionState(item: TStateItem): CardActionExecutionState;
  toIdempotencyRecord(item: TIdempotencyItem): DynamoActionIdempotencyRecord;
  toCommitProjection(input: CardActionCommitInput): DynamoActionCommitProjection;
};

export function createDynamoCardActionExecutionStore<TStateItem, TIdempotencyItem>(
  client: DynamoCardActionStoreClient<TStateItem, TIdempotencyItem>,
  mapper: DynamoCardActionStoreMapper<TStateItem, TIdempotencyItem>,
): CardActionExecutionStore {
  return {
    async getIdempotentAction(
      ctx: TenantContext,
      card_id: string,
      idempotency_key: string,
      request_fingerprint: string,
    ): Promise<IdempotentActionLookup> {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);

      const item = await client.getIdempotency({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: cardActionIdempotencySk({ card_id, idempotency_key }),
      });

      if (!item) return { status: 'MISS' };

      const record = mapper.toIdempotencyRecord(item);
      if (record.request_fingerprint !== request_fingerprint) {
        return {
          status: 'CONFLICT',
          existing_request_fingerprint: record.request_fingerprint,
        };
      }
      if (!record.response) {
        return {
          status: 'CONFLICT',
          existing_request_fingerprint: record.request_fingerprint,
        };
      }
      return { status: 'MATCH', response: record.response };
    },

    async loadActionState(
      ctx: TenantContext,
      card_id: string,
    ): Promise<CardActionExecutionState | null> {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);

      const item = await client.getActionState({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: cardSk(card_id),
      });

      return item ? mapper.toActionState(item) : null;
    },

    async commitAction(ctx: TenantContext, input: CardActionCommitInput): Promise<ActionResponse> {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      const projection = mapper.toCommitProjection(input);
      const projected_response = projectCardActionResponse({
        previous_state: input.previous_state,
        command: input.command,
        ...projection,
      });

      await client.transactCommitAction({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        card_sort_key: cardSk(input.card_id),
        idempotency_sort_key: cardActionIdempotencySk({
          card_id: input.card_id,
          idempotency_key: input.command.idempotency_key,
        }),
        blocker_puts: (projection.blocker_changes?.created ?? []).map((blocker) => ({
          sort_key: cardBlockerSk({ card_id: input.card_id, blocker_code: blocker.blocker_code }),
          blocker,
        })),
        blocker_resolutions: (projection.blocker_changes?.resolved_codes ?? []).map(
          (blocker_code) => ({
            sort_key: cardBlockerSk({ card_id: input.card_id, blocker_code }),
            blocker_code,
          }),
        ),
        report_delivery_puts: (projection.report_delivery_puts ?? []).map((delivery) => ({
          sort_key: reportDeliverySk(delivery.delivery_id),
          status_gsi_pk: reportDeliveryStatusGsiPk(ctx, delivery.status),
          status_gsi_sk: reportDeliveryStatusGsiSk({
            stale_minutes: delivery.stale_minutes,
            sent_at: delivery.sent_at,
            delivery_id: delivery.delivery_id,
          }),
          delivery,
        })),
        expected_server_version: input.previous_state.card.server_version,
        request_fingerprint: input.request_fingerprint,
        command: input.command,
        transition: input.transition,
        projected_response,
      });
      return projected_response;
    },
  };
}
