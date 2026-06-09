import { describe, expect, it } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BlockerSeverity,
  ButtonState,
  CARD_ACTION_TARGET_ENDPOINT,
  CardType,
  CurrentStep,
  DisplayStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { BlockerView, CardSummaryView, NextActionView } from '@/phos/contracts/phos_contracts';
import type { CardActionExecutionState } from './card-action-executor';
import { hasBlockerCreatedSideEffect, projectCardActionResponse } from './card-action-projection';
import type { CardActionDisplayContext } from './card-action-projection';

function card(overrides: Partial<CardSummaryView> = {}): CardSummaryView {
  return {
    card_id: 'card_1',
    card_type: CardType.PRESCRIPTION,
    patient_name: 'Test Patient',
    current_step: CurrentStep.DIFF_REVIEW,
    display_status: DisplayStatus.READY,
    server_version: 3,
    tags: [],
    ...overrides,
  };
}

function nextAction(overrides: Partial<NextActionView> = {}): NextActionView {
  return {
    code: ActionCode.START_DISPENSING,
    kind: ActionKind.INTRA_STEP,
    label_key: 'action.start_dispensing',
    enabled: true,
    offline_allowed: false,
    priority: 'PRIMARY',
    required_role: [UserRole.PHARMACIST],
    target_endpoint: CARD_ACTION_TARGET_ENDPOINT,
    ui_state: ButtonState.ACTIONABLE,
    can_user_handle: true,
    ...overrides,
  };
}

function blocker(overrides: Partial<BlockerView> = {}): BlockerView {
  return {
    blocker_code: 'MISSING_EVIDENCE',
    severity: BlockerSeverity.ERROR,
    owner_role: UserRole.PHARMACIST,
    message_key: 'blocker.missing_evidence',
    active: true,
    ...overrides,
  };
}

function state(overrides: Partial<CardActionExecutionState> = {}): CardActionExecutionState {
  return {
    card: card(),
    next_action: nextAction({ code: ActionCode.CONFIRM_PRESCRIPTION_DIFF }),
    blockers: [],
    unresolved_claim_candidate_count: 0,
    allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
    ...overrides,
  };
}

function displayContext(
  overrides: Partial<CardActionDisplayContext> = {},
): CardActionDisplayContext {
  return {
    canceled_at: null,
    has_open_rejected_audit: false,
    has_active_in_progress_task: false,
    primary_action_authorized: true,
    ...overrides,
  };
}

describe('projectCardActionResponse', () => {
  it('builds a server-side ActionResponse for a successful step transition', () => {
    const response = projectCardActionResponse({
      previous_state: state(),
      command: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_1',
        client_version: 3,
      },
      server_version: 4,
      next_action: nextAction(),
      display_context: displayContext({ has_active_in_progress_task: true }),
    });

    expect(response).toMatchObject({
      card: {
        card_id: 'card_1',
        current_step: CurrentStep.DISPENSING,
        display_status: DisplayStatus.IN_PROGRESS,
        server_version: 4,
      },
      display_status: DisplayStatus.IN_PROGRESS,
      next_action: {
        code: ActionCode.START_DISPENSING,
        kind: ActionKind.INTRA_STEP,
        enabled: true,
      },
      blockers: [],
      side_effects: [],
      server_version: 4,
    });
  });

  it('returns business blockers as a 200 ActionResponse projection, not a synchronous guard error', () => {
    const response = projectCardActionResponse({
      previous_state: state(),
      command: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_2',
        client_version: 3,
      },
      server_version: 4,
      current_step_override: CurrentStep.DIFF_REVIEW,
      next_action: nextAction({
        code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        ui_state: ButtonState.RESOLVABLE_BLOCK,
      }),
      blocker_changes: { created: [blocker()] },
      display_context: displayContext(),
    });

    expect(response.card.current_step).toBe(CurrentStep.DIFF_REVIEW);
    expect(response.display_status).toBe(DisplayStatus.BLOCKED);
    expect(response.blockers).toEqual([blocker()]);
    expect(response.side_effects).toEqual([
      {
        type: 'BLOCKER_CREATED',
        blocker_code: 'MISSING_EVIDENCE',
        severity: BlockerSeverity.ERROR,
      },
    ]);
    expect(hasBlockerCreatedSideEffect(response)).toBe(true);
  });

  it('removes resolved blockers from the current blocker projection', () => {
    const response = projectCardActionResponse({
      previous_state: state({ blockers: [blocker()] }),
      command: {
        action_code: ActionCode.RESOLVE_CLERK_BLOCKER,
        idempotency_key: 'idem_3',
        client_version: 3,
      },
      server_version: 4,
      next_action: nextAction({ code: ActionCode.CONFIRM_PRESCRIPTION_DIFF }),
      blocker_changes: { resolved_codes: ['MISSING_EVIDENCE'] },
      display_context: displayContext(),
    });

    expect(response.blockers).toEqual([]);
    expect(response.side_effects).toEqual([
      { type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_EVIDENCE' },
    ]);
  });

  it('normalizes next_action kind and enabled from the canonical button state', () => {
    const response = projectCardActionResponse({
      previous_state: state(),
      command: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_4',
        client_version: 3,
      },
      server_version: 4,
      next_action: nextAction({
        code: ActionCode.START_DISPENSING,
        kind: ActionKind.STEP_CHANGING,
        enabled: false,
        target_endpoint: '/cards/card_1/actions',
        ui_state: ButtonState.ACTIONABLE,
      }),
      display_context: displayContext(),
    });

    expect(response.next_action).toMatchObject({
      code: ActionCode.START_DISPENSING,
      kind: ActionKind.INTRA_STEP,
      enabled: true,
      reason_required: false,
      target_endpoint: CARD_ACTION_TARGET_ENDPOINT,
    });
  });

  it('adds reason_required metadata from the canonical action transition matrix', () => {
    const response = projectCardActionResponse({
      previous_state: state(),
      command: {
        action_code: ActionCode.CANCEL_CARD,
        idempotency_key: 'idem_5',
        client_version: 3,
        reason_code: 'OTHER',
      },
      server_version: 4,
      next_action: nextAction({ code: ActionCode.REOPEN_CARD }),
      display_context: displayContext({ canceled_at: '2026-06-09T00:00:00.000Z' }),
    });

    expect(response.next_action).toMatchObject({
      code: ActionCode.REOPEN_CARD,
      reason_required: true,
    });
  });

  it('requires a server commit timestamp when projecting CANCEL_CARD', () => {
    expect(() =>
      projectCardActionResponse({
        previous_state: state(),
        command: {
          action_code: ActionCode.CANCEL_CARD,
          idempotency_key: 'idem_cancel_1',
          client_version: 3,
          reason_code: 'OTHER',
        },
        server_version: 4,
        next_action: nextAction({ code: ActionCode.REOPEN_CARD }),
        display_context: displayContext({ canceled_at: null }),
      }),
    ).toThrow('canceled_at');

    const response = projectCardActionResponse({
      previous_state: state(),
      command: {
        action_code: ActionCode.CANCEL_CARD,
        idempotency_key: 'idem_cancel_2',
        client_version: 3,
        reason_code: 'OTHER',
      },
      server_version: 4,
      next_action: nextAction({ code: ActionCode.REOPEN_CARD }),
      display_context: displayContext({ canceled_at: '2026-06-09T00:00:00.000Z' }),
    });

    expect(response.display_status).toBe(DisplayStatus.CANCELED);
  });
});
