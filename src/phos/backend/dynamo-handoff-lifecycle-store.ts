import { randomUUID } from 'node:crypto';
import { HandoffUrgency } from '@/phos/contracts/phos_contracts';
import type {
  CreateHandoffRequest,
  HandoffMutationResponse,
  HandoffSearchQuery,
  HandoffView,
} from '@/phos/contracts/phos_contracts';
import { sortHandoffQueue } from '@/phos/domain/handoff/handoffLifecycle';
import type {
  HandoffCreateCardContext,
  HandoffLifecycleStore,
  HandoffTransitionCommitInput,
  IdempotentHandoffLookup,
} from './handoff-lifecycle-repository';
import type { HandoffCardAggregateSource } from './handoff-card-aggregate-projection';
import {
  assertTenantPk,
  assertTenantScopedDynamoOperation,
  cardSk,
  handoffAssigneeGsiPk,
  handoffIdempotencySk,
  handoffSk,
  tenantPk,
} from './dynamodb-keys';
import type {
  DynamoGetInput,
  DynamoQueryInput,
  DynamoQueryOutput,
} from './dynamo-cards-repository';
import { PHOS_BOARD_GSI, PHOS_CORE_TABLE } from './dynamo-cards-repository';
import type { DynamoCardAuditEvent } from './card-audit-events';
import type { TenantContext } from './tenant-context';

export const HANDOFF_SEARCH_DEFAULT_LIMIT = 50;
export const HANDOFF_SEARCH_MAX_LIMIT = 50;

export type DynamoHandoffIdempotencyRecord = {
  request_fingerprint: string;
  response?: HandoffMutationResponse;
};

export type DynamoHandoffCreateTransaction = {
  table_name: string;
  partition_key: string;
  card_sort_key: string;
  expected_card_server_version: number;
  handoff_sort_key: string;
  queue_gsi_pk: string;
  idempotency_sort_key: string;
  idempotency_key: string;
  request_fingerprint: string;
  command: CreateHandoffRequest;
  response: HandoffMutationResponse;
  audit_event: DynamoCardAuditEvent;
};

export type DynamoHandoffTransitionTransaction = {
  table_name: string;
  partition_key: string;
  handoff_sort_key: string;
  queue_gsi_pk: string;
  idempotency_sort_key: string;
  idempotency_key: string;
  expected_server_version: number;
  request_fingerprint: string;
  response: HandoffMutationResponse;
  audit_event: DynamoCardAuditEvent;
  blocker_resolution?: { card_id: string; blocker_code: string };
  card_aggregate_update?: {
    card_sort_key: string;
    expected_card_server_version: number;
    update: HandoffTransitionCommitInput['card_aggregate_update'];
  };
};

export type DynamoHandoffStoreClient<THandoffItem, TIdempotencyItem> = {
  queryHandoffs(input: DynamoQueryInput): Promise<DynamoQueryOutput<THandoffItem>>;
  getHandoff(input: DynamoGetInput): Promise<THandoffItem | null>;
  getCreateCardContext(input: DynamoGetInput): Promise<THandoffItem | null>;
  getHandoffCardState(input: DynamoGetInput): Promise<THandoffItem | null>;
  getIdempotency(input: DynamoGetInput): Promise<TIdempotencyItem | null>;
  transactCreateHandoff(input: DynamoHandoffCreateTransaction): Promise<void>;
  transactCommitHandoffTransition(input: DynamoHandoffTransitionTransaction): Promise<void>;
};

export type DynamoHandoffStoreMapper<THandoffItem, TIdempotencyItem> = {
  toHandoffView(item: THandoffItem): HandoffView;
  toCreateCardContext(item: THandoffItem): HandoffCreateCardContext;
  toHandoffCardState(item: THandoffItem): HandoffCardAggregateSource;
  toIdempotencyRecord(item: TIdempotencyItem): DynamoHandoffIdempotencyRecord;
  toCreateResponse(input: {
    ctx: TenantContext;
    command: CreateHandoffRequest;
    card_context: HandoffCreateCardContext;
    handoff_id: string;
    created_at: string;
  }): HandoffMutationResponse;
};

const URGENCY_QUEUE_RANK = {
  [HandoffUrgency.URGENT]: 0,
  [HandoffUrgency.HIGH]: 1,
  [HandoffUrgency.NORMAL]: 2,
  [HandoffUrgency.LOW]: 3,
} as const satisfies Record<HandoffUrgency, number>;

function readAssignee(ctx: TenantContext, query: HandoffSearchQuery): string {
  if (!query.assignee || query.assignee === 'ME') return ctx.user_id;
  return query.assignee;
}

function boundedLimit(limit: number | undefined): number {
  if (!limit) return HANDOFF_SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(limit, 1), HANDOFF_SEARCH_MAX_LIMIT);
}

function handoffAuditSummary(handoff: HandoffView) {
  return {
    handoff_id: handoff.handoff_id,
    card_id: handoff.card_id,
    status: handoff.status,
    requested_action: handoff.requested_action,
    resolved_action_code: handoff.resolved_action_code ?? null,
    return_reason_code: handoff.return_reason_code ?? null,
    urgency: handoff.urgency,
    assignee_user_id: handoff.assignee_user_id ?? null,
    related_blocker_code: handoff.related_blocker_code ?? null,
    source_ref_count: handoff.source_refs.length,
    server_version: handoff.server_version,
  };
}

function handoffTransitionEventType(handoff: HandoffView): string {
  if (handoff.status === 'IN_REVIEW') return 'HANDOFF_OPENED';
  if (handoff.status === 'RESOLVED') return 'HANDOFF_RESOLVED';
  if (handoff.status === 'RETURNED') return 'HANDOFF_RETURNED';
  return 'HANDOFF_UPDATED';
}

export function createDynamoHandoffLifecycleStore<THandoffItem, TIdempotencyItem>(
  client: DynamoHandoffStoreClient<THandoffItem, TIdempotencyItem>,
  mapper: DynamoHandoffStoreMapper<THandoffItem, TIdempotencyItem>,
  options: {
    createHandoffId?: () => string;
    now?: () => Date;
  } = {},
): HandoffLifecycleStore {
  return {
    async searchHandoffs(ctx, query) {
      const assignee_user_id = readAssignee(ctx, query);
      const partition_key = handoffAssigneeGsiPk(ctx, assignee_user_id);
      assertTenantScopedDynamoOperation(ctx, {
        operation: 'Query',
        partition_key,
        key_type: 'GSI',
      });

      const result = await client.queryHandoffs({
        table_name: PHOS_CORE_TABLE,
        index_name: PHOS_BOARD_GSI,
        partition_key,
        key_type: 'GSI',
        sort_key_begins_with: query.status ? `STATUS#${query.status}#` : undefined,
        limit: boundedLimit(query.limit),
        cursor: query.cursor,
      });

      return {
        items: sortHandoffQueue(
          result.items
            .map((item) => mapper.toHandoffView(item))
            .filter((handoff) => !query.status || handoff.status === query.status),
        ),
        next_cursor: result.next_cursor,
        server_time: (options.now?.() ?? new Date()).toISOString(),
      };
    },

    async getIdempotentMutation(
      ctx,
      mutation_key,
      idempotency_key,
      request_fingerprint,
    ): Promise<IdempotentHandoffLookup> {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);

      const item = await client.getIdempotency({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: handoffIdempotencySk({ mutation_key, idempotency_key }),
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

    async loadHandoff(ctx, handoff_id) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);

      const item = await client.getHandoff({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: handoffSk(handoff_id),
      });
      return item ? mapper.toHandoffView(item) : null;
    },

    async loadCreateCardContext(ctx, card_id) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);

      const item = await client.getCreateCardContext({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: cardSk(card_id),
      });
      return item ? mapper.toCreateCardContext(item) : null;
    },

    async loadHandoffCardState(ctx, card_id) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);

      const item = await client.getHandoffCardState({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: cardSk(card_id),
      });
      return item ? mapper.toHandoffCardState(item) : null;
    },

    async commitCreateHandoff(ctx, command, card_context, request_fingerprint) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      const handoff_id = options.createHandoffId?.() ?? randomUUID();
      const created_at = (options.now?.() ?? new Date()).toISOString();
      const response = mapper.toCreateResponse({
        ctx,
        command,
        card_context,
        handoff_id,
        created_at,
      });

      await client.transactCreateHandoff({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        card_sort_key: cardSk(command.card_id),
        expected_card_server_version: card_context.server_version,
        handoff_sort_key: handoffSk(response.handoff.handoff_id),
        queue_gsi_pk: handoffAssigneeGsiPk(ctx, response.handoff.assignee_user_id ?? ctx.user_id),
        idempotency_sort_key: handoffIdempotencySk({
          mutation_key: `CREATE_HANDOFF:${command.card_id}`,
          idempotency_key: command.idempotency_key,
        }),
        idempotency_key: command.idempotency_key,
        request_fingerprint,
        command,
        response,
        audit_event: {
          event_id: `HANDOFF_CREATED#${command.idempotency_key}`,
          event_type: 'HANDOFF_CREATED',
          card_id: command.card_id,
          action_code: command.requested_action,
          actor_user_id: ctx.user_id,
          request_id: ctx.request_id,
          correlation_id: ctx.correlation_id,
          before_json: null,
          after_json: handoffAuditSummary(response.handoff),
          subject_json: {
            handoff_id: response.handoff.handoff_id,
            mutation_key: `CREATE_HANDOFF:${command.card_id}`,
          },
        },
      });
      return response;
    },

    async commitHandoffTransition(ctx, input: HandoffTransitionCommitInput) {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);
      const relatedBlocker = input.previous_handoff.related_blocker_code
        ? {
            card_id: input.previous_handoff.card_id,
            blocker_code: input.previous_handoff.related_blocker_code,
          }
        : undefined;
      const cardAggregateUpdate = input.card_aggregate_update
        ? {
            card_sort_key: cardSk(input.previous_handoff.card_id),
            expected_card_server_version: input.card_aggregate_update.card.server_version - 1,
            update: input.card_aggregate_update,
          }
        : undefined;

      await client.transactCommitHandoffTransition({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        handoff_sort_key: handoffSk(input.handoff_id),
        queue_gsi_pk: handoffAssigneeGsiPk(
          ctx,
          input.response.handoff.assignee_user_id ?? ctx.user_id,
        ),
        idempotency_sort_key: handoffIdempotencySk({
          mutation_key: input.mutation_key,
          idempotency_key: input.command.idempotency_key,
        }),
        idempotency_key: input.command.idempotency_key,
        expected_server_version: input.previous_handoff.server_version,
        request_fingerprint: input.request_fingerprint,
        response: input.response,
        audit_event: {
          event_id: `${handoffTransitionEventType(input.response.handoff)}#${
            input.command.idempotency_key
          }`,
          event_type: handoffTransitionEventType(input.response.handoff),
          card_id: input.previous_handoff.card_id,
          action_code:
            input.response.handoff.resolved_action_code ?? input.response.handoff.requested_action,
          actor_user_id: ctx.user_id,
          request_id: ctx.request_id,
          correlation_id: ctx.correlation_id,
          before_json: handoffAuditSummary(input.previous_handoff),
          after_json: handoffAuditSummary(input.response.handoff),
          subject_json: {
            handoff_id: input.handoff_id,
            mutation_key: input.mutation_key,
            side_effect_types: input.response.side_effects.map((effect) => effect.type),
          },
        },
        blocker_resolution: relatedBlocker,
        card_aggregate_update: cardAggregateUpdate,
      });
      return input.response;
    },
  };
}

export function handoffUrgencyQueueRank(urgency: HandoffUrgency): number {
  return URGENCY_QUEUE_RANK[urgency];
}
