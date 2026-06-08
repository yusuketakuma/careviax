import {
  ReportDeliveryStatus,
  type MarkReportActionDoneRequest,
  type RegisterReportReplyRequest,
  type ReportDeliveryMutationResponse,
  type ReportDeliverySearchResponse,
  type ReportDeliveryView,
  type SourceRef,
} from '@/phos/contracts/phos_contracts';
import { PhosDomainError } from './cards-repository';
import type {
  PhosReportDeliveriesRepository,
  ReportDeliverySearchQuery,
} from './report-deliveries-repository';
import type { TenantContext } from './tenant-context';

export type IdempotentReportDeliveryLookup =
  | { status: 'MISS' }
  | { status: 'MATCH'; response: ReportDeliveryMutationResponse }
  | { status: 'CONFLICT'; existing_request_fingerprint: string };

export type ReportDeliveryTransitionCommitInput = {
  delivery_id: string;
  mutation_key: string;
  command: RegisterReportReplyRequest | MarkReportActionDoneRequest;
  request_fingerprint: string;
  previous_delivery: ReportDeliveryView;
  response: ReportDeliveryMutationResponse;
};

export type ReportDeliveryLifecycleStore = {
  searchReportDeliveries(
    ctx: TenantContext,
    query: ReportDeliverySearchQuery,
  ): Promise<ReportDeliverySearchResponse>;
  getIdempotentMutation(
    ctx: TenantContext,
    mutation_key: string,
    idempotency_key: string,
    request_fingerprint: string,
  ): Promise<IdempotentReportDeliveryLookup>;
  loadReportDelivery(ctx: TenantContext, delivery_id: string): Promise<ReportDeliveryView | null>;
  commitReportDeliveryTransition(
    ctx: TenantContext,
    input: ReportDeliveryTransitionCommitInput,
  ): Promise<ReportDeliveryMutationResponse>;
};

function domainError(
  status: number,
  error_code: PhosDomainError['error_code'],
  message_key: string,
  details?: Record<string, unknown>,
): PhosDomainError {
  return new PhosDomainError({ status, error_code, message_key, details });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function mutationKey(scope: string, delivery_id: string): string {
  return `${scope}:${delivery_id}`;
}

function assertFreshVersion(delivery: ReportDeliveryView, client_version: number) {
  if (delivery.server_version !== client_version) {
    throw domainError(409, 'STALE_VERSION', 'api.error.stale_version', {
      delivery_id: delivery.delivery_id,
      client_version,
      server_version: delivery.server_version,
    });
  }
}

async function assertIdempotent(input: {
  store: ReportDeliveryLifecycleStore;
  ctx: TenantContext;
  mutation_key: string;
  idempotency_key: string;
  request_fingerprint: string;
}): Promise<ReportDeliveryMutationResponse | null> {
  const idempotent = await input.store.getIdempotentMutation(
    input.ctx,
    input.mutation_key,
    input.idempotency_key,
    input.request_fingerprint,
  );
  if (idempotent.status === 'MATCH') return idempotent.response;
  if (idempotent.status === 'CONFLICT') {
    throw domainError(409, 'IDEMPOTENCY_CONFLICT', 'api.error.idempotency_conflict', {
      idempotency_key: input.idempotency_key,
    });
  }
  return null;
}

function mergeSourceRefs(existing: SourceRef[], next: SourceRef[] | undefined): SourceRef[] {
  const merged = [...existing];
  for (const source of next ?? []) {
    if (!merged.some((item) => item.kind === source.kind && item.ref_id === source.ref_id)) {
      merged.push(source);
    }
  }
  return merged;
}

function assertReplyCanBeRegistered(delivery: ReportDeliveryView) {
  if (delivery.status === ReportDeliveryStatus.ACTION_DONE) {
    throw domainError(422, 'ACTION_GUARD_FAILED', 'api.error.report_delivery_guard_failed', {
      delivery_id: delivery.delivery_id,
      status: delivery.status,
    });
  }
}

function assertActionCanBeCompleted(delivery: ReportDeliveryView) {
  if (delivery.status !== ReportDeliveryStatus.ACTION_REQUIRED) {
    throw domainError(422, 'ACTION_GUARD_FAILED', 'api.error.report_delivery_guard_failed', {
      delivery_id: delivery.delivery_id,
      status: delivery.status,
      required_status: ReportDeliveryStatus.ACTION_REQUIRED,
    });
  }
}

function responseForRegisteredReply(input: {
  delivery: ReportDeliveryView;
  command: RegisterReportReplyRequest;
  now: Date;
}): ReportDeliveryMutationResponse {
  const server_version = input.delivery.server_version + 1;
  const reply_received_at = input.command.reply_received_at ?? input.now.toISOString();
  const delivery: ReportDeliveryView = {
    ...input.delivery,
    status: input.command.result_status,
    stale_minutes: 0,
    reply_received_at,
    reply_summary: input.command.reply_summary,
    source_refs: mergeSourceRefs(input.delivery.source_refs, input.command.source_refs),
    ...(input.command.action_required_note
      ? { action_required_note: input.command.action_required_note }
      : {}),
    ...(input.command.result_status === ReportDeliveryStatus.ACTION_DONE
      ? {
          action_done_at: input.now.toISOString(),
        }
      : {}),
    server_version,
  };

  return {
    delivery,
    side_effects: [
      {
        type: 'REPORT_REPLY_REGISTERED',
        delivery_id: delivery.delivery_id,
        status: delivery.status,
      },
      ...(delivery.status === ReportDeliveryStatus.ACTION_DONE
        ? [{ type: 'REPORT_ACTION_DONE' as const, delivery_id: delivery.delivery_id }]
        : []),
    ],
    server_version,
  };
}

function responseForActionDone(input: {
  delivery: ReportDeliveryView;
  command: MarkReportActionDoneRequest;
  ctx: TenantContext;
  now: Date;
}): ReportDeliveryMutationResponse {
  const server_version = input.delivery.server_version + 1;
  const delivery: ReportDeliveryView = {
    ...input.delivery,
    status: ReportDeliveryStatus.ACTION_DONE,
    stale_minutes: 0,
    action_required_note: input.delivery.action_required_note ?? input.command.action_note,
    action_done_at: input.now.toISOString(),
    action_done_by_user_id: input.ctx.user_id,
    server_version,
  };

  return {
    delivery,
    side_effects: [{ type: 'REPORT_ACTION_DONE', delivery_id: delivery.delivery_id }],
    server_version,
  };
}

export type ReportDeliveryLifecycleRepositoryOptions = {
  now?: () => Date;
};

export function createReportDeliveryLifecycleRepository(
  store: ReportDeliveryLifecycleStore,
  options: ReportDeliveryLifecycleRepositoryOptions = {},
): PhosReportDeliveriesRepository {
  const now = options.now ?? (() => new Date());

  return {
    searchReportDeliveries: store.searchReportDeliveries,
    async registerReportReply(ctx, delivery_id, command) {
      const request_fingerprint = stableStringify(command);
      const key = mutationKey('REGISTER_REPORT_REPLY', delivery_id);
      const matched = await assertIdempotent({
        store,
        ctx,
        mutation_key: key,
        idempotency_key: command.idempotency_key,
        request_fingerprint,
      });
      if (matched) return matched;

      const delivery = await store.loadReportDelivery(ctx, delivery_id);
      if (!delivery) {
        throw domainError(404, 'NOT_FOUND', 'api.error.report_delivery_not_found', {
          delivery_id,
        });
      }
      assertFreshVersion(delivery, command.client_version);
      assertReplyCanBeRegistered(delivery);
      const response = responseForRegisteredReply({ delivery, command, now: now() });
      return store.commitReportDeliveryTransition(ctx, {
        delivery_id,
        mutation_key: key,
        command,
        request_fingerprint,
        previous_delivery: delivery,
        response,
      });
    },
    async markReportActionDone(ctx, delivery_id, command) {
      const request_fingerprint = stableStringify(command);
      const key = mutationKey('MARK_REPORT_ACTION_DONE', delivery_id);
      const matched = await assertIdempotent({
        store,
        ctx,
        mutation_key: key,
        idempotency_key: command.idempotency_key,
        request_fingerprint,
      });
      if (matched) return matched;

      const delivery = await store.loadReportDelivery(ctx, delivery_id);
      if (!delivery) {
        throw domainError(404, 'NOT_FOUND', 'api.error.report_delivery_not_found', {
          delivery_id,
        });
      }
      assertFreshVersion(delivery, command.client_version);
      assertActionCanBeCompleted(delivery);
      const response = responseForActionDone({ delivery, command, ctx, now: now() });
      return store.commitReportDeliveryTransition(ctx, {
        delivery_id,
        mutation_key: key,
        command,
        request_fingerprint,
        previous_delivery: delivery,
        response,
      });
    },
  };
}
