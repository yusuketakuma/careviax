import {
  ActionCode,
  ActionKind,
  ButtonState,
  CurrentStep,
  DisplayStatus,
} from '@/phos/contracts/phos_contracts';
import type {
  ActionResponse,
  BlockerView,
  CardSummaryView,
  NextActionView,
  SideEffect,
  TabKey,
  ToastTone,
} from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import { resolveDisplayStatus } from '@/phos/domain/status/resolveDisplayStatus';
import type { CardActionCommand } from './cards-repository';
import type { CardActionExecutionState } from './card-action-executor';

export type CardActionBlockerChanges = {
  created?: BlockerView[];
  resolved_codes?: string[];
};

export type CardActionDisplayContext = {
  canceled_at: string | null;
  has_open_rejected_audit: boolean;
  has_active_in_progress_task: boolean;
  primary_action_authorized: boolean;
};

export type CardActionProjectionInput = {
  previous_state: CardActionExecutionState;
  command: CardActionCommand;
  server_version: number;
  next_action: NextActionView;
  blocker_changes?: CardActionBlockerChanges;
  side_effects?: SideEffect[];
  visible_tabs?: TabKey[];
  toast?: { tone: ToastTone; message_key: string; params?: Record<string, string> };
  display_context: CardActionDisplayContext;
  current_step_override?: CurrentStep;
};

function isCurrentStep(value: string): value is CurrentStep {
  return Object.values(CurrentStep).includes(value as CurrentStep);
}

function resolveProjectedStep(input: CardActionProjectionInput): CurrentStep {
  if (input.current_step_override) return input.current_step_override;

  const transition = ACTION_TRANSITION_MATRIX[input.command.action_code];
  if (transition.kind === ActionKind.STEP_CHANGING && isCurrentStep(transition.to)) {
    return transition.to;
  }
  return input.previous_state.card.current_step;
}

function applyBlockerChanges(
  current: readonly BlockerView[],
  changes: CardActionBlockerChanges | undefined,
): BlockerView[] {
  const resolved = new Set(changes?.resolved_codes ?? []);
  const created = changes?.created ?? [];
  const createdCodes = new Set(created.map((blocker) => blocker.blocker_code));

  return [
    ...current.filter(
      (blocker) => !resolved.has(blocker.blocker_code) && !createdCodes.has(blocker.blocker_code),
    ),
    ...created,
  ];
}

function blockerSideEffects(changes: CardActionBlockerChanges | undefined): SideEffect[] {
  return [
    ...(changes?.resolved_codes ?? []).map(
      (blocker_code): SideEffect => ({ type: 'BLOCKER_RESOLVED', blocker_code }),
    ),
    ...(changes?.created ?? []).map(
      (blocker): SideEffect => ({
        type: 'BLOCKER_CREATED',
        blocker_code: blocker.blocker_code,
        severity: blocker.severity,
      }),
    ),
  ];
}

export function normalizeNextActionView(next_action: NextActionView): NextActionView {
  const uiEnabled =
    next_action.ui_state === ButtonState.ACTIONABLE ||
    next_action.ui_state === ButtonState.RESOLVABLE_BLOCK;
  const transition = ACTION_TRANSITION_MATRIX[next_action.code];

  return {
    ...next_action,
    kind: transition.kind,
    enabled: uiEnabled,
    reason_required: 'reason_required' in transition && transition.reason_required === true,
  };
}

export function hasBlockerCreatedSideEffect(response: Pick<ActionResponse, 'side_effects'>) {
  return response.side_effects.some((effect) => effect.type === 'BLOCKER_CREATED');
}

export function isBlockedActionResponse(
  response: Pick<ActionResponse, 'display_status' | 'side_effects'>,
) {
  return response.display_status === DisplayStatus.BLOCKED && hasBlockerCreatedSideEffect(response);
}

export function projectCardActionResponse(input: CardActionProjectionInput): ActionResponse {
  if (input.server_version <= input.previous_state.card.server_version) {
    throw new Error('Action projection server_version must advance');
  }
  if (
    input.command.action_code === ActionCode.CANCEL_CARD &&
    input.display_context.canceled_at == null
  ) {
    throw new Error('Action projection requires canceled_at for CANCEL_CARD');
  }

  const current_step = resolveProjectedStep(input);
  const blockers = applyBlockerChanges(input.previous_state.blockers, input.blocker_changes);
  const side_effects = [
    ...(input.side_effects ?? []),
    ...blockerSideEffects(input.blocker_changes),
  ];
  const display_status = resolveDisplayStatus({
    canceled_at: input.display_context.canceled_at,
    current_step,
    blockers,
    has_open_rejected_audit: input.display_context.has_open_rejected_audit,
    has_active_in_progress_task: input.display_context.has_active_in_progress_task,
    primary_action_authorized: input.display_context.primary_action_authorized,
  });

  const card: CardSummaryView = {
    ...input.previous_state.card,
    current_step,
    display_status,
    server_version: input.server_version,
  };

  return {
    card,
    next_action: normalizeNextActionView(input.next_action),
    display_status,
    blockers,
    ...(input.visible_tabs ? { visible_tabs: input.visible_tabs } : {}),
    side_effects,
    ...(input.toast ? { toast: input.toast } : {}),
    server_version: input.server_version,
  };
}
