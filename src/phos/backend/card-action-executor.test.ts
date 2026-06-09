import { describe, expect, it, vi } from 'vitest';
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
  VisitStatus,
  VisitStep,
} from '@/phos/contracts/phos_contracts';
import type {
  ActionResponse,
  BlockerView,
  CardSummaryView,
  NextActionView,
  VisitModeView,
} from '@/phos/contracts/phos_contracts';
import {
  createActionRequestFingerprint,
  createCardActionExecutorRepository,
  type CardActionExecutionState,
  type CardActionExecutionStore,
  type IdempotentActionLookup,
} from './card-action-executor';
import { PhosDomainError } from './cards-repository';
import type { TenantContext } from './tenant-context';

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/cards.write'],
};

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
    code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    kind: ActionKind.STEP_CHANGING,
    label_key: 'action.confirm_prescription_diff',
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

function actionResponse(overrides: Partial<ActionResponse> = {}): ActionResponse {
  const updatedCard = card({
    current_step: CurrentStep.DISPENSING,
    display_status: DisplayStatus.IN_PROGRESS,
    server_version: 4,
  });
  return {
    card: updatedCard,
    next_action: nextAction({
      code: ActionCode.START_DISPENSING,
      kind: ActionKind.INTRA_STEP,
      label_key: 'action.start_dispensing',
    }),
    display_status: updatedCard.display_status,
    blockers: [],
    side_effects: [],
    server_version: updatedCard.server_version,
    ...overrides,
  };
}

function state(overrides: Partial<CardActionExecutionState> = {}): CardActionExecutionState {
  return {
    card: card(),
    next_action: nextAction(),
    blockers: [],
    unresolved_claim_candidate_count: 0,
    allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
    ...overrides,
  };
}

function visitMode(overrides: Partial<VisitModeView> = {}): VisitModeView {
  return {
    packet_id: 'packet_1',
    server_version: 3,
    patient_name: 'Test Patient',
    visit_status: VisitStatus.IN_PROGRESS,
    applicable_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.COMPLETE_CHECK],
    required_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.COMPLETE_CHECK],
    step_completed: {
      ...(Object.fromEntries(Object.values(VisitStep).map((step) => [step, false])) as Record<
        VisitStep,
        boolean
      >),
      [VisitStep.ARRIVAL_CONFIRM]: true,
      [VisitStep.COMPLETE_CHECK]: true,
    },
    last_opened_step: VisitStep.COMPLETE_CHECK,
    evidence_sync: { blocking_unsynced_count: 0, non_blocking_unsynced_count: 0 },
    online: true,
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

function store(overrides: Partial<CardActionExecutionStore> = {}): CardActionExecutionStore {
  return {
    getIdempotentAction: vi.fn(async (): Promise<IdempotentActionLookup> => ({ status: 'MISS' })),
    loadActionState: vi.fn(async () => state()),
    commitAction: vi.fn(async () => actionResponse()),
    ...overrides,
  };
}

const command = {
  action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
  idempotency_key: 'idem_1',
  client_version: 3,
};

describe('createCardActionExecutorRepository', () => {
  it('replays an idempotent ActionResponse without loading or committing state', async () => {
    const replayed = actionResponse();
    const fakeStore = store({
      getIdempotentAction: vi.fn(
        async (): Promise<IdempotentActionLookup> => ({
          status: 'MATCH',
          response: replayed,
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', command)).resolves.toEqual(replayed);

    expect(fakeStore.getIdempotentAction).toHaveBeenCalledWith(
      ctx,
      'card_1',
      'idem_1',
      createActionRequestFingerprint(command),
    );
    expect(fakeStore.loadActionState).not.toHaveBeenCalled();
    expect(fakeStore.commitAction).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused with a different request fingerprint', async () => {
    const fakeStore = store({
      getIdempotentAction: vi.fn(async (): Promise<IdempotentActionLookup> => {
        return {
          status: 'CONFLICT',
          existing_request_fingerprint: 'previous',
        };
      }),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', command)).rejects.toMatchObject({
      status: 409,
      error_code: 'IDEMPOTENCY_CONFLICT',
      details: { idempotency_key: 'idem_1' },
    });
    expect(fakeStore.loadActionState).not.toHaveBeenCalled();
    expect(fakeStore.commitAction).not.toHaveBeenCalled();
  });

  it('replays matching idempotent responses after commit races', async () => {
    const replayed = actionResponse();
    const fakeStore = store({
      getIdempotentAction: vi
        .fn()
        .mockResolvedValueOnce({ status: 'MISS' as const })
        .mockResolvedValueOnce({ status: 'MATCH' as const, response: replayed }),
      commitAction: vi.fn(async () => {
        throw new PhosDomainError({
          status: 409,
          error_code: 'STALE_VERSION',
          message_key: 'api.error.stale_version',
        });
      }),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', command)).resolves.toEqual(replayed);
    expect(fakeStore.getIdempotentAction).toHaveBeenCalledTimes(2);
  });

  it('rejects stale client_version with 409 before committing', async () => {
    const fakeStore = store({
      loadActionState: vi.fn(async () => state({ card: card({ server_version: 4 }) })),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', command)).rejects.toMatchObject({
      status: 409,
      error_code: 'STALE_VERSION',
      details: { client_version: 3, server_version: 4 },
    });
    expect(fakeStore.commitAction).not.toHaveBeenCalled();
  });

  it('rejects action codes owned by canonical detached routes before card action commit', async () => {
    const detachedCommand = {
      action_code: ActionCode.EXCLUDE_CLAIM_CANDIDATE,
      idempotency_key: 'idem_claim_exclude',
      client_version: 3,
      reason_code: 'NOT_ELIGIBLE',
    };
    const fakeStore = store({
      loadActionState: vi.fn(async () =>
        state({
          card: card({ current_step: CurrentStep.CLAIM_REVIEW }),
          next_action: nextAction({ code: ActionCode.EXCLUDE_CLAIM_CANDIDATE }),
          allowed_actions: [ActionCode.EXCLUDE_CLAIM_CANDIDATE],
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(
      repository.executeCardAction(ctx, 'card_1', detachedCommand),
    ).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: {
        action_code: ActionCode.EXCLUDE_CLAIM_CANDIDATE,
        reason: 'action_code_owned_by_canonical_detached_route',
      },
    });
    expect(fakeStore.commitAction).not.toHaveBeenCalled();
  });

  it('rejects actions outside the card current step with 422 guard failure', async () => {
    const fakeStore = store({
      loadActionState: vi.fn(async () =>
        state({ card: card({ current_step: CurrentStep.INTAKE }) }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', command)).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        current_step: CurrentStep.INTAKE,
        required_step: CurrentStep.DIFF_REVIEW,
      },
    });
    expect(fakeStore.commitAction).not.toHaveBeenCalled();
  });

  it('rejects unrelated unresolved blocking blockers as an action guard failure', async () => {
    const fakeStore = store({
      loadActionState: vi.fn(async () => state({ blockers: [blocker()] })),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', command)).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        blocker_codes: ['MISSING_EVIDENCE'],
      },
    });
    expect(fakeStore.commitAction).not.toHaveBeenCalled();
  });

  it('allows an action that directly resolves its required blocking blocker', async () => {
    const resolvingCommand = {
      action_code: ActionCode.RESOLVE_CLERK_BLOCKER,
      idempotency_key: 'idem_resolve_1',
      client_version: 3,
    };
    const resolvedCard = card({ display_status: DisplayStatus.READY, server_version: 4 });
    const fakeStore = store({
      loadActionState: vi.fn(async () =>
        state({
          blockers: [
            blocker({
              required_action_code: ActionCode.RESOLVE_CLERK_BLOCKER,
            }),
          ],
          allowed_actions: [ActionCode.RESOLVE_CLERK_BLOCKER],
        }),
      ),
      commitAction: vi.fn(async () =>
        actionResponse({
          card: resolvedCard,
          next_action: nextAction({ code: ActionCode.CONFIRM_PRESCRIPTION_DIFF }),
          display_status: resolvedCard.display_status,
          blockers: [],
          side_effects: [{ type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_EVIDENCE' }],
          server_version: 4,
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(
      repository.executeCardAction(ctx, 'card_1', resolvingCommand),
    ).resolves.toMatchObject({
      blockers: [],
      side_effects: [{ type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_EVIDENCE' }],
    });
  });

  it('rejects COMPLETE_VISIT on the generic card action path when visit mode state is absent', async () => {
    const completeCommand = {
      action_code: ActionCode.COMPLETE_VISIT,
      idempotency_key: 'idem_complete',
      client_version: 3,
    };
    const fakeStore = store({
      loadActionState: vi.fn(async () =>
        state({
          card: card({ current_step: CurrentStep.VISIT_IN_PROGRESS }),
          next_action: nextAction({ code: ActionCode.COMPLETE_VISIT }),
          allowed_actions: [ActionCode.COMPLETE_VISIT],
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(
      repository.executeCardAction(ctx, 'card_1', completeCommand),
    ).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: { reason: 'missing_visit_mode' },
    });
    expect(fakeStore.commitAction).not.toHaveBeenCalled();
  });

  it('rejects COMPLETE_VISIT when required visit evidence is not synced', async () => {
    const completeCommand = {
      action_code: ActionCode.COMPLETE_VISIT,
      idempotency_key: 'idem_complete',
      client_version: 3,
    };
    const fakeStore = store({
      loadActionState: vi.fn(async () =>
        state({
          card: card({ current_step: CurrentStep.VISIT_IN_PROGRESS }),
          next_action: nextAction({ code: ActionCode.COMPLETE_VISIT }),
          allowed_actions: [ActionCode.COMPLETE_VISIT],
          visit_mode: visitMode({
            evidence_sync: { blocking_unsynced_count: 1, non_blocking_unsynced_count: 0 },
          }),
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(
      repository.executeCardAction(ctx, 'card_1', completeCommand),
    ).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: { blocking_unsynced_count: 1 },
    });
    expect(fakeStore.commitAction).not.toHaveBeenCalled();
  });

  it('rejects REVIEW_CLAIM_CANDIDATES while unresolved claim candidates remain', async () => {
    const reviewCommand = {
      action_code: ActionCode.REVIEW_CLAIM_CANDIDATES,
      idempotency_key: 'idem_claim_review',
      client_version: 3,
    };
    const fakeStore = store({
      loadActionState: vi.fn(async () =>
        state({
          card: card({ current_step: CurrentStep.CLAIM_REVIEW }),
          next_action: nextAction({ code: ActionCode.REVIEW_CLAIM_CANDIDATES }),
          allowed_actions: [ActionCode.REVIEW_CLAIM_CANDIDATES],
          unresolved_claim_candidate_count: 2,
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', reviewCommand)).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: {
        action_code: ActionCode.REVIEW_CLAIM_CANDIDATES,
        unresolved_claim_candidate_count: 2,
        required_action_code: ActionCode.EXCLUDE_CLAIM_CANDIDATE,
      },
    });
    expect(fakeStore.commitAction).not.toHaveBeenCalled();
  });

  it('rejects REVIEW_CLAIM_CANDIDATES when the claim candidate aggregate is missing or invalid', async () => {
    const reviewCommand = {
      action_code: ActionCode.REVIEW_CLAIM_CANDIDATES,
      idempotency_key: 'idem_claim_review',
      client_version: 3,
    };
    const invalidStateWithAggregate = state({
      card: card({ current_step: CurrentStep.CLAIM_REVIEW }),
      next_action: nextAction({ code: ActionCode.REVIEW_CLAIM_CANDIDATES }),
      allowed_actions: [ActionCode.REVIEW_CLAIM_CANDIDATES],
    });
    const invalidState: Partial<CardActionExecutionState> = { ...invalidStateWithAggregate };
    delete invalidState.unresolved_claim_candidate_count;
    const fakeStore = store({
      loadActionState: vi.fn(async () => invalidState as CardActionExecutionState),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', reviewCommand)).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: {
        action_code: ActionCode.REVIEW_CLAIM_CANDIDATES,
        reason: 'invalid_unresolved_claim_candidate_count',
      },
    });
    expect(fakeStore.commitAction).not.toHaveBeenCalled();
  });

  it('allows REVIEW_CLAIM_CANDIDATES when every claim candidate is finalized', async () => {
    const reviewCommand = {
      action_code: ActionCode.REVIEW_CLAIM_CANDIDATES,
      idempotency_key: 'idem_claim_review',
      client_version: 3,
    };
    const closingCard = card({
      current_step: CurrentStep.CLOSING,
      display_status: DisplayStatus.READY,
      server_version: 4,
    });
    const fakeStore = store({
      loadActionState: vi.fn(async () =>
        state({
          card: card({ current_step: CurrentStep.CLAIM_REVIEW }),
          next_action: nextAction({ code: ActionCode.REVIEW_CLAIM_CANDIDATES }),
          allowed_actions: [ActionCode.REVIEW_CLAIM_CANDIDATES],
          unresolved_claim_candidate_count: 0,
        }),
      ),
      commitAction: vi.fn(async () =>
        actionResponse({
          card: closingCard,
          next_action: nextAction({ code: ActionCode.CLOSE_CARD }),
          display_status: closingCard.display_status,
          side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: 'card_1' }],
          server_version: closingCard.server_version,
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', reviewCommand)).resolves.toMatchObject(
      {
        card: { current_step: CurrentStep.CLOSING },
        side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: 'card_1' }],
      },
    );
    expect(fakeStore.commitAction).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ command: reviewCommand }),
    );
  });

  it('commits a valid step-changing action and returns canonical ActionResponse', async () => {
    const fakeStore = store();
    const repository = createCardActionExecutorRepository(fakeStore);

    const result = await repository.executeCardAction(ctx, 'card_1', command);

    expect(fakeStore.commitAction).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        card_id: 'card_1',
        command,
        request_fingerprint: createActionRequestFingerprint(command),
        previous_state: expect.objectContaining({
          card: expect.objectContaining({ server_version: 3 }),
        }),
      }),
    );
    expect(result).toMatchObject({
      card: {
        card_id: 'card_1',
        current_step: CurrentStep.DISPENSING,
        display_status: DisplayStatus.IN_PROGRESS,
        server_version: 4,
      },
      display_status: DisplayStatus.IN_PROGRESS,
      server_version: 4,
      next_action: { code: ActionCode.START_DISPENSING, kind: ActionKind.INTRA_STEP },
      side_effects: [],
    });
  });

  it('allows a pharmacy clerk to execute an action permitted by the transition matrix', async () => {
    const clerkCtx = { ...ctx, role: UserRole.PHARMACY_CLERK };
    const clerkCommand = {
      action_code: ActionCode.REGISTER_PRESCRIPTION,
      idempotency_key: 'idem_clerk_1',
      client_version: 3,
    };
    const updatedCard = card({
      current_step: CurrentStep.DIFF_REVIEW,
      display_status: DisplayStatus.READY,
      server_version: 4,
    });
    const fakeStore = store({
      loadActionState: vi.fn(async () =>
        state({
          card: card({ current_step: CurrentStep.INTAKE }),
          next_action: nextAction({
            code: ActionCode.REGISTER_PRESCRIPTION,
            label_key: 'action.register_prescription',
            required_role: [UserRole.PHARMACIST, UserRole.PHARMACY_CLERK],
          }),
          allowed_actions: [ActionCode.REGISTER_PRESCRIPTION],
        }),
      ),
      commitAction: vi.fn(async () =>
        actionResponse({
          card: updatedCard,
          display_status: updatedCard.display_status,
          server_version: updatedCard.server_version,
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(
      repository.executeCardAction(clerkCtx, 'card_1', clerkCommand),
    ).resolves.toMatchObject({
      card: { current_step: CurrentStep.DIFF_REVIEW },
      server_version: 4,
    });
  });

  it('allows a step-changing action response to stay on the same step when it creates blockers', async () => {
    const blockingCard = card({
      current_step: CurrentStep.DIFF_REVIEW,
      display_status: DisplayStatus.BLOCKED,
      server_version: 4,
    });
    const fakeStore = store({
      commitAction: vi.fn(async () =>
        actionResponse({
          card: blockingCard,
          next_action: nextAction({
            code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
            ui_state: ButtonState.RESOLVABLE_BLOCK,
          }),
          display_status: DisplayStatus.BLOCKED,
          blockers: [blocker()],
          side_effects: [
            {
              type: 'BLOCKER_CREATED',
              blocker_code: 'MISSING_EVIDENCE',
              severity: BlockerSeverity.ERROR,
            },
          ],
          server_version: 4,
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', command)).resolves.toMatchObject({
      card: { current_step: CurrentStep.DIFF_REVIEW, display_status: DisplayStatus.BLOCKED },
      display_status: DisplayStatus.BLOCKED,
      side_effects: [{ type: 'BLOCKER_CREATED', blocker_code: 'MISSING_EVIDENCE' }],
    });
  });

  it('rejects a blocker-created step-changing response that jumps to an unrelated step', async () => {
    const badCard = card({
      current_step: CurrentStep.SETTING,
      display_status: DisplayStatus.BLOCKED,
      server_version: 4,
    });
    const fakeStore = store({
      commitAction: vi.fn(async () =>
        actionResponse({
          card: badCard,
          display_status: DisplayStatus.BLOCKED,
          blockers: [blocker()],
          side_effects: [
            {
              type: 'BLOCKER_CREATED',
              blocker_code: 'MISSING_EVIDENCE',
              severity: BlockerSeverity.ERROR,
            },
          ],
          server_version: 4,
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', command)).rejects.toMatchObject({
      status: 500,
      error_code: 'INTERNAL_ERROR',
      details: {
        expected_step: CurrentStep.DISPENSING,
        actual_step: CurrentStep.SETTING,
      },
    });
  });

  it('rejects non-canonical ActionResponse instead of allowing optimistic state drift', async () => {
    const fakeStore = store({
      commitAction: vi.fn(async () =>
        actionResponse({
          display_status: DisplayStatus.READY,
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', command)).rejects.toMatchObject({
      status: 500,
      error_code: 'INTERNAL_ERROR',
      details: {
        display_status: DisplayStatus.READY,
        card_display_status: DisplayStatus.IN_PROGRESS,
      },
    });
  });

  it('rejects ActionResponse next_action endpoints that drift from the card action route contract', async () => {
    const fakeStore = store({
      commitAction: vi.fn(async () =>
        actionResponse({
          next_action: nextAction({
            code: ActionCode.START_DISPENSING,
            kind: ActionKind.INTRA_STEP,
            label_key: 'action.start_dispensing',
            target_endpoint: '/cards/card_1/actions',
          }),
        }),
      ),
    });
    const repository = createCardActionExecutorRepository(fakeStore);

    await expect(repository.executeCardAction(ctx, 'card_1', command)).rejects.toMatchObject({
      status: 500,
      error_code: 'INTERNAL_ERROR',
      details: {
        next_action_code: ActionCode.START_DISPENSING,
        target_endpoint: '/cards/card_1/actions',
        expected_target_endpoint: CARD_ACTION_TARGET_ENDPOINT,
      },
    });
  });
});
