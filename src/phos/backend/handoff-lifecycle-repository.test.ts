import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BlockerSeverity,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  HandoffStatus,
  HandoffUrgency,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { HandoffMutationResponse, HandoffView } from '@/phos/contracts/phos_contracts';
import { PhosDomainError } from './cards-repository';
import {
  createHandoffLifecycleRepository,
  type HandoffLifecycleStore,
} from './handoff-lifecycle-repository';
import type { HandoffCardAggregateSource } from './handoff-card-aggregate-projection';
import type { TenantContext } from './tenant-context';

function ctx(): TenantContext {
  return {
    tenant_id: 'tenant_abc123',
    user_id: 'user_pharmacist',
    role: UserRole.PHARMACIST,
    request_id: 'req_1',
    correlation_id: 'corr_1',
    scopes: ['phos/handoffs.read', 'phos/handoffs.write'],
  };
}

function ctxWithRole(role: UserRole, user_id = 'user_pharmacist'): TenantContext {
  return { ...ctx(), role, user_id };
}

function handoff(overrides: Partial<HandoffView> = {}): HandoffView {
  return {
    handoff_id: 'handoff_1',
    card_id: 'card_1',
    status: HandoffStatus.OPEN,
    reason_code: 'DIFF_REVIEW',
    summary: '薬剤師確認が必要です。',
    source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
    requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    urgency: HandoffUrgency.HIGH,
    related_blocker_code: 'MISSING_EVIDENCE',
    created_by_user_id: 'user_clerk',
    assignee_user_id: 'user_pharmacist',
    created_at: '2026-06-09T00:00:00.000Z',
    updated_at: '2026-06-09T00:00:00.000Z',
    server_version: 1,
    patient_name: '患者 山田太郎',
    age_minutes: 12,
    ...overrides,
  };
}

function mutationResponse(next: HandoffView): HandoffMutationResponse {
  return {
    handoff: next,
    side_effects: [],
    server_version: next.server_version,
  };
}

function cardAggregateSource(): HandoffCardAggregateSource {
  return {
    state: {
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
          active: true,
        },
      ],
      unresolved_claim_candidate_count: 0,
    },
    display_context: {
      canceled_at: null,
      has_open_rejected_audit: false,
      has_active_in_progress_task: false,
      primary_action_authorized: true,
    },
  };
}

function store(overrides: Partial<HandoffLifecycleStore> = {}): HandoffLifecycleStore {
  return {
    searchHandoffs: vi.fn(async () => ({ items: [], server_time: '2026-06-09T00:00:00.000Z' })),
    getIdempotentMutation: vi.fn(async () => ({ status: 'MISS' as const })),
    loadHandoff: vi.fn(async () => handoff()),
    loadCreateCardContext: vi.fn(async () => ({
      card_id: 'card_1',
      patient_name: '患者 山田太郎',
      server_version: 1,
      pharmacist_assignee_user_id: 'user_pharmacist',
    })),
    loadHandoffCardState: vi.fn(async () => cardAggregateSource()),
    commitCreateHandoff: vi.fn(async (_ctx, command, cardContext) =>
      mutationResponse(
        handoff({
          handoff_id: 'handoff_created',
          card_id: command.card_id,
          reason_code: command.reason_code,
          summary: command.summary,
          source_refs: command.source_refs,
          urgency: command.urgency,
          patient_name: cardContext.patient_name,
          assignee_user_id: cardContext.pharmacist_assignee_user_id,
        }),
      ),
    ),
    commitHandoffTransition: vi.fn(async (_ctx, input) => input.response),
    ...overrides,
  };
}

describe('createHandoffLifecycleRepository', () => {
  it('rejects explicit assignee queue search for non-manager users', async () => {
    const backingStore = store();
    const repo = createHandoffLifecycleRepository(backingStore);

    await expect(
      repo.searchHandoffs(ctx(), { assignee: 'user_other', limit: 50 }),
    ).rejects.toMatchObject({ error_code: 'FORBIDDEN' } satisfies Partial<PhosDomainError>);
    expect(backingStore.searchHandoffs).not.toHaveBeenCalled();

    await repo.searchHandoffs(ctxWithRole(UserRole.MANAGER), { assignee: 'user_other', limit: 50 });
    expect(backingStore.searchHandoffs).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.MANAGER }),
      expect.objectContaining({ assignee: 'user_other' }),
    );
  });

  it('resolves OPEN handoffs through review and emits BLOCKER_RESOLVED from stored relation', async () => {
    const backingStore = store();
    const repo = createHandoffLifecycleRepository(backingStore);

    const response = await repo.resolveHandoff(ctx(), 'handoff_1', {
      resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      idempotency_key: 'idem_resolve',
      client_version: 1,
    });

    expect(response.handoff.status).toBe(HandoffStatus.RESOLVED);
    expect(response.side_effects).toEqual([
      { type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_EVIDENCE' },
    ]);
    expect(backingStore.commitHandoffTransition).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123' }),
      expect.objectContaining({
        handoff_id: 'handoff_1',
        previous_handoff: expect.objectContaining({ status: HandoffStatus.OPEN }),
        card_aggregate_update: expect.objectContaining({
          card: expect.objectContaining({
            card_id: 'card_1',
            display_status: DisplayStatus.READY,
            server_version: 2,
          }),
          blockers: [],
        }),
      }),
    );
  });

  it('opens OPEN handoffs for pharmacist review', async () => {
    const backingStore = store();
    const repo = createHandoffLifecycleRepository(backingStore, {
      now: () => new Date('2026-06-09T01:23:45.000Z'),
    });

    const response = await repo.openHandoff(ctx(), 'handoff_1', {
      idempotency_key: 'idem_open',
      client_version: 1,
    });

    expect(response.handoff.status).toBe(HandoffStatus.IN_REVIEW);
    expect(response.handoff.updated_at).toBe('2026-06-09T01:23:45.000Z');
    expect(backingStore.commitHandoffTransition).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123' }),
      expect.objectContaining({
        mutation_key: 'OPEN_HANDOFF:handoff_1',
        previous_handoff: expect.objectContaining({ status: HandoffStatus.OPEN }),
      }),
    );
  });

  it('rejects non-assignee pharmacist handoff transitions', async () => {
    const backingStore = store({
      loadHandoff: vi.fn(async () =>
        handoff({ assignee_user_id: 'user_other', status: HandoffStatus.OPEN }),
      ),
    });
    const repo = createHandoffLifecycleRepository(backingStore);

    await expect(
      repo.openHandoff(ctx(), 'handoff_1', {
        idempotency_key: 'idem_open',
        client_version: 1,
      }),
    ).rejects.toMatchObject({ error_code: 'FORBIDDEN' } satisfies Partial<PhosDomainError>);
    expect(backingStore.commitHandoffTransition).not.toHaveBeenCalled();
  });

  it('allows manager override for handoff transitions', async () => {
    const backingStore = store({
      loadHandoff: vi.fn(async () =>
        handoff({ assignee_user_id: 'user_other', status: HandoffStatus.OPEN }),
      ),
    });
    const repo = createHandoffLifecycleRepository(backingStore);

    await expect(
      repo.openHandoff(ctxWithRole(UserRole.MANAGER), 'handoff_1', {
        idempotency_key: 'idem_open',
        client_version: 1,
      }),
    ).resolves.toMatchObject({ handoff: { status: HandoffStatus.IN_REVIEW } });
    expect(backingStore.commitHandoffTransition).toHaveBeenCalledOnce();
  });

  it('checks card server version before creating handoffs', async () => {
    const backingStore = store({
      loadCreateCardContext: vi.fn(async () => ({
        card_id: 'card_1',
        patient_name: '患者 山田太郎',
        server_version: 3,
        pharmacist_assignee_user_id: 'user_pharmacist',
      })),
    });
    const repo = createHandoffLifecycleRepository(backingStore);

    await expect(
      repo.createHandoff(ctx(), {
        card_id: 'card_1',
        reason_code: 'DIFF_REVIEW',
        summary: '薬剤師確認が必要です。',
        source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
        urgency: HandoffUrgency.HIGH,
        idempotency_key: 'idem_create',
        client_version: 1,
      }),
    ).rejects.toMatchObject({ error_code: 'STALE_VERSION' } satisfies Partial<PhosDomainError>);
    expect(backingStore.commitCreateHandoff).not.toHaveBeenCalled();
  });

  it('rejects non-manager create assignee overrides before idempotency replay', async () => {
    const matched = mutationResponse(handoff({ handoff_id: 'handoff_replayed' }));
    const backingStore = store({
      getIdempotentMutation: vi.fn(async () => ({ status: 'MATCH' as const, response: matched })),
    });
    const repo = createHandoffLifecycleRepository(backingStore);

    await expect(
      repo.createHandoff(ctxWithRole(UserRole.PHARMACY_CLERK, 'user_clerk'), {
        card_id: 'card_1',
        reason_code: 'DIFF_REVIEW',
        summary: '薬剤師確認が必要です。',
        source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
        urgency: HandoffUrgency.HIGH,
        assignee_user_id: 'user_other',
        idempotency_key: 'idem_create',
        client_version: 1,
      }),
    ).rejects.toMatchObject({
      error_code: 'FORBIDDEN',
      details: { reason: 'handoff_assignee_override_forbidden' },
    } satisfies Partial<PhosDomainError>);

    expect(backingStore.getIdempotentMutation).not.toHaveBeenCalled();
    expect(backingStore.commitCreateHandoff).not.toHaveBeenCalled();
  });

  it('allows manager create assignee overrides', async () => {
    const backingStore = store();
    const repo = createHandoffLifecycleRepository(backingStore);

    await expect(
      repo.createHandoff(ctxWithRole(UserRole.MANAGER, 'manager_1'), {
        card_id: 'card_1',
        reason_code: 'DIFF_REVIEW',
        summary: '薬剤師確認が必要です。',
        source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
        urgency: HandoffUrgency.HIGH,
        assignee_user_id: 'user_other',
        idempotency_key: 'idem_create',
        client_version: 1,
      }),
    ).resolves.toMatchObject({ handoff: { handoff_id: 'handoff_created' } });

    expect(backingStore.commitCreateHandoff).toHaveBeenCalledOnce();
  });

  it('returns matched idempotent responses and rejects conflicting idempotency keys', async () => {
    const matched = mutationResponse(
      handoff({ status: HandoffStatus.RESOLVED, server_version: 2 }),
    );
    const matchedStore = store({
      getIdempotentMutation: vi.fn(async () => ({ status: 'MATCH' as const, response: matched })),
    });
    const matchedRepo = createHandoffLifecycleRepository(matchedStore);

    await expect(
      matchedRepo.resolveHandoff(ctx(), 'handoff_1', {
        resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_resolve',
        client_version: 1,
      }),
    ).resolves.toEqual(matched);
    expect(matchedStore.loadHandoff).not.toHaveBeenCalled();

    const conflictRepo = createHandoffLifecycleRepository(
      store({
        getIdempotentMutation: vi.fn(async () => ({
          status: 'CONFLICT' as const,
          existing_request_fingerprint: 'other',
        })),
      }),
    );

    await expect(
      conflictRepo.resolveHandoff(ctx(), 'handoff_1', {
        resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_resolve',
        client_version: 1,
      }),
    ).rejects.toMatchObject({
      error_code: 'IDEMPOTENCY_CONFLICT',
    } satisfies Partial<PhosDomainError>);
  });

  it('replays matching idempotency responses after create commit races', async () => {
    const matched = mutationResponse(handoff({ handoff_id: 'handoff_created' }));
    const backingStore = store({
      getIdempotentMutation: vi
        .fn()
        .mockResolvedValueOnce({ status: 'MISS' as const })
        .mockResolvedValueOnce({ status: 'MATCH' as const, response: matched }),
      commitCreateHandoff: vi.fn(async () => {
        throw new PhosDomainError({
          status: 409,
          error_code: 'STALE_VERSION',
          message_key: 'api.error.stale_version',
        });
      }),
    });
    const repo = createHandoffLifecycleRepository(backingStore);

    await expect(
      repo.createHandoff(ctx(), {
        card_id: 'card_1',
        reason_code: 'DIFF_REVIEW',
        summary: '薬剤師確認が必要です。',
        source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
        urgency: HandoffUrgency.HIGH,
        idempotency_key: 'idem_create',
        client_version: 1,
      }),
    ).resolves.toEqual(matched);
    expect(backingStore.getIdempotentMutation).toHaveBeenCalledTimes(2);
  });

  it('replays matching idempotency responses after transition commit races', async () => {
    const matched = mutationResponse(
      handoff({ status: HandoffStatus.IN_REVIEW, server_version: 2 }),
    );
    const backingStore = store({
      getIdempotentMutation: vi
        .fn()
        .mockResolvedValueOnce({ status: 'MISS' as const })
        .mockResolvedValueOnce({ status: 'MATCH' as const, response: matched }),
      commitHandoffTransition: vi.fn(async () => {
        throw new PhosDomainError({
          status: 409,
          error_code: 'STALE_VERSION',
          message_key: 'api.error.stale_version',
        });
      }),
    });
    const repo = createHandoffLifecycleRepository(backingStore);

    await expect(
      repo.openHandoff(ctx(), 'handoff_1', {
        idempotency_key: 'idem_open',
        client_version: 1,
      }),
    ).resolves.toEqual(matched);
    expect(backingStore.getIdempotentMutation).toHaveBeenCalledTimes(2);
  });

  it('rejects stale handoff versions before committing transitions', async () => {
    const backingStore = store({ loadHandoff: vi.fn(async () => handoff({ server_version: 3 })) });
    const repo = createHandoffLifecycleRepository(backingStore);

    await expect(
      repo.returnHandoff(ctx(), 'handoff_1', {
        return_reason_code: 'NEED_MORE_INFO',
        return_note: '施設連絡先を確認してください。',
        idempotency_key: 'idem_return',
        client_version: 1,
      }),
    ).rejects.toMatchObject({ error_code: 'STALE_VERSION' } satisfies Partial<PhosDomainError>);
    expect(backingStore.commitHandoffTransition).not.toHaveBeenCalled();
  });

  it('moves returned handoffs back to the creating clerk assignee', async () => {
    const backingStore = store({
      loadHandoff: vi.fn(async () =>
        handoff({
          status: HandoffStatus.IN_REVIEW,
          created_by_user_id: 'user_clerk',
          assignee_user_id: 'user_pharmacist',
        }),
      ),
    });
    const repo = createHandoffLifecycleRepository(backingStore);

    const response = await repo.returnHandoff(ctx(), 'handoff_1', {
      return_reason_code: 'NEED_MORE_INFO',
      return_note: '施設連絡先を確認してください。',
      idempotency_key: 'idem_return',
      client_version: 1,
    });

    expect(response.handoff.status).toBe(HandoffStatus.RETURNED);
    expect(response.handoff.assignee_user_id).toBe('user_clerk');
  });
});
