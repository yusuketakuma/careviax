import {
  ActionCode,
  ActionKind,
  BlockerSeverity,
  CurrentStep,
  DisplayStatus,
} from '@/phos/contracts/phos_contracts';
import type {
  ActionResponse,
  BlockerView,
  CardSummaryView,
  NextActionView,
  VisitModeView,
} from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import { canCompleteVisit } from '@/phos/domain/visit/resolveVisitMode';
import { isBlockedActionResponse } from './card-action-projection';
import type { CardActionCommand, PhosCardsRepository } from './cards-repository';
import { PhosDomainError } from './cards-repository';
import type { TenantContext } from './tenant-context';

export type CardActionExecutionState = {
  card: CardSummaryView;
  next_action: NextActionView;
  blockers: BlockerView[];
  visit_mode?: VisitModeView;
  unresolved_claim_candidate_count?: number;
  allowed_actions?: readonly ActionCode[];
};

export type CardActionCommitInput = {
  card_id: string;
  command: CardActionCommand;
  request_fingerprint: string;
  previous_state: CardActionExecutionState;
  transition: (typeof ACTION_TRANSITION_MATRIX)[ActionCode];
};

export type IdempotentActionLookup =
  | { status: 'MISS' }
  | { status: 'MATCH'; response: ActionResponse }
  | { status: 'CONFLICT'; existing_request_fingerprint: string };

export type CardActionExecutionStore = {
  getIdempotentAction(
    ctx: TenantContext,
    card_id: string,
    idempotency_key: string,
    request_fingerprint: string,
  ): Promise<IdempotentActionLookup>;
  loadActionState(ctx: TenantContext, card_id: string): Promise<CardActionExecutionState | null>;
  commitAction(ctx: TenantContext, input: CardActionCommitInput): Promise<ActionResponse>;
};

async function replayIdempotentActionAfterCommitConflict(input: {
  error: unknown;
  store: CardActionExecutionStore;
  ctx: TenantContext;
  card_id: string;
  command: CardActionCommand;
  request_fingerprint: string;
}): Promise<ActionResponse> {
  if (!(input.error instanceof PhosDomainError) || input.error.error_code !== 'STALE_VERSION') {
    throw input.error;
  }
  const idempotent = await input.store.getIdempotentAction(
    input.ctx,
    input.card_id,
    input.command.idempotency_key,
    input.request_fingerprint,
  );
  if (idempotent.status === 'MATCH') return idempotent.response;
  if (idempotent.status === 'CONFLICT') {
    throw domainError(409, 'IDEMPOTENCY_CONFLICT', 'api.error.idempotency_conflict', {
      idempotency_key: input.command.idempotency_key,
    });
  }
  throw input.error;
}

export const CARD_ACTION_ROUTE_ACTION_CODES = [
  ActionCode.REGISTER_PRESCRIPTION,
  ActionCode.CONFIRM_PRESCRIPTION_DIFF,
  ActionCode.START_DISPENSING,
  ActionCode.COMPLETE_DISPENSING,
  ActionCode.START_DISPENSING_AUDIT,
  ActionCode.APPROVE_DISPENSING_AUDIT,
  ActionCode.REJECT_DISPENSING_AUDIT,
  ActionCode.CREATE_SET_INSTRUCTION,
  ActionCode.COMPLETE_SET,
  ActionCode.START_SET_AUDIT,
  ActionCode.APPROVE_SET_AUDIT,
  ActionCode.REJECT_SET_AUDIT,
  ActionCode.ASSIGN_TO_VISIT_PACKET,
  ActionCode.SCHEDULE_VISIT_PACKET,
  ActionCode.CONFIRM_VISIT_READY,
  ActionCode.START_VISIT,
  ActionCode.COMPLETE_VISIT,
  ActionCode.CREATE_REPORT_DRAFT,
  ActionCode.APPROVE_REPORT,
  ActionCode.SEND_REPORT,
  ActionCode.REVIEW_CLAIM_CANDIDATES,
  ActionCode.CLOSE_CARD,
  ActionCode.REOPEN_CARD,
  ActionCode.CANCEL_CARD,
  ActionCode.RESOLVE_CLERK_BLOCKER,
] as const satisfies readonly ActionCode[];

const cardActionRouteActionCodeSet = new Set<ActionCode>(CARD_ACTION_ROUTE_ACTION_CODES);

function domainError(
  status: number,
  error_code: PhosDomainError['error_code'],
  message_key: string,
  details?: Record<string, unknown>,
): PhosDomainError {
  return new PhosDomainError({ status, error_code, message_key, details });
}

function assertCardActionRouteOwnsAction(command: CardActionCommand) {
  if (cardActionRouteActionCodeSet.has(command.action_code)) return;
  throw actionGuardFailed({
    action_code: command.action_code,
    reason: 'action_code_owned_by_canonical_detached_route',
  });
}

function actionGuardFailed(details: Record<string, unknown>): PhosDomainError {
  return domainError(422, 'ACTION_GUARD_FAILED', 'api.error.action_guard_failed', details);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function createActionRequestFingerprint(command: CardActionCommand): string {
  return stableStringify({
    action_code: command.action_code,
    client_version: command.client_version,
    payload: command.payload ?? null,
    reason_code: command.reason_code ?? null,
    reason_note: command.reason_note ?? null,
  });
}

function isCurrentStep(value: string): value is CurrentStep {
  return Object.values(CurrentStep).includes(value as CurrentStep);
}

function assertActionAllowed(
  ctx: TenantContext,
  state: CardActionExecutionState,
  command: CardActionCommand,
) {
  const transition = ACTION_TRANSITION_MATRIX[command.action_code];
  const allowedRoles: readonly TenantContext['role'][] | undefined =
    'required_role' in transition ? transition.required_role : undefined;
  if (allowedRoles && !allowedRoles.includes(ctx.role)) {
    throw domainError(403, 'FORBIDDEN', 'api.error.forbidden', {
      action_code: command.action_code,
      required_role: allowedRoles,
    });
  }

  const allowedActions = state.allowed_actions ?? [state.next_action.code];
  if (!allowedActions.includes(command.action_code)) {
    throw actionGuardFailed({
      action_code: command.action_code,
      allowed_actions: allowedActions,
    });
  }
}

function assertCardCanTransition(state: CardActionExecutionState, command: CardActionCommand) {
  const transition = ACTION_TRANSITION_MATRIX[command.action_code];
  const { current_step, display_status } = state.card;

  if (
    (display_status === DisplayStatus.CLOSED || display_status === DisplayStatus.CANCELED) &&
    command.action_code !== ActionCode.REOPEN_CARD
  ) {
    throw actionGuardFailed({
      action_code: command.action_code,
      display_status,
    });
  }

  if (transition.from === 'any except CLOSED') {
    if (current_step === CurrentStep.CLOSED) {
      throw actionGuardFailed({ action_code: command.action_code, current_step });
    }
    return;
  }

  if (isCurrentStep(transition.from) && transition.from !== current_step) {
    throw actionGuardFailed({
      action_code: command.action_code,
      current_step,
      required_step: transition.from,
    });
  }
}

function assertNoBlockingBlockers(state: CardActionExecutionState, command: CardActionCommand) {
  const blocking = state.blockers.filter(
    (blocker) =>
      blocker.active &&
      (blocker.severity === BlockerSeverity.ERROR ||
        blocker.severity === BlockerSeverity.CRITICAL) &&
      blocker.required_action_code !== command.action_code,
  );

  if (blocking.length > 0) {
    throw actionGuardFailed({
      action_code: command.action_code,
      blocker_codes: blocking.map((blocker) => blocker.blocker_code),
    });
  }
}

function assertVisitCompleteGuard(state: CardActionExecutionState, command: CardActionCommand) {
  if (command.action_code !== ActionCode.COMPLETE_VISIT) return;
  const visit = state.visit_mode;
  if (!visit) {
    throw actionGuardFailed({
      action_code: command.action_code,
      reason: 'missing_visit_mode',
    });
  }
  if (
    !canCompleteVisit({
      applicable_steps: visit.applicable_steps,
      required_steps: visit.required_steps,
      step_completed: visit.step_completed,
      blocking_unsynced_count: visit.evidence_sync.blocking_unsynced_count,
      visit_status: visit.visit_status,
    })
  ) {
    throw actionGuardFailed({
      action_code: command.action_code,
      required_steps: visit.required_steps,
      blocking_unsynced_count: visit.evidence_sync.blocking_unsynced_count,
      visit_status: visit.visit_status,
    });
  }
}

function assertClaimCandidatesReviewed(
  state: CardActionExecutionState,
  command: CardActionCommand,
) {
  if (command.action_code !== ActionCode.REVIEW_CLAIM_CANDIDATES) return;
  const unresolvedCount = state.unresolved_claim_candidate_count;
  if (
    unresolvedCount === undefined ||
    !Number.isSafeInteger(unresolvedCount) ||
    unresolvedCount < 0
  ) {
    throw actionGuardFailed({
      action_code: command.action_code,
      reason: 'invalid_unresolved_claim_candidate_count',
    });
  }
  if (unresolvedCount > 0) {
    throw actionGuardFailed({
      action_code: command.action_code,
      unresolved_claim_candidate_count: unresolvedCount,
      required_action_code: ActionCode.EXCLUDE_CLAIM_CANDIDATE,
    });
  }
}

function assertFreshVersion(state: CardActionExecutionState, command: CardActionCommand) {
  if (state.card.server_version !== command.client_version) {
    throw domainError(409, 'STALE_VERSION', 'api.error.stale_version', {
      client_version: command.client_version,
      server_version: state.card.server_version,
    });
  }
}

function assertCanonicalActionResponse(input: {
  card_id: string;
  previous_server_version: number;
  response: ActionResponse;
}) {
  const { response } = input;
  if (response.card.card_id !== input.card_id) {
    throw domainError(500, 'INTERNAL_ERROR', 'api.error.action_response_card_mismatch', {
      card_id: input.card_id,
      response_card_id: response.card.card_id,
    });
  }
  if (response.display_status !== response.card.display_status) {
    throw domainError(500, 'INTERNAL_ERROR', 'api.error.action_response_status_mismatch', {
      display_status: response.display_status,
      card_display_status: response.card.display_status,
    });
  }
  if (response.server_version !== response.card.server_version) {
    throw domainError(500, 'INTERNAL_ERROR', 'api.error.action_response_version_mismatch', {
      server_version: response.server_version,
      card_server_version: response.card.server_version,
    });
  }
  if (response.server_version <= input.previous_server_version) {
    throw domainError(500, 'INTERNAL_ERROR', 'api.error.action_response_version_not_advanced', {
      previous_server_version: input.previous_server_version,
      server_version: response.server_version,
    });
  }
  if (response.next_action.kind !== ACTION_TRANSITION_MATRIX[response.next_action.code].kind) {
    throw domainError(
      500,
      'INTERNAL_ERROR',
      'api.error.action_response_next_action_kind_mismatch',
      {
        next_action_code: response.next_action.code,
      },
    );
  }
}

export function createCardActionExecutorRepository(
  store: CardActionExecutionStore,
): Pick<PhosCardsRepository, 'executeCardAction'> {
  return {
    async executeCardAction(
      ctx: TenantContext,
      card_id: string,
      command: CardActionCommand,
    ): Promise<ActionResponse> {
      const request_fingerprint = createActionRequestFingerprint(command);
      const idempotent = await store.getIdempotentAction(
        ctx,
        card_id,
        command.idempotency_key,
        request_fingerprint,
      );
      if (idempotent.status === 'MATCH') return idempotent.response;
      if (idempotent.status === 'CONFLICT') {
        throw domainError(409, 'IDEMPOTENCY_CONFLICT', 'api.error.idempotency_conflict', {
          idempotency_key: command.idempotency_key,
        });
      }

      const state = await store.loadActionState(ctx, card_id);
      if (!state) {
        throw domainError(404, 'NOT_FOUND', 'api.error.card_not_found', { card_id });
      }

      assertCardActionRouteOwnsAction(command);
      assertFreshVersion(state, command);
      assertActionAllowed(ctx, state, command);
      assertCardCanTransition(state, command);
      assertNoBlockingBlockers(state, command);
      assertVisitCompleteGuard(state, command);
      assertClaimCandidatesReviewed(state, command);

      const transition = ACTION_TRANSITION_MATRIX[command.action_code];
      let response: ActionResponse;
      try {
        response = await store.commitAction(ctx, {
          card_id,
          command,
          request_fingerprint,
          previous_state: state,
          transition,
        });
      } catch (error) {
        response = await replayIdempotentActionAfterCommitConflict({
          error,
          store,
          ctx,
          card_id,
          command,
          request_fingerprint,
        });
      }

      if (transition.kind === ActionKind.STEP_CHANGING && isCurrentStep(transition.to)) {
        const blockedOnPreviousStep =
          isBlockedActionResponse(response) &&
          response.card.current_step === state.card.current_step;
        if (response.card.current_step !== transition.to && !blockedOnPreviousStep) {
          throw domainError(500, 'INTERNAL_ERROR', 'api.error.action_response_step_mismatch', {
            expected_step: transition.to,
            actual_step: response.card.current_step,
          });
        }
      }

      assertCanonicalActionResponse({
        card_id,
        previous_server_version: state.card.server_version,
        response,
      });

      return response;
    },
  };
}
