import { describe, expect, it } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BlockerSeverity,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { CardActionExecutionState } from './card-action-executor';
import { projectHandoffBlockerResolution } from './handoff-card-aggregate-projection';

function state(): CardActionExecutionState {
  return {
    card: {
      card_id: 'card_1',
      card_type: CardType.PRESCRIPTION,
      patient_name: '患者 山田太郎',
      current_step: CurrentStep.DIFF_REVIEW,
      display_status: DisplayStatus.BLOCKED,
      server_version: 1,
      tags: [],
    },
    next_action: {
      code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      kind: ActionKind.STEP_CHANGING,
      label_key: 'action.confirm_prescription_diff',
      enabled: true,
      offline_allowed: false,
      priority: 'PRIMARY',
      required_role: [UserRole.PHARMACIST],
      target_endpoint: '/cards/card_1/actions',
      ui_state: ButtonState.RESOLVABLE_BLOCK,
      can_user_handle: true,
    },
    blockers: [
      {
        blocker_code: 'MISSING_EVIDENCE',
        severity: BlockerSeverity.ERROR,
        owner_role: UserRole.PHARMACIST,
        message_key: 'blocker.missing_evidence',
        required_action_code: ActionCode.UPLOAD_EVIDENCE,
        active: true,
      },
    ],
  };
}

describe('projectHandoffBlockerResolution', () => {
  it('removes the related blocker and recalculates card status/action state', () => {
    const update = projectHandoffBlockerResolution({
      source: {
        state: state(),
        display_context: {
          canceled_at: null,
          has_open_rejected_audit: false,
          has_active_in_progress_task: false,
          primary_action_authorized: true,
        },
      },
      blocker_code: 'MISSING_EVIDENCE',
      server_version: 2,
    });

    expect(update.blockers).toEqual([]);
    expect(update.card.display_status).toBe(DisplayStatus.READY);
    expect(update.card.server_version).toBe(2);
    expect(update.next_action.ui_state).toBe(ButtonState.ACTIONABLE);
    expect(update.next_action.enabled).toBe(true);
  });

  it('requires the aggregate server version to advance', () => {
    expect(() =>
      projectHandoffBlockerResolution({
        source: {
          state: state(),
          display_context: {
            canceled_at: null,
            has_open_rejected_audit: false,
            has_active_in_progress_task: false,
            primary_action_authorized: true,
          },
        },
        blocker_code: 'MISSING_EVIDENCE',
        server_version: 1,
      }),
    ).toThrow('Handoff card aggregate server_version must advance');
  });
});
