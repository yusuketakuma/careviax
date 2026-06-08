import type {
  CreateHandoffRequest,
  HandoffMutationResponse,
  HandoffStatus,
  HandoffView,
  OpenHandoffRequest,
  ResolveHandoffRequest,
  ReturnHandoffRequest,
} from '@/phos/contracts/phos_contracts';
import { HandoffStatus as HandoffStatusValue } from '@/phos/contracts/phos_contracts';
import {
  openHandoffForReview,
  resolveHandoff,
  returnHandoff,
} from '@/phos/domain/handoff/handoffLifecycle';
import { PhosDomainError } from './cards-repository';
import {
  projectHandoffBlockerResolution,
  type HandoffCardAggregateSource,
  type HandoffCardAggregateUpdate,
} from './handoff-card-aggregate-projection';
import type { PhosHandoffsRepository } from './handoffs-repository';
import type { TenantContext } from './tenant-context';

export type IdempotentHandoffLookup =
  | { status: 'MISS' }
  | { status: 'MATCH'; response: HandoffMutationResponse }
  | { status: 'CONFLICT'; existing_request_fingerprint: string };

export type HandoffCreateCardContext = {
  card_id: string;
  patient_name: string;
  server_version: number;
  pharmacist_assignee_user_id?: string;
};

export type HandoffTransitionCommitInput = {
  handoff_id: string;
  mutation_key: string;
  command: OpenHandoffRequest | ResolveHandoffRequest | ReturnHandoffRequest;
  request_fingerprint: string;
  previous_handoff: HandoffView;
  response: HandoffMutationResponse;
  card_aggregate_update?: HandoffCardAggregateUpdate;
};

export type HandoffLifecycleStore = Pick<PhosHandoffsRepository, 'searchHandoffs'> & {
  getIdempotentMutation(
    ctx: TenantContext,
    mutation_key: string,
    idempotency_key: string,
    request_fingerprint: string,
  ): Promise<IdempotentHandoffLookup>;
  loadHandoff(ctx: TenantContext, handoff_id: string): Promise<HandoffView | null>;
  loadCreateCardContext(
    ctx: TenantContext,
    card_id: string,
  ): Promise<HandoffCreateCardContext | null>;
  loadHandoffCardState(
    ctx: TenantContext,
    card_id: string,
  ): Promise<HandoffCardAggregateSource | null>;
  commitCreateHandoff(
    ctx: TenantContext,
    command: CreateHandoffRequest,
    card_context: HandoffCreateCardContext,
    request_fingerprint: string,
  ): Promise<HandoffMutationResponse>;
  commitHandoffTransition(
    ctx: TenantContext,
    input: HandoffTransitionCommitInput,
  ): Promise<HandoffMutationResponse>;
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

function mutationKey(scope: string, id: string): string {
  return `${scope}:${id}`;
}

function assertFreshVersion(handoff: HandoffView, client_version: number) {
  assertFreshServerVersion({
    entity_id: handoff.handoff_id,
    entity_field: 'handoff_id',
    server_version: handoff.server_version,
    client_version,
  });
}

function assertFreshServerVersion(input: {
  entity_id: string;
  entity_field: string;
  server_version: number;
  client_version: number;
}) {
  if (input.server_version !== input.client_version) {
    throw domainError(409, 'STALE_VERSION', 'api.error.stale_version', {
      [input.entity_field]: input.entity_id,
      client_version: input.client_version,
      server_version: input.server_version,
    });
  }
}

function reviewReadyHandoff(handoff: HandoffView): HandoffView {
  if (handoff.status === HandoffStatusValue.IN_REVIEW) return handoff;
  if (handoff.status === HandoffStatusValue.OPEN) {
    return { ...handoff, status: openHandoffForReview(handoff).status };
  }
  throw domainError(422, 'ACTION_GUARD_FAILED', 'api.error.handoff_guard_failed', {
    handoff_id: handoff.handoff_id,
    status: handoff.status,
  });
}

async function assertIdempotent(input: {
  store: HandoffLifecycleStore;
  ctx: TenantContext;
  mutation_key: string;
  idempotency_key: string;
  request_fingerprint: string;
}): Promise<HandoffMutationResponse | null> {
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

function responseFromTransition(
  handoff: HandoffView,
  result: {
    status: HandoffStatus;
    resolved_action_code?: HandoffView['resolved_action_code'];
    return_reason_code?: string;
    return_note?: string;
    side_effects: HandoffMutationResponse['side_effects'];
  },
  now: () => Date,
): HandoffMutationResponse {
  const nextVersion = handoff.server_version + 1;
  const nextHandoff = {
    ...handoff,
    status: result.status,
    ...(result.resolved_action_code ? { resolved_action_code: result.resolved_action_code } : {}),
    ...(result.return_reason_code ? { return_reason_code: result.return_reason_code } : {}),
    ...(result.return_note ? { return_note: result.return_note } : {}),
    ...(result.status === HandoffStatusValue.RETURNED
      ? { assignee_user_id: handoff.created_by_user_id }
      : {}),
    updated_at: now().toISOString(),
    server_version: nextVersion,
  };
  return {
    handoff: nextHandoff,
    side_effects: result.side_effects,
    server_version: nextVersion,
  };
}

async function projectRelatedCardAggregate(input: {
  store: HandoffLifecycleStore;
  ctx: TenantContext;
  handoff: HandoffView;
  response: HandoffMutationResponse;
}): Promise<HandoffCardAggregateUpdate | undefined> {
  const related_blocker_code = input.handoff.related_blocker_code;
  if (!related_blocker_code) return undefined;
  if (!input.response.side_effects.some((effect) => effect.type === 'BLOCKER_RESOLVED')) {
    return undefined;
  }

  const cardState = await input.store.loadHandoffCardState(input.ctx, input.handoff.card_id);
  if (!cardState) {
    throw domainError(404, 'NOT_FOUND', 'api.error.card_not_found', {
      card_id: input.handoff.card_id,
    });
  }

  return projectHandoffBlockerResolution({
    source: cardState,
    blocker_code: related_blocker_code,
    server_version: cardState.state.card.server_version + 1,
  });
}

export type HandoffLifecycleRepositoryOptions = {
  now?: () => Date;
};

export function createHandoffLifecycleRepository(
  store: HandoffLifecycleStore,
  options: HandoffLifecycleRepositoryOptions = {},
): PhosHandoffsRepository {
  const now = options.now ?? (() => new Date());

  return {
    searchHandoffs: store.searchHandoffs,
    async createHandoff(ctx, command) {
      const request_fingerprint = stableStringify(command);
      const matched = await assertIdempotent({
        store,
        ctx,
        mutation_key: mutationKey('CREATE_HANDOFF', command.card_id),
        idempotency_key: command.idempotency_key,
        request_fingerprint,
      });
      if (matched) return matched;

      const cardContext = await store.loadCreateCardContext(ctx, command.card_id);
      if (!cardContext) {
        throw domainError(404, 'NOT_FOUND', 'api.error.card_not_found', {
          card_id: command.card_id,
        });
      }
      assertFreshServerVersion({
        entity_id: command.card_id,
        entity_field: 'card_id',
        server_version: cardContext.server_version,
        client_version: command.client_version,
      });

      return store.commitCreateHandoff(ctx, command, cardContext, request_fingerprint);
    },
    async openHandoff(ctx, handoff_id, command: OpenHandoffRequest) {
      const request_fingerprint = stableStringify(command);
      const matched = await assertIdempotent({
        store,
        ctx,
        mutation_key: mutationKey('OPEN_HANDOFF', handoff_id),
        idempotency_key: command.idempotency_key,
        request_fingerprint,
      });
      if (matched) return matched;

      const handoff = await store.loadHandoff(ctx, handoff_id);
      if (!handoff) {
        throw domainError(404, 'NOT_FOUND', 'api.error.handoff_not_found', { handoff_id });
      }
      assertFreshVersion(handoff, command.client_version);
      const result = openHandoffForReview(handoff);
      const response = responseFromTransition(handoff, result, now);
      return store.commitHandoffTransition(ctx, {
        handoff_id,
        mutation_key: mutationKey('OPEN_HANDOFF', handoff_id),
        command,
        request_fingerprint,
        previous_handoff: handoff,
        response,
      });
    },
    async resolveHandoff(ctx, handoff_id, command) {
      const request_fingerprint = stableStringify(command);
      const matched = await assertIdempotent({
        store,
        ctx,
        mutation_key: mutationKey('RESOLVE_HANDOFF', handoff_id),
        idempotency_key: command.idempotency_key,
        request_fingerprint,
      });
      if (matched) return matched;

      const handoff = await store.loadHandoff(ctx, handoff_id);
      if (!handoff) {
        throw domainError(404, 'NOT_FOUND', 'api.error.handoff_not_found', { handoff_id });
      }
      assertFreshVersion(handoff, command.client_version);
      const reviewHandoff = reviewReadyHandoff(handoff);
      const response = responseFromTransition(
        handoff,
        resolveHandoff({
          handoff: reviewHandoff,
          resolved_action_code: command.resolved_action_code,
          related_blocker_code: handoff.related_blocker_code,
        }),
        now,
      );
      const card_aggregate_update = await projectRelatedCardAggregate({
        store,
        ctx,
        handoff,
        response,
      });
      return store.commitHandoffTransition(ctx, {
        handoff_id,
        mutation_key: mutationKey('RESOLVE_HANDOFF', handoff_id),
        command,
        request_fingerprint,
        previous_handoff: handoff,
        response,
        card_aggregate_update,
      });
    },
    async returnHandoff(ctx, handoff_id, command) {
      const request_fingerprint = stableStringify(command);
      const matched = await assertIdempotent({
        store,
        ctx,
        mutation_key: mutationKey('RETURN_HANDOFF', handoff_id),
        idempotency_key: command.idempotency_key,
        request_fingerprint,
      });
      if (matched) return matched;

      const handoff = await store.loadHandoff(ctx, handoff_id);
      if (!handoff) {
        throw domainError(404, 'NOT_FOUND', 'api.error.handoff_not_found', { handoff_id });
      }
      assertFreshVersion(handoff, command.client_version);
      const reviewHandoff = reviewReadyHandoff(handoff);
      const response = responseFromTransition(
        handoff,
        returnHandoff({
          handoff: reviewHandoff,
          return_reason_code: command.return_reason_code,
          return_note: command.return_note,
        }),
        now,
      );
      return store.commitHandoffTransition(ctx, {
        handoff_id,
        mutation_key: mutationKey('RETURN_HANDOFF', handoff_id),
        command,
        request_fingerprint,
        previous_handoff: handoff,
        response,
      });
    },
  };
}
