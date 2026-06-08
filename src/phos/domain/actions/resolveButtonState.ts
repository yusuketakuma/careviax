import { ButtonState, DisplayStatus } from '@/phos/contracts/phos_contracts';
import type { ButtonStateContext, NextActionView } from '@/phos/contracts/phos_contracts';

export function resolveButtonState(ctx: ButtonStateContext): ButtonState {
  const displayStatus = ctx.card.display_status;
  if (ctx.isOffline && !ctx.nextAction.offline_allowed) return ButtonState.OFFLINE_BLOCKED;
  if (displayStatus === DisplayStatus.CLOSED || displayStatus === DisplayStatus.CANCELED) {
    return ButtonState.READONLY_CLOSED;
  }
  if (ctx.noPermission) return ButtonState.NO_PERMISSION;
  if (ctx.blockingBlocker) {
    return ctx.canUserHandleBlocker ? ButtonState.RESOLVABLE_BLOCK : ButtonState.FOREIGN_BLOCK;
  }
  return ButtonState.ACTIONABLE;
}

export function findNextActionInvariantViolations(input: {
  display_status: DisplayStatus;
  next_action: NextActionView;
}): string[] {
  const violations: string[] = [];
  const { display_status, next_action } = input;
  const actionable = next_action.ui_state === ButtonState.ACTIONABLE;
  const resolvable = next_action.ui_state === ButtonState.RESOLVABLE_BLOCK;

  if (next_action.enabled !== (actionable || resolvable)) {
    violations.push('INV-1');
  }
  if (
    next_action.ui_state === ButtonState.OFFLINE_BLOCKED &&
    next_action.offline_allowed !== false
  ) {
    violations.push('INV-2');
  }
  if (next_action.enabled === false && !next_action.disabled_reason_key) {
    violations.push('INV-3');
  }
  if (
    display_status === DisplayStatus.BLOCKED &&
    next_action.ui_state !== ButtonState.RESOLVABLE_BLOCK &&
    next_action.ui_state !== ButtonState.FOREIGN_BLOCK
  ) {
    violations.push('INV-4');
  }
  return violations;
}
