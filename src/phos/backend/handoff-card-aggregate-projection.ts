import { BlockerSeverity } from '@/phos/contracts/phos_contracts';
import type { BlockerView, CardSummaryView, NextActionView } from '@/phos/contracts/phos_contracts';
import { resolveButtonState } from '@/phos/domain/actions/resolveButtonState';
import { resolveDisplayStatus } from '@/phos/domain/status/resolveDisplayStatus';
import type { CardActionExecutionState } from './card-action-executor';
import type { CardActionDisplayContext } from './card-action-projection';

export type HandoffCardAggregateUpdate = {
  card: CardSummaryView;
  blockers: BlockerView[];
  next_action: NextActionView;
  server_version: number;
};

export type HandoffCardAggregateSource = {
  state: CardActionExecutionState;
  display_context: CardActionDisplayContext;
};

function isBlocking(blocker: BlockerView): boolean {
  return (
    blocker.active &&
    (blocker.severity === BlockerSeverity.ERROR || blocker.severity === BlockerSeverity.CRITICAL)
  );
}

export function projectHandoffBlockerResolution(input: {
  source: HandoffCardAggregateSource;
  blocker_code: string;
  server_version: number;
}): HandoffCardAggregateUpdate {
  const previous_state = input.source.state;
  if (input.server_version <= previous_state.card.server_version) {
    throw new Error('Handoff card aggregate server_version must advance');
  }

  const blockers = previous_state.blockers.filter(
    (blocker) => blocker.blocker_code !== input.blocker_code,
  );
  const blockingBlocker = blockers.find(isBlocking);
  const display_status = resolveDisplayStatus({
    ...input.source.display_context,
    current_step: previous_state.card.current_step,
    blockers,
  });
  const ui_state = resolveButtonState({
    card: { ...previous_state.card, display_status },
    nextAction: previous_state.next_action,
    isOffline: false,
    noPermission: !previous_state.next_action.can_user_handle,
    blockingBlocker: blockingBlocker
      ? {
          code: blockingBlocker.blocker_code,
          severity: blockingBlocker.severity,
          owner_role: blockingBlocker.owner_role,
        }
      : undefined,
    canUserHandleBlocker: blockingBlocker
      ? previous_state.next_action.required_role.includes(blockingBlocker.owner_role)
      : false,
  });
  const next_action: NextActionView = {
    ...previous_state.next_action,
    ui_state,
    enabled: ui_state === 'ACTIONABLE' || ui_state === 'RESOLVABLE_BLOCK',
  };

  return {
    card: {
      ...previous_state.card,
      display_status,
      server_version: input.server_version,
    },
    blockers,
    next_action,
    server_version: input.server_version,
  };
}
