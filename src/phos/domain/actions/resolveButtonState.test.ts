import { describe, expect, it } from 'vitest';
import {
  ActionCode,
  ActionKind,
  ButtonState,
  CurrentStep,
  DisplayStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { ButtonStateContext, NextActionView } from '@/phos/contracts/phos_contracts';
import { findNextActionInvariantViolations, resolveButtonState } from './resolveButtonState';

const baseNextAction: NextActionView = {
  code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
  kind: ActionKind.STEP_CHANGING,
  label_key: 'action.confirm_prescription_diff',
  enabled: true,
  offline_allowed: false,
  priority: 'PRIMARY',
  required_role: [UserRole.PHARMACIST],
  target_endpoint: '/cards/card_1/actions',
  ui_state: ButtonState.ACTIONABLE,
  can_user_handle: true,
};

function ctx(overrides: Partial<ButtonStateContext>): ButtonStateContext {
  return {
    card: { display_status: DisplayStatus.READY, current_step: CurrentStep.DIFF_REVIEW },
    nextAction: baseNextAction,
    isOffline: false,
    canUserHandleBlocker: false,
    noPermission: false,
    ...overrides,
  };
}

describe('resolveButtonState', () => {
  it('returns OFFLINE_BLOCKED when offline and action is not offline allowed', () => {
    expect(resolveButtonState(ctx({ isOffline: true }))).toBe(ButtonState.OFFLINE_BLOCKED);
  });

  it('returns READONLY_CLOSED for closed or canceled cards', () => {
    expect(
      resolveButtonState(
        ctx({ card: { display_status: DisplayStatus.CLOSED, current_step: CurrentStep.CLOSED } }),
      ),
    ).toBe(ButtonState.READONLY_CLOSED);
    expect(
      resolveButtonState(
        ctx({ card: { display_status: DisplayStatus.CANCELED, current_step: CurrentStep.INTAKE } }),
      ),
    ).toBe(ButtonState.READONLY_CLOSED);
  });

  it('returns NO_PERMISSION when the user cannot execute the action', () => {
    expect(resolveButtonState(ctx({ noPermission: true }))).toBe(ButtonState.NO_PERMISSION);
  });

  it('returns RESOLVABLE_BLOCK when the user can handle the blocking blocker', () => {
    expect(
      resolveButtonState(
        ctx({
          blockingBlocker: {
            code: 'MISSING_EVIDENCE',
            severity: 'ERROR',
            owner_role: UserRole.PHARMACY_CLERK,
          },
          canUserHandleBlocker: true,
        }),
      ),
    ).toBe(ButtonState.RESOLVABLE_BLOCK);
  });

  it('returns FOREIGN_BLOCK when another role must handle the blocker', () => {
    expect(
      resolveButtonState(
        ctx({
          blockingBlocker: {
            code: 'PHARMACIST_REVIEW_REQUIRED',
            severity: 'CRITICAL',
            owner_role: UserRole.PHARMACIST,
          },
          canUserHandleBlocker: false,
        }),
      ),
    ).toBe(ButtonState.FOREIGN_BLOCK);
  });

  it('returns ACTIONABLE by default', () => {
    expect(resolveButtonState(ctx({}))).toBe(ButtonState.ACTIONABLE);
  });
});

describe('findNextActionInvariantViolations', () => {
  it('accepts a valid actionable next action', () => {
    expect(
      findNextActionInvariantViolations({
        display_status: DisplayStatus.READY,
        next_action: baseNextAction,
      }),
    ).toEqual([]);
  });

  it('enforces INV-1 through INV-4', () => {
    const violations = new Set([
      ...findNextActionInvariantViolations({
        display_status: DisplayStatus.READY,
        next_action: {
          ...baseNextAction,
          enabled: false,
          ui_state: ButtonState.ACTIONABLE,
        },
      }),
      ...findNextActionInvariantViolations({
        display_status: DisplayStatus.BLOCKED,
        next_action: {
          ...baseNextAction,
          enabled: false,
          offline_allowed: true,
          ui_state: ButtonState.OFFLINE_BLOCKED,
        },
      }),
    ]);

    expect([...violations].sort()).toEqual(['INV-1', 'INV-2', 'INV-3', 'INV-4']);
  });
});
